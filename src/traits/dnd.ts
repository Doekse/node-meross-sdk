import type { TraitAttachContext } from '../device/enroll-context';
import type { DndTraitBind } from '../device/bindings';
import {
    DND_MODE_NAMESPACE,
    decodeDndGetAck,
    decodeDndPush,
    encodeDndGet,
    encodeDndSet
} from '../protocol/codecs/dnd';
import type { MerossMessage } from '../protocol/message';
import { applyPatch } from './patch';
import type { TraitDescriptor } from './descriptor';
import { DndCatalog } from './dnd.catalog';

export interface DndValues {
    /** Status LED on. Undefined until poller GETACK or PUSH. */
    on?: boolean;
}

/**
 * Device-wide status LED. Firmware DNDMode is inverted in the codec. Not per channel.
 */
export class DndTrait {
    /** @internal */
    private readonly bind: DndTraitBind;
    private last: DndValues = {};

    /** @internal */
    constructor(bind: DndTraitBind) {
        this.bind = bind;
    }

    /**
     * Full cache, not the last diff. A subscriber that attaches after enroll
     * never saw the seeded fields, and an unchanged poll does not emit again.
     */
    values(): DndValues {
        return { ...this.last };
    }

    /** True when the status LED is on. Undefined until poller GETACK or PUSH fills it. */
    isOn(): boolean | undefined {
        return this.last.on;
    }

    /**
     * On-demand GET of System.DNDMode. Rejects with `CommandError` /
     * `TransportError` / `ProtocolError` like `setOn`.
     */
    async poll(): Promise<DndValues> {
        const reply = await this.bind.request({
            namespace: DND_MODE_NAMESPACE,
            method: 'GET',
            payload: encodeDndGet()
        });
        this.applyChange({ on: decodeDndGetAck(reply.payload).on });
        return { ...this.last };
    }

    async setOn(on: boolean): Promise<{ on: boolean }> {
        await this.bind.request({
            namespace: DND_MODE_NAMESPACE,
            method: 'SET',
            payload: encodeDndSet({ on })
        });
        this.applyChange({ on });
        return { on };
    }

    /**
     * PUSH/GETACK from DeviceRuntime. Hosts subscribe to Endpoint `change`.
     *
     * @internal
     * @package
     */
    handlePush(message: MerossMessage): void {
        if (message.header.namespace !== DND_MODE_NAMESPACE) {
            return;
        }
        this.applyChange({ on: decodeDndPush(message.payload).on });
    }

    private applyChange(patch: DndValues): void {
        applyPatch(this.last, patch, this.bind.emitChange);
    }
}

export const descriptor: TraitDescriptor<'dnd', DndTrait> = {
    ...DndCatalog,
    attach(args: TraitAttachContext<'dnd'>): DndTrait {
        return new DndTrait({
            request: args.request,
            emitChange: args.emitChange
        });
    }
};
