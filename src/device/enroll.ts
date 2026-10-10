/**
 * Which endpoints a board or hub gets. Kept off the trait class modules so
 * enroll does not load those classes, and so their published `.d.ts` is
 * only the host class.
 */
import type { TraitName } from './endpoint';
import type { AbilityMap } from '../protocol/codecs/ability';
import {
    CONFIG_OVERTEMP_NAMESPACE,
    CONFIG_STANDBY_KILLER_NAMESPACE,
    CONSUMPTIONH_NAMESPACE,
    CONSUMPTIONX_NAMESPACE,
    CONTROL_ALARM_NAMESPACE,
    CONTROL_ALERT_CONFIG_NAMESPACE,
    CONTROL_BEEP_NAMESPACE,
    CONTROL_TIMER_NAMESPACE,
    CONTROL_TRIGGER_NAMESPACE,
    DIFFUSER_LIGHT_NAMESPACE,
    DIFFUSER_SPRAY_NAMESPACE,
    DND_MODE_NAMESPACE,
    ELECTRICITY_NAMESPACE,
    ELECTRICITYX_NAMESPACE,
    FAN_NAMESPACE,
    GARAGE_STATE_NAMESPACE,
    LIGHT_NAMESPACE,
    MP3_NAMESPACE,
    PRESENCE_CONFIG_NAMESPACE,
    PRESENCE_STUDY_NAMESPACE,
    SHUTTER_STATE_NAMESPACE,
    SPRAY_NAMESPACE,
    THERMOSTAT_MODE_NAMESPACE,
    THERMOSTAT_MODEB_NAMESPACE,
    THERMOSTAT_MODEC_NAMESPACE,
    TIMERX_NAMESPACE,
    TOGGLE_NAMESPACE,
    TOGGLEX_NAMESPACE,
    TRIGGERX_NAMESPACE
} from '../protocol/namespaces';
import type { EnrolledEndpoint } from './index';
import type { EnrollBoardContext, EnrollBoardExtraInput } from './enroll-context';
import {
    enrollBoardExtra,
    enrollBoardTimerTriggerExtra,
    enrollDigest,
    enrollHubExtra,
    enrollStandalone
} from './enroll-helpers';

/**
 * Digest lists the bulbs; Ability without a digest row still claims channel 0
 * so leftover ToggleX does not enroll the bulb as a socket.
 */
export function enrollLight(ctx: EnrollBoardContext): void {
    enrollDigest(ctx, channels(ctx.all.digest.light), LIGHT_NAMESPACE, 'light', 'light');
}

/**
 * Garage digest wins so unwired doors can be claimed without an endpoint
 * (ToggleX leftover would otherwise re-add them as sockets). Shutter digest
 * and Ability fallback only run when there is no garage digest.
 */
export function enrollCover(ctx: EnrollBoardContext): void {
    if (ctx.all.digest.garageDoor.length > 0) {
        // Seed open/closed from the digest so hosts have state before the first
        // PUSH or poll; on cloud MQTT that poll can be ~20 minutes away.
        // Channels the installer never wired report doorEnable 0 and are not
        // user-visible devices, so they are skipped (MSG200 ships three doors).
        for (const door of ctx.all.digest.garageDoor) {
            if (door.doorEnable === false) {
                // Claim the channel without creating an endpoint, so the
                // ToggleX leftover pass does not re-add the disabled door as a
                // plain socket.
                ctx.taken.add(door.channel);
                continue;
            }
            ctx.add(door.channel, 'cover', ['cover'], door.open);
        }
        return;
    }
    if (ctx.all.digest.rollerShutter.length > 0) {
        for (const channel of ctx.all.digest.rollerShutter) {
            ctx.add(channel, 'cover', ['cover']);
        }
        return;
    }
    if (GARAGE_STATE_NAMESPACE in ctx.ability || SHUTTER_STATE_NAMESPACE in ctx.ability) {
        ctx.add(0, 'cover', ['cover']);
    }
}

