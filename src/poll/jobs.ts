import type { TraitName } from '../endpoint';
import {
    ALARM_CONFIG_NAMESPACE,
    ALARM_NAMESPACE,
    CALIBRATION_NAMESPACE,
    COMPRESSOR_DELAY_NAMESPACE,
    CONFIG_OVERTEMP_NAMESPACE,
    CONFIG_SENSOR_ASSOCIATION_NAMESPACE,
    CONFIG_STANDBY_KILLER_NAMESPACE,
    CONTROL_ALARM_NAMESPACE,
    CONTROL_ALERT_CONFIG_NAMESPACE,
    CONTROL_BEEP_NAMESPACE,
    CONTROL_TIMER_NAMESPACE,
    CONTROL_TRIGGER_NAMESPACE,
    CONTROL_WATER_NAMESPACE,
    CONSUMPTIONH_NAMESPACE,
    CONSUMPTIONX_NAMESPACE,
    CTL_RANGE_NAMESPACE,
    DEAD_ZONE_NAMESPACE,
    DEVICE_CFG_NAMESPACE,
    DIFFUSER_LIGHT_NAMESPACE,
    DIFFUSER_SENSOR_NAMESPACE,
    DIFFUSER_SPRAY_NAMESPACE,
    DIGEST_TIMERX_NAMESPACE,
    DIGEST_TRIGGERX_NAMESPACE,
    DND_MODE_NAMESPACE,
    ELECTRICITY_NAMESPACE,
    ELECTRICITYX_NAMESPACE,
    FAN_CONFIG_NAMESPACE,
    FAN_NAMESPACE,
    FILTER_MAINTENANCE_NAMESPACE,
    FROST_NAMESPACE,
    GARAGE_CONFIG_NAMESPACE,
    GARAGE_MULTIPLE_CONFIG_NAMESPACE,
    GARAGE_STATE_NAMESPACE,
    HOLD_ACTION_NAMESPACE,
    HUB_BATTERY_NAMESPACE,
    HUB_MTS100_ADJUST_NAMESPACE,
    HUB_MTS100_ALL_NAMESPACE,
    HUB_MTS100_CONFIG_NAMESPACE,
    HUB_MTS100_MODE_NAMESPACE,
    HUB_MTS100_SCHEDULE_NAMESPACE,
    HUB_MTS100_SCHEDULEB_NAMESPACE,
    HUB_MTS100_SUPERCTL_NAMESPACE,
    HUB_MTS100_TEMPERATURE_NAMESPACE,
    HUB_MTS100_TIMESYNC_NAMESPACE,
    HUB_SENSOR_ADJUST_NAMESPACE,
    HUB_SENSOR_ALERT_NAMESPACE,
    HUB_SENSOR_ALL_NAMESPACE,
    HUB_SENSOR_DOORWINDOW_NAMESPACE,
    HUB_SENSOR_MOTION_NAMESPACE,
    HUB_SENSOR_SMOKE_NAMESPACE,
    HUB_SENSOR_TEMPHUM_NAMESPACE,
    HUB_SENSOR_WATERLEAK_NAMESPACE,
    HUB_SUBDEVICE_VERSION_NAMESPACE,
    HUB_TOGGLEX_NAMESPACE,
    LIGHT_EFFECT_NAMESPACE,
    LIGHT_NAMESPACE,
    MP3_NAMESPACE,
    OVERHEAT_NAMESPACE,
    PHYSICAL_LOCK_NAMESPACE,
    PRESENCE_CONFIG_NAMESPACE,
    SCHEDULE_NAMESPACE,
    SCHEDULEB_NAMESPACE,
    SCREEN_BRIGHTNESS_NAMESPACE,
    SENSOR_LATEST_NAMESPACE,
    SENSOR_LATESTX_NAMESPACE,
    SENSOR_NAMESPACE,
    SHUTTER_ADJUST_NAMESPACE,
    SHUTTER_CONFIG_NAMESPACE,
    SHUTTER_POSITION_NAMESPACE,
    SHUTTER_STATE_NAMESPACE,
    SMOKE_CONFIG_NAMESPACE,
    SPRAY_NAMESPACE,
    SUMMER_MODE_NAMESPACE,
    SYSTEM_ALL_NAMESPACE,
    SYSTEM_DEBUG_NAMESPACE,
    SYSTEM_FIRMWARE_NAMESPACE,
    SYSTEM_HARDWARE_NAMESPACE,
    SYSTEM_POSITION_NAMESPACE,
    SYSTEM_TIME_NAMESPACE,
    TEMP_UNIT_NAMESPACE,
    THERMOSTAT_MODE_NAMESPACE,
    THERMOSTAT_MODEB_NAMESPACE,
    THERMOSTAT_MODEC_NAMESPACE,
    TIMER_NAMESPACE,
    TOGGLE_NAMESPACE,
    TOGGLEX_NAMESPACE,
    WINDOW_OPENED_NAMESPACE
} from '../protocol/namespaces';
import { EMPTY_LIST, EMPTY_PAYLOAD, type MerossPayload } from '../protocol/message';
import type { AbilityMap } from '../protocol/codecs/ability';
import { loadTraitDescriptor } from '../traits/load';
import type { PollJob } from './poller';
import {
    POLL_RESPONSE_HEADER_SIZE,
    type PayloadSpec,
    type PollSpec
} from './spec';

