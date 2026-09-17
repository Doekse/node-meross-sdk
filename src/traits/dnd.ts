import type { EnrollBoardContext, EnrollBoardExtraInput, TraitAttachArgs } from '../device/enroll-context';
import {
    enrollBoardExtra,
    enrollHubExtra,
    enrollStandalone
} from '../device/enroll-helpers';
import type { TraitName } from '../endpoint';
import type { AbilityMap } from '../protocol/codecs/ability';
import {
    DND_MODE_NAMESPACE,
    decodeDndGetAck,
    decodeDndPush,
    encodeDndGet,
    encodeDndSet,
    type MerossMessage
} from '../protocol';
import { SMART_CONFIG, type PollSpec } from '../poll/spec';
import type { DeviceRequest } from '../request';
import { applyPatch } from './patch';
import type { TraitDescriptor } from './descriptor';

export interface DndValues {
    /** Status LED on. Undefined until poller GETACK or PUSH. */
    on?: boolean;
}

/**
 * Transport bind for one device's System.DNDMode surface. Session supplies this;
 * trait tests inject a fake request/emit pair.
 */
export interface DndTraitBind {
    request: DeviceRequest;
    emitChange: (values: DndValues) => void;
}

/**
 * Device-wide status LED. Firmware DNDMode is inverted in the codec. Not per channel.
 */
export class DndTrait {
    private readonly bind: DndTraitBind;
    private last: DndValues = {};

    constructor(bind: DndTraitBind) {
        this.bind = bind;
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

function hasDnd(ability: AbilityMap): boolean {
    return DND_MODE_NAMESPACE in ability;
}

/**
 * Device-wide DND rides channel 0 when some other trait already claimed it.
 */
export function enrollBoardDndExtra(input: EnrollBoardExtraInput): TraitName[] {
    return enrollBoardExtra(input, hasDnd(input.ability), 'dnd');
}

/** Standalone DND when nothing else claimed channel 0. */
export function enrollDndStandalone(ctx: EnrollBoardContext): void {
    enrollStandalone(ctx, hasDnd(ctx.ability), 'socket', 'dnd');
}

/** Hub parent carries DND beside system when Ability advertises it. */
export function enrollHubDndExtra(ability: AbilityMap): TraitName[] {
    return enrollHubExtra(hasDnd(ability), 'dnd');
}

export const DndDescriptor: TraitDescriptor & {
    readonly name: 'dnd';
    attach(args: TraitAttachArgs<DndValues>): DndTrait;
} = {
    name: 'dnd',
    poll: {
        [DND_MODE_NAMESPACE]: {
            ...SMART_CONFIG,
            payload: { dict: 'DNDMode' },
            base: 320
        }
    } satisfies Record<string, PollSpec>,
    attach(args: TraitAttachArgs<DndValues>): DndTrait {
        return new DndTrait({
            request: args.request,
            emitChange: args.emitChange
        });
    }
};