/**
 * Board thermostats claim channel 0 from Ability Mode/ModeB/ModeC or digest
 * so leftover ToggleX does not enroll them as sockets.
 */
export function enrollClimate(ctx: EnrollBoardContext): void {
    if (
        THERMOSTAT_MODE_NAMESPACE in ctx.ability
        || THERMOSTAT_MODEB_NAMESPACE in ctx.ability
        || THERMOSTAT_MODEC_NAMESPACE in ctx.ability
        || ctx.all.digest.thermostat
    ) {
        ctx.add(0, 'climate', ['climate']);
    }
}

/**
 * MS600 has no digest channel list for presence; Ability Config/Study is the
 * claim so leftover ToggleX does not enroll it as a socket.
 */
export function enrollPresence(ctx: EnrollBoardContext): void {
    if (PRESENCE_CONFIG_NAMESPACE in ctx.ability || PRESENCE_STUDY_NAMESPACE in ctx.ability) {
        ctx.add(0, 'sensor', ['presence']);
    }
}

/**
 * Light and spray digest arrays may name different channels on one board.
 * Ability without digest rows still claims channel 0 so leftover ToggleX
 * does not enroll the diffuser as a socket.
 */
export function enrollDiffuser(ctx: EnrollBoardContext): void {
    const digest = ctx.all.digest.diffuser;
    const claimed = new Set<number>([
        ...channels(digest?.light ?? []),
        ...channels(digest?.spray ?? [])
    ]);
    const advertised = DIFFUSER_LIGHT_NAMESPACE in ctx.ability
        || DIFFUSER_SPRAY_NAMESPACE in ctx.ability;
    if (claimed.size === 0 && advertised) {
        claimed.add(0);
    }
    for (const channel of claimed) {
        ctx.add(channel, 'humidifier', ['diffuser']);
    }
}

/**
 * Digest lists the spray channels; Ability without a digest row still claims
 * channel 0 so leftover ToggleX does not enroll the humidifier as a socket.
 */
export function enrollSpray(ctx: EnrollBoardContext): void {
    enrollDigest(ctx, channels(ctx.all.digest.spray), SPRAY_NAMESPACE, 'humidifier', 'spray');
}

/**
 * Digest lists the fan channels; Ability without a digest row still claims
 * channel 0 so leftover ToggleX does not enroll the fan as a socket.
 */
export function enrollFan(ctx: EnrollBoardContext): void {
    enrollDigest(ctx, channels(ctx.all.digest.fan), FAN_NAMESPACE, 'fan', 'fan');
}

/**
 * Leftover Toggle / ToggleX after light / cover / fan / … claimed theirs.
 * Cloud fallback is by array index (not channel fields); MSG200 drops
 * channel 0 when any garage door is non-zero; strip parentId is applied after
 * that filter. Taken-set skips already-claimed channels — do not subtract
 * light/fan/garage here or filter doorEnable (cover already claimed).
 */
export function enrollSwitchLeftover(ctx: EnrollBoardContext): void {
    let toggles = ctx.all.digest.togglex;
    if (toggles.length === 0 && ctx.cloud?.channels?.length) {
        toggles = ctx.cloud.channels.map((_, channel) => ({ channel }));
    }
    if (
        toggles.length === 0
        && (TOGGLEX_NAMESPACE in ctx.ability || TOGGLE_NAMESPACE in ctx.ability)
    ) {
        toggles = [{ channel: 0 }];
    }
    if (ctx.all.digest.garageDoor.some((door) => door.channel !== 0)) {
        toggles = toggles.filter((entry) => entry.channel !== 0);
    }
    const masterId = `${ctx.uuid}:0`;
    const isStrip = toggles.length >= 3 && toggles.some((entry) => entry.channel === 0);
    ctx.strip = isStrip;
    for (const entry of toggles) {
        ctx.add(
            entry.channel,
            'socket',
            ['switch'],
            entry.on,
            isStrip && entry.channel !== 0 ? masterId : undefined
        );
    }
}