export {
    CLOUDMQTT_PERIOD_MS,
    ENERGY_CLOUD_PERIOD_MS,
    ENERGY_PERIOD_MS,
    HUB_BATTERY_PERIOD_MS,
    POLL_RESPONSE_HEADER_SIZE,
    SENSOR_FAST_CLOUD_PERIOD_MS,
    SENSOR_FAST_PERIOD_MS,
    SENSOR_SLOW_CLOUD_PERIOD_MS,
    SENSOR_SLOW_PERIOD_MS,
    SYSTEM_ALL_PERIOD_MS
} from './spec';

/**
 * Channel, sub-device, and traits used to pack LIST GET payloads.
 * meross_lan `polling_request_channels` is device-scoped; `digestNamespaces` is
 * not on this type (physical-device scoped, already a separate
 * {@link buildPollJobs} argument); `model` is hub chunking (later).
 */
export interface PollTarget {
    readonly channel?: number;
    readonly subDeviceId?: string;
    readonly traits: readonly TraitName[];
}

/**
 * Floor after a truncated-Multiple shrink, and the advertised max when
 * `maxCmdNum * 800` is smaller, so packing cannot collapse below a usable
 * HTTP body.
 */
export const POLL_RESPONSE_SIZE_MIN = 1_000;

/**
 * Ability advertises a command count, not a byte budget; 800 bytes per
 * packed slot is the working estimate.
 */
export const POLL_RESPONSE_SIZE_PER_CMD = 800;

/**
 * Reserve a month of daily ConsumptionX rows before the first GETACK
 * calibrates, so a large history reply cannot crowd live Electricity out
 * of the same HTTP body.
 */
export const CONSUMPTIONX_DEFAULT_DAYS = 30;

interface PollResponseParts {
    readonly base: number;
    readonly item: number;
}

/**
 * Ability `maxCmdNum` is a command count; convert to a byte budget without
 * going below {@link POLL_RESPONSE_SIZE_MIN}, including when the device
 * advertises 0 or 1 commands.
 */
export function getDeviceResponseSizeMax(maxCmdNum: number): number {
    const advertised = maxCmdNum * POLL_RESPONSE_SIZE_PER_CMD;
    return advertised < POLL_RESPONSE_SIZE_MIN ? POLL_RESPONSE_SIZE_MIN : advertised;
}

/**
 * GET schedule keyed by Ability. Values are owning trait names so an
 * unadvertised namespace never loads its trait module. Insertion order is
 * the packed GET order. FilterMaintenance is PUSH-query (GET disconnects
 * MAP100).
 */
