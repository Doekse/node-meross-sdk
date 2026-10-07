import type { TraitAttachContext } from '../device/enroll-context';
import type { SprayTraitBind } from '../device/bindings';
import {
    SPRAY_NAMESPACE,
    decodeSprayPush,
    encodeSpraySet,
    type SprayMode
} from '../protocol/codecs/spray';
import type { MerossMessage } from '../protocol/message';
import { applyPatch } from './patch';
import type { TraitDescriptor } from './descriptor';
import { SprayCatalog } from './spray.catalog';

export type { SprayMode };

export interface SprayValues {
    mode?: SprayMode;
}

/**
 * Humidifier spray mode for one enrolled channel. Firmware mode is 0/1/2
 * (off / continuous / intermittent).
 */
export class SprayTrait {
    /** @internal */
    private readonly bind: SprayTraitBind;
    private last: SprayValues = {};

    /** @internal */
    constructor(bind: SprayTraitBind) {
        this.bind = bind;
    }

    /**
     * Full cache, not the last diff. A subscriber that attaches after enroll
     * never saw the seeded fields, and an unchanged poll does not emit again.
     */
    values(): SprayValues {
        return { ...this.last };
    }

    /** Undefined until poller GETACK or PUSH fills it. */
    getMode(): SprayMode | undefined {
        return this.last.mode;
    }

    async setMode(mode: SprayMode): Promise<{ mode: SprayMode }> {
        await this.bind.request({
            namespace: SPRAY_NAMESPACE,
            method: 'SET',
            payload: encodeSpraySet({ channel: this.bind.channel, mode })
        });
        this.applyChange({ mode });
        return { mode };
    }

    /**
     * PUSH/GETACK from Runtime. Hosts subscribe to Endpoint `change`.
     *
     * @internal
     * @package
     */
    handlePush(message: MerossMessage): void {
        if (message.header.namespace !== SPRAY_NAMESPACE) {
            return;
        }
        for (const entry of decodeSprayPush(message.payload)) {
            if (entry.channel === this.bind.channel) {
                this.applyChange({ mode: entry.mode });
            }
        }
    }

    private applyChange(patch: SprayValues): void {
        applyPatch(this.last, patch, this.bind.emitChange);
    }
}

export const descriptor: TraitDescriptor<'spray', SprayTrait> = {
    ...SprayCatalog,
    attach(args: TraitAttachContext<'spray'>): SprayTrait {
        return new SprayTrait({
            channel: args.channel,
            request: args.request,
            emitChange: args.emitChange
        });
    }
};