/**
 * Unknown hub digest type with onoff — enroll as a switch. Builds the child
 * endpoint when classifyHubChild has no model; omit when onoff is absent.
 */
export function enrollHubUntypedOnoff(input: {
    readonly uuid: string;
    readonly subDeviceId: string;
    readonly name?: string;
    readonly model?: string;
    readonly online: boolean;
    readonly on?: boolean;
}): EnrolledEndpoint | undefined {
    if (input.on === undefined) {
        return undefined;
    }
    return {
        id: `${input.uuid}#${input.subDeviceId}`,
        uuid: input.uuid,
        subDeviceId: input.subDeviceId,
        parentId: input.uuid,
        name: input.name || input.subDeviceId,
        model: input.model || input.subDeviceId,
        classHint: 'socket',
        traits: ['switch'],
        online: input.online,
        on: input.on
    };
}

/**
 * A strip's channel 0 switches every outlet, so a per-outlet ElectricityX
 * meter does not belong there. Returning before the board-meter check keeps
 * ConsumptionH from enrolling that channel, which has no electricity sample.
 * Firmware also copies a classic board meter onto every channel, so that
 * reading stays on the master or each outlet would count it again.
 */
export function enrollBoardEnergyExtra(input: EnrollBoardExtraInput): TraitName[] {
    if (
        ELECTRICITYX_NAMESPACE in input.ability
        && input.classHint === 'socket'
    ) {
        if (input.strip && input.channel === 0) {
            return [];
        }
        return ['energy'];
    }
    const hasBoardMeter = ELECTRICITY_NAMESPACE in input.ability
        || CONSUMPTIONX_NAMESPACE in input.ability
        || CONSUMPTIONH_NAMESPACE in input.ability;
    if (hasBoardMeter && input.classHint !== 'cover' && input.parentId === undefined) {
        return ['energy'];
    }
    return [];
}

/**
 * Mp3 rides channel 0 when some other trait already claimed it.
 */
export function enrollBoardMediaExtra(input: EnrollBoardExtraInput): TraitName[] {
    return enrollBoardExtra(input, MP3_NAMESPACE in input.ability, 'media');
}

/**
 * Standalone speaker when nothing else claimed channel 0.
 */
export function enrollMediaStandalone(ctx: EnrollBoardContext): void {
    enrollStandalone(ctx, MP3_NAMESPACE in ctx.ability, 'speaker', 'media');
}

/**
 * Device-wide DND rides channel 0 when some other trait already claimed it.
 */
export function enrollBoardDndExtra(input: EnrollBoardExtraInput): TraitName[] {
    return enrollBoardExtra(input, DND_MODE_NAMESPACE in input.ability, 'dnd');
}

/**
 * Standalone DND when nothing else claimed channel 0.
 */
export function enrollDndStandalone(ctx: EnrollBoardContext): void {
    enrollStandalone(ctx, DND_MODE_NAMESPACE in ctx.ability, 'socket', 'dnd');
}

/**
 * Hub parent carries DND beside system when Ability advertises it.
 */
export function enrollHubDndExtra(ability: AbilityMap): TraitName[] {
    return enrollHubExtra(DND_MODE_NAMESPACE in ability, 'dnd');
}

/**
 * Device-wide OverTemp rides channel 0 when some other trait already claimed it.
 */
export function enrollBoardOverTempExtra(input: EnrollBoardExtraInput): TraitName[] {
    return enrollBoardExtra(input, CONFIG_OVERTEMP_NAMESPACE in input.ability, 'overtemp');
}

/**
 * Standalone OverTemp when nothing else claimed channel 0.
 */
export function enrollOverTempStandalone(ctx: EnrollBoardContext): void {
    enrollStandalone(ctx, CONFIG_OVERTEMP_NAMESPACE in ctx.ability, 'socket', 'overtemp');
}