export const POLL_LOADERS: Record<string, TraitName> = {
    [SYSTEM_ALL_NAMESPACE]: 'system',
    'Appliance.System.Runtime': 'system',
    [SYSTEM_FIRMWARE_NAMESPACE]: 'system',
    [SYSTEM_HARDWARE_NAMESPACE]: 'system',
    [SYSTEM_TIME_NAMESPACE]: 'system',
    [SYSTEM_POSITION_NAMESPACE]: 'system',
    [SYSTEM_DEBUG_NAMESPACE]: 'system',
    [CONFIG_OVERTEMP_NAMESPACE]: 'overtemp',
    [CONFIG_SENSOR_ASSOCIATION_NAMESPACE]: 'sensor',
    [CONTROL_ALERT_CONFIG_NAMESPACE]: 'alert',
    [CONFIG_STANDBY_KILLER_NAMESPACE]: 'standbykiller',

    // Digest / device state
    [TOGGLEX_NAMESPACE]: 'switch',
    [TOGGLE_NAMESPACE]: 'switch',
    [LIGHT_NAMESPACE]: 'light',
    [SPRAY_NAMESPACE]: 'spray',
    [FAN_NAMESPACE]: 'fan',
    [MP3_NAMESPACE]: 'media',
    [DIFFUSER_LIGHT_NAMESPACE]: 'diffuser',
    [DIFFUSER_SPRAY_NAMESPACE]: 'diffuser',
    [GARAGE_STATE_NAMESPACE]: 'cover',
    [GARAGE_CONFIG_NAMESPACE]: 'cover',
    [GARAGE_MULTIPLE_CONFIG_NAMESPACE]: 'cover',
    [SHUTTER_POSITION_NAMESPACE]: 'cover',
    [SHUTTER_STATE_NAMESPACE]: 'cover',
    [SHUTTER_CONFIG_NAMESPACE]: 'cover',
    [SHUTTER_ADJUST_NAMESPACE]: 'cover',
    [CONTROL_ALARM_NAMESPACE]: 'alarm',
    [CONTROL_BEEP_NAMESPACE]: 'alarm',
    [HUB_TOGGLEX_NAMESPACE]: 'switch',

    // Config / slow sensors
    [LIGHT_EFFECT_NAMESPACE]: 'light',
    [FAN_CONFIG_NAMESPACE]: 'fan',
    [FILTER_MAINTENANCE_NAMESPACE]: 'fan',
    [DIFFUSER_SENSOR_NAMESPACE]: 'diffuser',
    [DND_MODE_NAMESPACE]: 'dnd',
    [PRESENCE_CONFIG_NAMESPACE]: 'presence',

    // Energy / fast sensors
    [ELECTRICITY_NAMESPACE]: 'energy',
    [ELECTRICITYX_NAMESPACE]: 'energy',
    [CONSUMPTIONX_NAMESPACE]: 'energy',
    [CONSUMPTIONH_NAMESPACE]: 'energy',
    [SENSOR_LATESTX_NAMESPACE]: 'presence',
    [SENSOR_LATEST_NAMESPACE]: 'climate',

    // Timer / trigger indexes (X) and legacy full-list GETs (pre-X)
    [DIGEST_TIMERX_NAMESPACE]: 'timer',
    [DIGEST_TRIGGERX_NAMESPACE]: 'trigger',
    [CONTROL_TIMER_NAMESPACE]: 'timer',
    [CONTROL_TRIGGER_NAMESPACE]: 'trigger',

    // Board climate
    [THERMOSTAT_MODE_NAMESPACE]: 'climate',
    [THERMOSTAT_MODEB_NAMESPACE]: 'climate',
    [THERMOSTAT_MODEC_NAMESPACE]: 'climate',
    [TIMER_NAMESPACE]: 'climate',
    [ALARM_NAMESPACE]: 'climate',
    [HOLD_ACTION_NAMESPACE]: 'climate',
    [WINDOW_OPENED_NAMESPACE]: 'climate',
    [SENSOR_NAMESPACE]: 'climate',
    [CALIBRATION_NAMESPACE]: 'climate',
    [DEAD_ZONE_NAMESPACE]: 'climate',
    [SUMMER_MODE_NAMESPACE]: 'climate',
    [COMPRESSOR_DELAY_NAMESPACE]: 'climate',
    [ALARM_CONFIG_NAMESPACE]: 'climate',
    [SCHEDULE_NAMESPACE]: 'climate',
    [SCHEDULEB_NAMESPACE]: 'climate',
    [TEMP_UNIT_NAMESPACE]: 'climate',
    [SCREEN_BRIGHTNESS_NAMESPACE]: 'climate',
    [PHYSICAL_LOCK_NAMESPACE]: 'climate',
    [FROST_NAMESPACE]: 'climate',
    [OVERHEAT_NAMESPACE]: 'climate',
    [CTL_RANGE_NAMESPACE]: 'climate',

    // Hub climate
    [HUB_MTS100_ALL_NAMESPACE]: 'climate',
    [HUB_MTS100_MODE_NAMESPACE]: 'climate',
    [HUB_MTS100_TEMPERATURE_NAMESPACE]: 'climate',
    [HUB_MTS100_ADJUST_NAMESPACE]: 'climate',
    [HUB_MTS100_CONFIG_NAMESPACE]: 'climate',
    [HUB_MTS100_SUPERCTL_NAMESPACE]: 'climate',
    [HUB_MTS100_TIMESYNC_NAMESPACE]: 'climate',
    [HUB_MTS100_SCHEDULE_NAMESPACE]: 'climate',
    [HUB_MTS100_SCHEDULEB_NAMESPACE]: 'climate',

    // Hub sensors / sprinkler
    [HUB_SENSOR_ALL_NAMESPACE]: 'sensor',
    [HUB_SENSOR_TEMPHUM_NAMESPACE]: 'sensor',
    [HUB_SENSOR_DOORWINDOW_NAMESPACE]: 'sensor',
    [HUB_SENSOR_WATERLEAK_NAMESPACE]: 'sensor',
    [HUB_SENSOR_MOTION_NAMESPACE]: 'sensor',
    [HUB_SENSOR_SMOKE_NAMESPACE]: 'sensor',
    [HUB_BATTERY_NAMESPACE]: 'sensor',
    [HUB_SUBDEVICE_VERSION_NAMESPACE]: 'switch',
    [HUB_SENSOR_ADJUST_NAMESPACE]: 'sensor',
    [HUB_SENSOR_ALERT_NAMESPACE]: 'sensor',
    [SMOKE_CONFIG_NAMESPACE]: 'sensor',
    [CONTROL_WATER_NAMESPACE]: 'sprinkler',
    [DEVICE_CFG_NAMESPACE]: 'sprinkler'
};

