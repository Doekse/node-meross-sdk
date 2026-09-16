import type { EnrollBoardContext, EnrollBoardExtraInput, TraitAttachArgs } from '../device/enroll-context';
import type { TraitName } from '../endpoint';
import type { AbilityMap } from '../protocol/codecs/ability';
import {
    DND_MODE_NAMESPACE,
    decodeDndPush,
    encodeDndSet,
    type MerossMessage
} from '../protocol';
import { SMART_CONFIG, type PollSpec } from '../poll/spec';
import type { DeviceRequest } from '../request';
import type { TraitDescriptor } from './descriptor';

export interface DndValues {
    on?: boolean;
}

/**
 * Transport bind for one device's System.DNDMode surface. Session supplies this;
 * trait tests inject a fake request/emit pair.
 */
export interface DndTraitBind {
    uuid: string;
    request: DeviceRequest;
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

function hasDnd(ability: AbilityMap): boolean {
    return DND_MODE_NAMESPACE in ability;
}

/**
 * Device-wide DND rides channel 0 when some other trait already claimed it.
 */
export function enrollBoardDndExtra(input: EnrollBoardExtraInput): TraitName[] {
    if (
        hasDnd(input.ability)
        && input.channel === 0
        && !input.traits.includes('dnd')
    ) {
        return ['dnd'];
    }
    return [];
}

/** Standalone DND when nothing else claimed channel 0. */
export function enrollDndStandalone(ctx: EnrollBoardContext): void {
    if (hasDnd(ctx.ability) && !ctx.taken.has(0)) {
        ctx.add(0, 'socket', ['dnd']);
    }
}

/** Hub parent carries DND beside system when Ability advertises it. */
export function enrollHubDndExtra(ability: AbilityMap): TraitName[] {
    if (!hasDnd(ability)) {
        return [];
    }
    return ['dnd'];
}

export const DndDescriptor: TraitDescriptor & {
    readonly name: 'dnd';
    attach(args: TraitAttachArgs<DndValues>): DndTrait;
} = {
    name: 'dnd',
    poll: {
        [DND_MODE_NAMESPACE]: { ...SMART_CONFIG, base: 320 }
    } satisfies Record<string, PollSpec>,
    attach(args: TraitAttachArgs<DndValues>): DndTrait {
        return new DndTrait({
            uuid: args.physical.uuid,
            request: args.request,
            // Trait bind stays boolean; Endpoint change carries DndValues.
            emitChange: (on: boolean): void => args.emitChange({ on })
        });
    }
};
