import type { EnrollBoardContext, TraitAttachArgs } from '../device/enroll-context';
import { enrollDigest } from '../device/enroll-helpers';
import {
    SPRAY_NAMESPACE,
    decodeSprayPush,
    encodeSpraySet,
    type MerossMessage,
    type SprayMode
} from '../protocol';
import {
    DEFAULT,
    type PollSpec
} from '../poll/spec';
import type { DeviceRequest } from '../request';
import { applyPatch } from './patch';
import type { TraitDescriptor } from './descriptor';

export type { SprayMode };

export interface SprayValues {
    mode?: SprayMode;
}

/**
 * Transport + channel bind for one Control.Spray endpoint. Session supplies this;
 * trait tests inject a fake request/emit pair.
 */
export interface SprayTraitBind {
    channel: number;
    request: DeviceRequest;
    emitChange: (values: SprayValues) => void;
}

/**
 * Humidifier spray mode for one enrolled channel. Firmware mode is 0/1/2
 * (off / continuous / intermittent).
 */
export class SprayTrait {
    private readonly bind: SprayTraitBind;
    private last: SprayValues = {};

    constructor(bind: SprayTraitBind) {
        this.bind = bind;
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

/**
 * Digest lists the spray channels; Ability without a digest row still claims
 * channel 0 so leftover ToggleX does not enroll the humidifier as a socket.
 */
export function enrollSpray(ctx: EnrollBoardContext): void {
    enrollDigest(ctx, ctx.all.digest.spray, SPRAY_NAMESPACE, 'humidifier', 'spray');
}

export const SprayDescriptor: TraitDescriptor & {
    readonly name: 'spray';
    attach(args: TraitAttachArgs<SprayValues>): SprayTrait;
} = {
    name: 'spray',
    poll: {
        [SPRAY_NAMESPACE]: {
            ...DEFAULT,
            payload: { dict: 'spray' }
        }
    } satisfies Record<string, PollSpec>,
    attach(args: TraitAttachArgs<SprayValues>): SprayTrait {
        return new SprayTrait({
            channel: args.channel,
            request: args.request,
            emitChange: args.emitChange
        });
    }
};