/**
 * Lazily resolves a poll row. Unknown namespaces stay undefined without
 * loading a trait module.
 */
export function pollSpec(namespace: string): PollSpec | undefined {
    const trait = POLL_LOADERS[namespace];
    if (trait === undefined) {
        return undefined;
    }
    return loadTraitDescriptor(trait).poll[namespace];
}

/**
 * Table lookup used by packing. Missing rows still charge the Multiple
 * envelope rather than packing as free.
 */
export function getResponseSizeParts(namespace: string): PollResponseParts {
    const spec = pollSpec(namespace);
    return {
        base: spec?.base ?? POLL_RESPONSE_HEADER_SIZE,
        item: spec?.item ?? 0
    };
}

function getPayloadItemCount(payload: MerossPayload): number {
    for (const value of Object.values(payload)) {
        if (Array.isArray(value)) {
            return value.length;
        }
    }
    return 1;
}

/**
 * Estimated GETACK bytes so packing can refuse a sub-GET that would overflow
 * the HTTP body. ConsumptionX without a list still reserves
 * {@link CONSUMPTIONX_DEFAULT_DAYS}.
 */
export function estimateResponseSize(
    namespace: string,
    payload: MerossPayload = EMPTY_PAYLOAD
): number {
    const { base, item } = getResponseSizeParts(namespace);
    if (item === 0) {
        return base;
    }
    // Avoid importing consumptionx.ts; a missing list still reserves a month.
    if (namespace === CONSUMPTIONX_NAMESPACE && !Array.isArray(payload.consumptionx)) {
        return base + item * CONSUMPTIONX_DEFAULT_DAYS;
    }
    return base + item * Math.max(getPayloadItemCount(payload), 1);
}

