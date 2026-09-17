/**
 * Shared board-enroll loops. Trait files keep named enroll* exports so
 * device/index call sites stay readable; this file is not a catalog and
 * must not be walked from TRAIT_DESCRIPTORS.
 */
import type { TraitName } from '../endpoint';
import type { ClassHint } from '../inventory';
import type { EnrollBoardContext, EnrollBoardExtraInput } from './enroll-context';

/**
 * Light/fan/spray share digest-list-or-ability-channel-0 so leftover
 * ToggleX cannot steal the endpoint. Diffuser unions two digest arrays;
 * cover skips unwired garage doors; climate/presence have no channel list.
 */
export function enrollDigest(
    ctx: EnrollBoardContext,
    digestChannels: readonly number[],
    namespace: string,
    classHint: ClassHint,
    trait: TraitName
): void {
    if (digestChannels.length > 0) {
        for (const channel of digestChannels) {
            ctx.add(channel, classHint, [trait]);
        }
        return;
    }
    if (namespace in ctx.ability) {
        ctx.add(0, classHint, [trait]);
    }
}

/**
 * Device-wide extras ride whatever already claimed channel 0. System has
 * no ability gate; energy has Electricity vs ElectricityX / cover /
 * parentId rules — those stay at their call sites.
 */
export function enrollBoardExtra(
    input: EnrollBoardExtraInput,
    advertised: boolean,
    trait: TraitName
): TraitName[] {
    if (advertised && input.channel === 0 && !input.traits.includes(trait)) {
        return [trait];
    }
    return [];
}

/**
 * Same extras as a primary endpoint when channel 0 is still free after
 * leftover switch. Media is speaker; dnd/alarm are socket. Hubs do not
 * use this path.
 */
export function enrollStandalone(
    ctx: EnrollBoardContext,
    advertised: boolean,
    classHint: ClassHint,
    trait: TraitName
): void {
    if (advertised && !ctx.taken.has(0)) {
        ctx.add(0, classHint, [trait]);
    }
}

/**
 * Hub parent extras have no channel. Media does not ride hub parents;
 * do not add enrollHubMediaExtra.
 */
export function enrollHubExtra(advertised: boolean, trait: TraitName): TraitName[] {
    if (!advertised) {
        return [];
    }
    return [trait];
}

/**
 * Timer and trigger share socket/light/fan endpoints and skip media.
 * Media extra is pushed first in enrollBoard so extra.includes('media')
 * sees it. Not channel-0-only.
 */
export function enrollBoardTimerTriggerExtra(
    input: EnrollBoardExtraInput,
    advertised: boolean,
    trait: TraitName
): TraitName[] {
    if (!advertised) {
        return [];
    }
    if (input.classHint !== 'socket' && input.classHint !== 'light' && input.classHint !== 'fan') {
        return [];
    }
    if (input.traits.includes(trait)) {
        return [];
    }
    if (input.traits.includes('media') || input.extra.includes('media')) {
        return [];
    }
    return [trait];
}