/**
 * Hub parent carries OverTemp beside system when Ability advertises Config.
 */
export function enrollHubOverTempExtra(ability: AbilityMap): TraitName[] {
    return enrollHubExtra(CONFIG_OVERTEMP_NAMESPACE in ability, 'overtemp');
}

/**
 * Per-channel AlertConfig on socket and climate endpoints (not hub children,
 * not channel-0-only). Config is the gate; AlertReport is push-only.
 */
export function enrollBoardAlertExtra(input: EnrollBoardExtraInput): TraitName[] {
    if (!(CONTROL_ALERT_CONFIG_NAMESPACE in input.ability)) {
        return [];
    }
    if (input.classHint !== 'socket' && input.classHint !== 'climate') {
        return [];
    }
    if (input.traits.includes('alert')) {
        return [];
    }
    return ['alert'];
}

/**
 * Per-channel StandbyKiller on socket endpoints (not hub, not climate).
 * A strip's channel 0 switches every outlet, so the cutoff stays on each outlet.
 */
export function enrollBoardStandbyKillerExtra(input: EnrollBoardExtraInput): TraitName[] {
    if (
        CONFIG_STANDBY_KILLER_NAMESPACE in input.ability
        && input.classHint === 'socket'
    ) {
        if (input.strip && input.channel === 0) {
            return [];
        }
        if (input.traits.includes('standbykiller')) {
            return [];
        }
        return ['standbykiller'];
    }
    return [];
}

function hasAlarm(ability: AbilityMap): boolean {
    return CONTROL_ALARM_NAMESPACE in ability || CONTROL_BEEP_NAMESPACE in ability;
}

/**
 * Hub / board siren rides channel 0 when some other trait already claimed it.
 */
export function enrollBoardAlarmExtra(input: EnrollBoardExtraInput): TraitName[] {
    return enrollBoardExtra(input, hasAlarm(input.ability), 'alarm');
}

/**
 * Standalone alarm when nothing else claimed channel 0.
 */
export function enrollAlarmStandalone(ctx: EnrollBoardContext): void {
    enrollStandalone(ctx, hasAlarm(ctx.ability), 'socket', 'alarm');
}

/**
 * Hub parent carries alarm beside system when Ability advertises it.
 */
export function enrollHubAlarmExtra(ability: AbilityMap): TraitName[] {
    return enrollHubExtra(hasAlarm(ability), 'alarm');
}

/**
 * Channel-0 / hub-root diagnostics. Enroll only as an extra — hubs seed
 * `'system'` on the parent row directly.
 */
export function enrollBoardSystemExtra(input: EnrollBoardExtraInput): TraitName[] {
    if (input.channel === 0 && !input.traits.includes('system')) {
        return ['system'];
    }
    return [];
}

/**
 * Toggle-shaped Timer/TimerX only; cover/climate/humidifier/speaker use other
 * extend objects. Skip when media already claimed the endpoint.
 */
export function enrollBoardTimerExtra(input: EnrollBoardExtraInput): TraitName[] {
    const advertised = TIMERX_NAMESPACE in input.ability
        || CONTROL_TIMER_NAMESPACE in input.ability;
    return enrollBoardTimerTriggerExtra(input, advertised, 'timer');
}

/**
 * Same board endpoints as timer (socket/light/fan); skip media speakers.
 */
export function enrollBoardTriggerExtra(input: EnrollBoardExtraInput): TraitName[] {
    const advertised = TRIGGERX_NAMESPACE in input.ability
        || CONTROL_TRIGGER_NAMESPACE in input.ability;
    return enrollBoardTimerTriggerExtra(input, advertised, 'trigger');
}

/**
 * Enrollment claims channels. Digest rows now carry the rest of the state,
 * which enroll itself does not read.
 */
function channels(rows: readonly { channel: number }[]): number[] {
    return rows.map((row) => row.channel);
}