/**
 * Builds the device poll table from Ability. LIST payloads come from enrolled
 * endpoints so a strip or hub issues one GET per namespace. Unadvertised
 * namespaces never load their trait module.
 */
export function buildPollJobs(
    ability: AbilityMap,
    endpoints: readonly PollTarget[],
    digestNamespaces?: ReadonlySet<string>
): PollJob[] {
    const jobs: PollJob[] = [];
    for (const [namespace, trait] of Object.entries(POLL_LOADERS)) {
        if (!(namespace in ability)) {
            continue;
        }
        const spec = loadTraitDescriptor(trait).poll[namespace];
        if (spec === undefined) {
            continue;
        }
        if (spec.skipIf !== undefined && spec.skipIf in ability) {
            continue;
        }
        const inDigest = digestNamespaces?.has(namespace);
        jobs.push({
            namespace,
            strategy: inDigest ? 'digest' : spec.strategy,
            periodMs: inDigest ? 0 : spec.periodMs,
            periodCloudMs: spec.periodCloudMs,
            payload: spec.payload ? encodePayload(spec.payload, endpoints) : EMPTY_PAYLOAD,
            ...(spec.method ? { method: spec.method } : {}),
            ...(spec.calibrate ? { calibrate: spec.calibrate } : {})
        });
    }
    return jobs;
}

function encodePayload(spec: PayloadSpec, endpoints: readonly PollTarget[]): MerossPayload {
    if ('dict' in spec) {
        return {
            [spec.dict]: spec.channel === undefined ? EMPTY_PAYLOAD : { channel: spec.channel }
        };
    }
    return { [spec.list]: encodeList(spec, endpoints) };
}

function encodeList(
    spec: Extract<PayloadSpec, { list: string }>,
    endpoints: readonly PollTarget[]
): readonly unknown[] {
    if (spec.by === undefined) {
        return EMPTY_LIST;
    }

    const trait = spec.for;
    const picked = trait === undefined
        ? [...endpoints]
        : endpoints.filter((endpoint) => endpoint.traits.includes(trait));
    const withId = picked.filter((endpoint) => endpoint.subDeviceId);
    const withChannel = picked.filter((endpoint) => endpoint.channel !== undefined);

    switch (spec.by) {
        case 'id':
            return withId.map((endpoint) => ({ id: endpoint.subDeviceId }));
        case 'subId':
            return withId.map((endpoint) => ({
                subId: endpoint.subDeviceId,
                channel: 0
            }));
        case 'either':
            if (withId.length > 0) {
                const hub = spec.dataId ? preferTrait(withId, 'sensor') : withId;
                return hub.map((endpoint) => ({
                    channel: 0,
                    subId: endpoint.subDeviceId,
                    ...(spec.dataId ? { data: spec.dataId } : {})
                }));
            }
            return encodeChannelItems(spec, withChannel);
        case 'channel':
            return encodeChannelItems(spec, withChannel);
        default: {
            const _exhaustive: never = spec.by;
            return _exhaustive;
        }
    }
}

/** Board-channel LIST rows; shared by `channel` and hub-less `either`. */
function encodeChannelItems(
    spec: Extract<PayloadSpec, { list: string }>,
    endpoints: readonly PollTarget[]
): unknown[] {
    const targets = spec.data ? preferTrait(endpoints, 'presence') : endpoints;
    return targets.map((endpoint) => ({
        channel: endpoint.channel,
        ...(spec.data ? { data: spec.data } : {})
    }));
}

/**
 * LatestX is shared by MS600 (presence) and MS130 (hub sensor). Prefer the
 * matching trait so a mixed hub does not GET LatestX for MTS100 children.
 */
function preferTrait(
    endpoints: readonly PollTarget[],
    trait: TraitName
): PollTarget[] {
    const matched = endpoints.filter((endpoint) => endpoint.traits.includes(trait));
    return matched.length > 0 ? matched : [...endpoints];
}
