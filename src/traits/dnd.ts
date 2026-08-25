import {
    DND_MODE_NAMESPACE,
    decodeDndPush,
    encodeDndSet,
    type MerossMessage
} from '../protocol';
import type { RoutedRequestOptions } from '../transport/router';

/**
 * Transport bind for one System.DNDMode board. Session supplies this;
 * trait tests inject a fake request/emit pair.
 */
export interface DndTraitBind {
    uuid: string;
    request: (options: Omit<RoutedRequestOptions, 'uuid' | 'ip' | 'encryptionKey'>) => Promise<MerossMessage>;
    emitChange: (on: boolean) => void;
}

/**
 * Device-wide do-not-disturb (status LED off when on). Not per channel.
 */
export class DndTrait {
    private readonly bind: DndTraitBind;
    private on: boolean | undefined;

    constructor(bind: DndTraitBind) {
        this.bind = bind;
    }

    /** True when DND is active (LED off). Undefined until poller GETACK or PUSH fills it. */
    isOn(): boolean | undefined {
        return this.on;
    }

    async setOn(on: boolean): Promise<{ on: boolean }> {
        await this.bind.request({
            namespace: DND_MODE_NAMESPACE,
            method: 'SET',
            payload: encodeDndSet({ on })
        });
        this.applyState(on);
        return { on };
    }

    handlePush(message: MerossMessage): void {
        const uuid = message.header.uuid
            ?? /^\/appliance\/([^/]+)\//.exec(message.header.from)?.[1];
        if (!uuid || uuid !== this.bind.uuid) {
            return;
        }
        if (message.header.namespace !== DND_MODE_NAMESPACE) {
            return;
        }
        this.applyState(decodeDndPush(message.payload).on);
    }

    private applyState(on: boolean): void {
        if (this.on === on) {
            return;
        }
        this.on = on;
        this.bind.emitChange(on);
    }
}
