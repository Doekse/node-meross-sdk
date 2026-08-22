import {
    DND_MODE_NAMESPACE,
    decodeDndGetAck,
    decodeDndPush,
    encodeDndGet,
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

    /** Fetches initial state. Idempotent; Session calls this once and does not await it. */
    start(): void {
        void this.pollInitial();
    }

    /** True when DND is active (LED off). Undefined until initial GET or PUSH fills it. */
    isOn(): boolean | undefined {
        return this.on;
    }

    /**
     * Enables or disables do-not-disturb for the bound device.
     */
    async setOn(on: boolean): Promise<{ on: boolean }> {
        await this.bind.request({
            namespace: DND_MODE_NAMESPACE,
            method: 'SET',
            payload: encodeDndSet({ on })
        });
        this.applyState(on);
        return { on };
    }

    /**
     * Applies a firmware PUSH for this device.
     */
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

    private async pollInitial(): Promise<void> {
        try {
            const reply = await this.bind.request({
                namespace: DND_MODE_NAMESPACE,
                method: 'GET',
                payload: encodeDndGet()
            });
            this.applyState(decodeDndGetAck(reply.payload).on);
        } catch {
            // Next PUSH or setter call will recover.
        }
    }
}
