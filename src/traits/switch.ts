import {
    HUB_TOGGLEX_NAMESPACE,
    TOGGLEX_NAMESPACE,
    decodeHubToggleXPush,
    decodeToggleXPush,
    encodeHubToggleXSet,
    encodeToggleXSet,
    type MerossMessage
} from '../protocol';
import type { RoutedRequestOptions } from '../transport/router';

/**
 * Board bind: one Toggle/ToggleX channel on the physical device.
 */
export interface SwitchTraitBoardBind {
    kind: 'board';
    uuid: string;
    channel: number;
    namespace: typeof TOGGLEX_NAMESPACE | 'Appliance.Control.Toggle';
    request: (options: Omit<RoutedRequestOptions, 'uuid' | 'ip' | 'encryptionKey'>) => Promise<MerossMessage>;
    emitChange: (on: boolean) => void;
    /** System.All digest `onoff` so Homey can read the tile before the first PUSH. */
    initialOn?: boolean;
}

/**
 * Hub bind: one subdevice row driven by Hub.ToggleX (digest `onoff` without a known model).
 */
export interface SwitchTraitHubBind {
    kind: 'hub';
    uuid: string;
    subDeviceId: string;
    request: (options: Omit<RoutedRequestOptions, 'uuid' | 'ip' | 'encryptionKey'>) => Promise<MerossMessage>;
    emitChange: (on: boolean) => void;
    /** Hub digest `onoff` so Homey can read the tile before the first PUSH. */
    initialOn?: boolean;
}

export type SwitchTraitBind = SwitchTraitBoardBind | SwitchTraitHubBind;

/**
 * On/off control for one enrolled endpoint. Channel or subdevice id is bound at
 * enrollment so callers never pass it; Toggle vs ToggleX vs Hub.ToggleX stays in codecs.
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
     * Turns the bound channel or hub subdevice on or off.
     */
    async setOn(on: boolean): Promise<{ on: boolean }> {
        const payload = this.bind.kind === 'hub'
            ? encodeHubToggleXSet({ id: this.bind.subDeviceId, on })
            : this.bind.namespace === TOGGLEX_NAMESPACE
                ? encodeToggleXSet({ channel: this.bind.channel, on })
                : { toggle: { onoff: on ? 1 : 0 } };
        const namespace = this.bind.kind === 'hub'
            ? HUB_TOGGLEX_NAMESPACE
            : this.bind.namespace;
        await this.bind.request({
            namespace,
            method: 'SET',
            payload
        });
        this.applyState(on);
        return { on };
    }

    /**
     * Applies a firmware PUSH for this endpoint's namespace and channel or subdevice id.
     */
    handlePush(message: MerossMessage): void {
        const uuid = message.header.uuid
            ?? /^\/appliance\/([^/]+)\//.exec(message.header.from)?.[1];
        if (!uuid || uuid !== this.bind.uuid) {
            return;
        }
        if (this.bind.kind === 'hub') {
            if (message.header.namespace !== HUB_TOGGLEX_NAMESPACE) {
                return;
            }
            for (const entry of decodeHubToggleXPush(message.payload)) {
                if (entry.id === this.bind.subDeviceId) {
                    this.applyState(entry.on);
                }
            }
            return;
        }
        if (message.header.namespace !== this.bind.namespace) {
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
