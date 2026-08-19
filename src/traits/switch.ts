import {
    TOGGLEX_NAMESPACE,
    decodeToggleXPush,
    encodeToggleXSet,
    type MerossMessage
} from '../protocol';
import type { RoutedRequestOptions } from '../transport/router';

/**
 * Transport + channel bind for one switch endpoint. Session supplies this;
 * trait tests inject a fake request/emit pair.
 */
export interface SwitchTraitBind {
    uuid: string;
    channel: number;
    namespace: typeof TOGGLEX_NAMESPACE | 'Appliance.Control.Toggle';
    request: (options: Omit<RoutedRequestOptions, 'uuid' | 'ip' | 'encryptionKey'>) => Promise<MerossMessage>;
    emitChange: (on: boolean) => void;
    /** System.All digest `onoff` so Homey can read the tile before the first PUSH. */
    initialOn?: boolean;
}

/**
 * On/off control for one enrolled endpoint. Channel is bound at enrollment so
 * callers never pass it; Toggle vs ToggleX stays in codecs.
 */
export class SwitchTrait {
    private readonly bind: SwitchTraitBind;
    private on: boolean | undefined;

    constructor(bind: SwitchTraitBind) {
        this.bind = bind;
        this.on = bind.initialOn;
    }

    /**
     * Last known on/off. Undefined until digest, SET, or PUSH fills it.
     */
    isOn(): boolean | undefined {
        return this.on;
    }

    /**
     * Turns the bound channel on or off.
     */
    async setOn(on: boolean): Promise<{ on: boolean }> {
        const payload = this.bind.namespace === TOGGLEX_NAMESPACE
            ? encodeToggleXSet({ channel: this.bind.channel, on })
            : { toggle: { onoff: on ? 1 : 0 } };
        await this.bind.request({
            namespace: this.bind.namespace,
            method: 'SET',
            payload
        });
        this.applyState(on);
        return { on };
    }

    /**
     * Applies a firmware PUSH for this endpoint's namespace and channel.
     */
    handlePush(message: MerossMessage): void {
        const uuid = message.header.uuid
            ?? /^\/appliance\/([^/]+)\//.exec(message.header.from)?.[1];
        if (!uuid || uuid !== this.bind.uuid || message.header.namespace !== this.bind.namespace) {
            return;
        }
        if (this.bind.namespace === TOGGLEX_NAMESPACE) {
            for (const entry of decodeToggleXPush(message.payload)) {
                if (entry.channel === this.bind.channel) {
                    this.applyState(entry.on);
                }
            }
            return;
        }
        if (this.bind.channel === 0) {
            this.applyState((message.payload.toggle as { onoff: number }).onoff === 1);
        }
    }

    private applyState(on: boolean): void {
        if (this.on === on) {
            return;
        }
        this.on = on;
        this.bind.emitChange(on);
    }
}
