import type { EnrollBoardContext, TraitAttachArgs } from '../device/enroll-context';
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
    uuid: string;
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
        const next: SprayValues = {};
        for (const key of Object.keys(patch) as Array<keyof SprayValues>) {
            const value = patch[key];
            if (value === undefined || this.last[key] === value) {
                continue;
            }
            (this.last as Record<string, unknown>)[key] = value;
            (next as Record<string, unknown>)[key] = value;
        }
        if (Object.keys(next).length > 0) {
            this.bind.emitChange(next);
        }
    }
}

/**
 * Digest lists the spray channels; Ability without a digest row still claims
 * channel 0 so leftover ToggleX does not enroll the humidifier as a socket.
 */
export function enrollSpray(ctx: EnrollBoardContext): void {
    if (ctx.all.digest.spray.length > 0) {
        for (const channel of ctx.all.digest.spray) {
            ctx.add(channel, 'humidifier', ['spray']);
        }
        return;
    }
    if (SPRAY_NAMESPACE in ctx.ability) {
        ctx.add(0, 'humidifier', ['spray']);
    }
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
            uuid: args.physical.uuid,
            channel: args.channel,
            request: args.request,
            emitChange: args.emitChange
        });
    }
};
