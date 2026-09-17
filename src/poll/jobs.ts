import type { TraitName } from '../endpoint';
import {
    ALARM_CONFIG_NAMESPACE,
    ALARM_NAMESPACE,
    CALIBRATION_NAMESPACE,
    COMPRESSOR_DELAY_NAMESPACE,
    CTL_RANGE_NAMESPACE,
    DEAD_ZONE_NAMESPACE,
    FROST_NAMESPACE,
    HOLD_ACTION_NAMESPACE,
    HUB_MTS100_ADJUST_NAMESPACE,
    HUB_MTS100_ALL_NAMESPACE,
    HUB_MTS100_CONFIG_NAMESPACE,
    HUB_MTS100_MODE_NAMESPACE,
    HUB_MTS100_SCHEDULE_NAMESPACE,
    HUB_MTS100_SCHEDULEB_NAMESPACE,
    HUB_MTS100_SUPERCTL_NAMESPACE,
    HUB_MTS100_TEMPERATURE_NAMESPACE,
    HUB_MTS100_TIMESYNC_NAMESPACE,
    HUB_TOGGLEX_NAMESPACE,
    OVERHEAT_NAMESPACE,
    PHYSICAL_LOCK_NAMESPACE,
    SCHEDULE_NAMESPACE,
    SCHEDULEB_NAMESPACE,
    SCREEN_BRIGHTNESS_NAMESPACE,
    SENSOR_NAMESPACE,
    SUMMER_MODE_NAMESPACE,
    TEMP_UNIT_NAMESPACE,
    THERMOSTAT_MODE_NAMESPACE,
    THERMOSTAT_MODEB_NAMESPACE,
    THERMOSTAT_MODEC_NAMESPACE,
    TIMER_NAMESPACE,
    WINDOW_OPENED_NAMESPACE
} from '../protocol/codecs/climate';
import { CONTROL_ALARM_NAMESPACE, CONTROL_BEEP_NAMESPACE } from '../protocol/codecs/alarm';
import { CONSUMPTIONH_NAMESPACE } from '../protocol/codecs/consumptionh';
import { CONSUMPTIONX_NAMESPACE, consumptionXDays } from '../protocol/codecs/consumptionx';
import {
    GARAGE_CONFIG_NAMESPACE,
    GARAGE_MULTIPLE_CONFIG_NAMESPACE,
    GARAGE_STATE_NAMESPACE,
    SHUTTER_ADJUST_NAMESPACE,
    SHUTTER_CONFIG_NAMESPACE,
    SHUTTER_POSITION_NAMESPACE,
    SHUTTER_STATE_NAMESPACE
} from '../protocol/codecs/cover';
import {
    DIFFUSER_LIGHT_NAMESPACE,
    DIFFUSER_SENSOR_NAMESPACE,
    DIFFUSER_SPRAY_NAMESPACE
} from '../protocol/codecs/diffuser';
import { DND_MODE_NAMESPACE } from '../protocol/codecs/dnd';
import {
    ELECTRICITY_NAMESPACE,
    ELECTRICITYX_NAMESPACE
} from '../protocol/codecs/electricity';
import { FAN_CONFIG_NAMESPACE, FAN_NAMESPACE, FILTER_MAINTENANCE_NAMESPACE } from '../protocol/codecs/fan';
import { LIGHT_EFFECT_NAMESPACE, LIGHT_NAMESPACE } from '../protocol/codecs/light';
import { MP3_NAMESPACE } from '../protocol/codecs/mp3';
import {
    CONTROL_ALERT_CONFIG_NAMESPACE
} from '../protocol/codecs/alertconfig';
import {
    CONFIG_OVERTEMP_NAMESPACE
} from '../protocol/codecs/overtemp';
import { CONFIG_STANDBY_KILLER_NAMESPACE } from '../protocol/codecs/standbykiller';
import { PRESENCE_CONFIG_NAMESPACE } from '../protocol/codecs/presence';
import {
    CONFIG_SENSOR_ASSOCIATION_NAMESPACE,
    HUB_BATTERY_NAMESPACE,
    HUB_SENSOR_ADJUST_NAMESPACE,
    HUB_SENSOR_ALERT_NAMESPACE,
    HUB_SENSOR_ALL_NAMESPACE,
    HUB_SENSOR_DOORWINDOW_NAMESPACE,
    HUB_SENSOR_MOTION_NAMESPACE,
    HUB_SENSOR_SMOKE_NAMESPACE,
    HUB_SENSOR_TEMPHUM_NAMESPACE,
    HUB_SENSOR_WATERLEAK_NAMESPACE,
    HUB_SUBDEVICE_VERSION_NAMESPACE,
    SENSOR_LATEST_NAMESPACE,
    SENSOR_LATESTX_NAMESPACE,
    SMOKE_CONFIG_NAMESPACE
} from '../protocol/codecs/sensor';
import { SPRAY_NAMESPACE } from '../protocol/codecs/spray';
import {
    SYSTEM_DEBUG_NAMESPACE,
    SYSTEM_FIRMWARE_NAMESPACE,
    SYSTEM_HARDWARE_NAMESPACE,
    SYSTEM_POSITION_NAMESPACE,
    SYSTEM_TIME_NAMESPACE
} from '../protocol/codecs/system';
import {
    CONTROL_TIMER_NAMESPACE,
    DIGEST_TIMERX_NAMESPACE
} from '../protocol/codecs/timerx';
import { TOGGLEX_NAMESPACE } from '../protocol/codecs/togglex';
import {
    CONTROL_TRIGGER_NAMESPACE,
    DIGEST_TRIGGERX_NAMESPACE
} from '../protocol/codecs/triggerx';
import { CONTROL_WATER_NAMESPACE, DEVICE_CFG_NAMESPACE } from '../protocol/codecs/water';
import type { MerossPayload } from '../protocol/message';
import type { AbilityMap } from '../protocol/codecs/ability';
import { AlarmDescriptor } from '../traits/alarm';
import { AlertDescriptor } from '../traits/alert';
import { ClimateDescriptor } from '../traits/climate';
import { CoverDescriptor } from '../traits/cover';
import { DiffuserDescriptor } from '../traits/diffuser';
import { DndDescriptor } from '../traits/dnd';
import { EnergyDescriptor } from '../traits/energy';
import { FanDescriptor } from '../traits/fan';
import { LightDescriptor } from '../traits/light';
import { MediaDescriptor } from '../traits/media';
import { OverTempDescriptor } from '../traits/overtemp';
import { PresenceDescriptor } from '../traits/presence';
import { SensorDescriptor } from '../traits/sensor';
import { SprayDescriptor } from '../traits/spray';
import { SprinklerDescriptor } from '../traits/sprinkler';
import { SwitchDescriptor, TOGGLE_NAMESPACE } from '../traits/switch';
import { SystemDescriptor } from '../traits/system';
import { TimerDescriptor } from '../traits/timer';
import { TriggerDescriptor } from '../traits/trigger';
import type { PollJob } from './poller';
import { SYSTEM_ALL_NAMESPACE } from '../protocol/codecs/system-all';
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
 * GET schedule keyed by Ability. Unadvertised namespaces stay off the wire.
 * FilterMaintenance is PUSH-query (GET disconnects MAP100).
 * `base`/`item` live here so packing does not keep a second per-namespace table.
 * Assembled from trait descriptors; not re-exported from the poll barrel.
 */
export const POLL: Record<string, PollSpec> = {
    [SYSTEM_ALL_NAMESPACE]: SystemDescriptor.poll[SYSTEM_ALL_NAMESPACE],
    'Appliance.System.Runtime': SystemDescriptor.poll['Appliance.System.Runtime'],
    [SYSTEM_FIRMWARE_NAMESPACE]: SystemDescriptor.poll[SYSTEM_FIRMWARE_NAMESPACE],
    [SYSTEM_HARDWARE_NAMESPACE]: SystemDescriptor.poll[SYSTEM_HARDWARE_NAMESPACE],
    [SYSTEM_TIME_NAMESPACE]: SystemDescriptor.poll[SYSTEM_TIME_NAMESPACE],
    [SYSTEM_POSITION_NAMESPACE]: SystemDescriptor.poll[SYSTEM_POSITION_NAMESPACE],
    [SYSTEM_DEBUG_NAMESPACE]: SystemDescriptor.poll[SYSTEM_DEBUG_NAMESPACE],
    [CONFIG_OVERTEMP_NAMESPACE]: OverTempDescriptor.poll[CONFIG_OVERTEMP_NAMESPACE],
    [CONFIG_SENSOR_ASSOCIATION_NAMESPACE]: SensorDescriptor.poll[CONFIG_SENSOR_ASSOCIATION_NAMESPACE],
    [CONTROL_ALERT_CONFIG_NAMESPACE]: AlertDescriptor.poll[CONTROL_ALERT_CONFIG_NAMESPACE],
    [CONFIG_STANDBY_KILLER_NAMESPACE]: EnergyDescriptor.poll[CONFIG_STANDBY_KILLER_NAMESPACE],

    // Digest / device state
    [TOGGLEX_NAMESPACE]: SwitchDescriptor.poll[TOGGLEX_NAMESPACE],
    [TOGGLE_NAMESPACE]: SwitchDescriptor.poll[TOGGLE_NAMESPACE],
    [LIGHT_NAMESPACE]: LightDescriptor.poll[LIGHT_NAMESPACE],
    [SPRAY_NAMESPACE]: SprayDescriptor.poll[SPRAY_NAMESPACE],
    [FAN_NAMESPACE]: FanDescriptor.poll[FAN_NAMESPACE],
    [MP3_NAMESPACE]: MediaDescriptor.poll[MP3_NAMESPACE],
    [DIFFUSER_LIGHT_NAMESPACE]: DiffuserDescriptor.poll[DIFFUSER_LIGHT_NAMESPACE],
    [DIFFUSER_SPRAY_NAMESPACE]: DiffuserDescriptor.poll[DIFFUSER_SPRAY_NAMESPACE],
    [GARAGE_STATE_NAMESPACE]: CoverDescriptor.poll[GARAGE_STATE_NAMESPACE],
    [GARAGE_CONFIG_NAMESPACE]: CoverDescriptor.poll[GARAGE_CONFIG_NAMESPACE],
    [GARAGE_MULTIPLE_CONFIG_NAMESPACE]: CoverDescriptor.poll[GARAGE_MULTIPLE_CONFIG_NAMESPACE],
    [SHUTTER_POSITION_NAMESPACE]: CoverDescriptor.poll[SHUTTER_POSITION_NAMESPACE],
    [SHUTTER_STATE_NAMESPACE]: CoverDescriptor.poll[SHUTTER_STATE_NAMESPACE],
    [SHUTTER_CONFIG_NAMESPACE]: CoverDescriptor.poll[SHUTTER_CONFIG_NAMESPACE],
    [SHUTTER_ADJUST_NAMESPACE]: CoverDescriptor.poll[SHUTTER_ADJUST_NAMESPACE],
    [CONTROL_ALARM_NAMESPACE]: AlarmDescriptor.poll[CONTROL_ALARM_NAMESPACE],
    [CONTROL_BEEP_NAMESPACE]: AlarmDescriptor.poll[CONTROL_BEEP_NAMESPACE],
    [HUB_TOGGLEX_NAMESPACE]: SwitchDescriptor.poll[HUB_TOGGLEX_NAMESPACE],

    // Config / slow sensors
    [LIGHT_EFFECT_NAMESPACE]: LightDescriptor.poll[LIGHT_EFFECT_NAMESPACE],
    [FAN_CONFIG_NAMESPACE]: FanDescriptor.poll[FAN_CONFIG_NAMESPACE],
    [FILTER_MAINTENANCE_NAMESPACE]: FanDescriptor.poll[FILTER_MAINTENANCE_NAMESPACE],
    [DIFFUSER_SENSOR_NAMESPACE]: DiffuserDescriptor.poll[DIFFUSER_SENSOR_NAMESPACE],
    [DND_MODE_NAMESPACE]: DndDescriptor.poll[DND_MODE_NAMESPACE],
    [PRESENCE_CONFIG_NAMESPACE]: PresenceDescriptor.poll[PRESENCE_CONFIG_NAMESPACE],

    // Energy / fast sensors
    [ELECTRICITY_NAMESPACE]: EnergyDescriptor.poll[ELECTRICITY_NAMESPACE],
    [ELECTRICITYX_NAMESPACE]: EnergyDescriptor.poll[ELECTRICITYX_NAMESPACE],
    [CONSUMPTIONX_NAMESPACE]: EnergyDescriptor.poll[CONSUMPTIONX_NAMESPACE],
    [CONSUMPTIONH_NAMESPACE]: EnergyDescriptor.poll[CONSUMPTIONH_NAMESPACE],
    [SENSOR_LATESTX_NAMESPACE]: PresenceDescriptor.poll[SENSOR_LATESTX_NAMESPACE],
    [SENSOR_LATEST_NAMESPACE]: ClimateDescriptor.poll[SENSOR_LATEST_NAMESPACE],

    // Timer / trigger indexes (X) and legacy full-list GETs (pre-X)
    [DIGEST_TIMERX_NAMESPACE]: TimerDescriptor.poll[DIGEST_TIMERX_NAMESPACE],
    [DIGEST_TRIGGERX_NAMESPACE]: TriggerDescriptor.poll[DIGEST_TRIGGERX_NAMESPACE],
    [CONTROL_TIMER_NAMESPACE]: TimerDescriptor.poll[CONTROL_TIMER_NAMESPACE],
    [CONTROL_TRIGGER_NAMESPACE]: TriggerDescriptor.poll[CONTROL_TRIGGER_NAMESPACE],

    // Board climate
    [THERMOSTAT_MODE_NAMESPACE]: ClimateDescriptor.poll[THERMOSTAT_MODE_NAMESPACE],
    [THERMOSTAT_MODEB_NAMESPACE]: ClimateDescriptor.poll[THERMOSTAT_MODEB_NAMESPACE],
    [THERMOSTAT_MODEC_NAMESPACE]: ClimateDescriptor.poll[THERMOSTAT_MODEC_NAMESPACE],
    [TIMER_NAMESPACE]: ClimateDescriptor.poll[TIMER_NAMESPACE],
    [ALARM_NAMESPACE]: ClimateDescriptor.poll[ALARM_NAMESPACE],
    [HOLD_ACTION_NAMESPACE]: ClimateDescriptor.poll[HOLD_ACTION_NAMESPACE],
    [WINDOW_OPENED_NAMESPACE]: ClimateDescriptor.poll[WINDOW_OPENED_NAMESPACE],
    [SENSOR_NAMESPACE]: ClimateDescriptor.poll[SENSOR_NAMESPACE],
    [CALIBRATION_NAMESPACE]: ClimateDescriptor.poll[CALIBRATION_NAMESPACE],
    [DEAD_ZONE_NAMESPACE]: ClimateDescriptor.poll[DEAD_ZONE_NAMESPACE],
    [SUMMER_MODE_NAMESPACE]: ClimateDescriptor.poll[SUMMER_MODE_NAMESPACE],
    [COMPRESSOR_DELAY_NAMESPACE]: ClimateDescriptor.poll[COMPRESSOR_DELAY_NAMESPACE],
    [ALARM_CONFIG_NAMESPACE]: ClimateDescriptor.poll[ALARM_CONFIG_NAMESPACE],
    [SCHEDULE_NAMESPACE]: ClimateDescriptor.poll[SCHEDULE_NAMESPACE],
    [SCHEDULEB_NAMESPACE]: ClimateDescriptor.poll[SCHEDULEB_NAMESPACE],
    [TEMP_UNIT_NAMESPACE]: ClimateDescriptor.poll[TEMP_UNIT_NAMESPACE],
    [SCREEN_BRIGHTNESS_NAMESPACE]: ClimateDescriptor.poll[SCREEN_BRIGHTNESS_NAMESPACE],
    [PHYSICAL_LOCK_NAMESPACE]: ClimateDescriptor.poll[PHYSICAL_LOCK_NAMESPACE],
    [FROST_NAMESPACE]: ClimateDescriptor.poll[FROST_NAMESPACE],
    [OVERHEAT_NAMESPACE]: ClimateDescriptor.poll[OVERHEAT_NAMESPACE],
    [CTL_RANGE_NAMESPACE]: ClimateDescriptor.poll[CTL_RANGE_NAMESPACE],

    // Hub climate
    [HUB_MTS100_ALL_NAMESPACE]: ClimateDescriptor.poll[HUB_MTS100_ALL_NAMESPACE],
    [HUB_MTS100_MODE_NAMESPACE]: ClimateDescriptor.poll[HUB_MTS100_MODE_NAMESPACE],
    [HUB_MTS100_TEMPERATURE_NAMESPACE]: ClimateDescriptor.poll[HUB_MTS100_TEMPERATURE_NAMESPACE],
    [HUB_MTS100_ADJUST_NAMESPACE]: ClimateDescriptor.poll[HUB_MTS100_ADJUST_NAMESPACE],
    [HUB_MTS100_CONFIG_NAMESPACE]: ClimateDescriptor.poll[HUB_MTS100_CONFIG_NAMESPACE],
    [HUB_MTS100_SUPERCTL_NAMESPACE]: ClimateDescriptor.poll[HUB_MTS100_SUPERCTL_NAMESPACE],
    [HUB_MTS100_TIMESYNC_NAMESPACE]: ClimateDescriptor.poll[HUB_MTS100_TIMESYNC_NAMESPACE],
    [HUB_MTS100_SCHEDULE_NAMESPACE]: ClimateDescriptor.poll[HUB_MTS100_SCHEDULE_NAMESPACE],
    [HUB_MTS100_SCHEDULEB_NAMESPACE]: ClimateDescriptor.poll[HUB_MTS100_SCHEDULEB_NAMESPACE],

    // Hub sensors / sprinkler
    [HUB_SENSOR_ALL_NAMESPACE]: SensorDescriptor.poll[HUB_SENSOR_ALL_NAMESPACE],
    [HUB_SENSOR_TEMPHUM_NAMESPACE]: SensorDescriptor.poll[HUB_SENSOR_TEMPHUM_NAMESPACE],
    [HUB_SENSOR_DOORWINDOW_NAMESPACE]: SensorDescriptor.poll[HUB_SENSOR_DOORWINDOW_NAMESPACE],
    [HUB_SENSOR_WATERLEAK_NAMESPACE]: SensorDescriptor.poll[HUB_SENSOR_WATERLEAK_NAMESPACE],
    [HUB_SENSOR_MOTION_NAMESPACE]: SensorDescriptor.poll[HUB_SENSOR_MOTION_NAMESPACE],
    [HUB_SENSOR_SMOKE_NAMESPACE]: SensorDescriptor.poll[HUB_SENSOR_SMOKE_NAMESPACE],
    [HUB_BATTERY_NAMESPACE]: SensorDescriptor.poll[HUB_BATTERY_NAMESPACE],
    [HUB_SUBDEVICE_VERSION_NAMESPACE]: SwitchDescriptor.poll[HUB_SUBDEVICE_VERSION_NAMESPACE],
    [HUB_SENSOR_ADJUST_NAMESPACE]: SensorDescriptor.poll[HUB_SENSOR_ADJUST_NAMESPACE],
    [HUB_SENSOR_ALERT_NAMESPACE]: SensorDescriptor.poll[HUB_SENSOR_ALERT_NAMESPACE],
    [SMOKE_CONFIG_NAMESPACE]: SensorDescriptor.poll[SMOKE_CONFIG_NAMESPACE],
    [CONTROL_WATER_NAMESPACE]: SprinklerDescriptor.poll[CONTROL_WATER_NAMESPACE],
    [DEVICE_CFG_NAMESPACE]: SprinklerDescriptor.poll[DEVICE_CFG_NAMESPACE]
};

/**
 * Table lookup used by packing. Missing rows still charge the Multiple
 * envelope rather than packing as free.
 */
export function getResponseSizeParts(namespace: string): PollResponseParts {
    const spec = POLL[namespace];
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
    payload: MerossPayload = {}
): number {
    const { base, item } = getResponseSizeParts(namespace);
    if (item === 0) {
        return base;
    }
    if (namespace === CONSUMPTIONX_NAMESPACE && consumptionXDays(payload) === undefined) {
        return base + item * CONSUMPTIONX_DEFAULT_DAYS;
    }
    return base + item * Math.max(getPayloadItemCount(payload), 1);
}

/**
 * Builds the device poll table from Ability. LIST payloads come from enrolled
 * endpoints so a strip or hub issues one GET per namespace.
 */
export function buildPollJobs(
    ability: AbilityMap,
    endpoints: readonly PollTarget[],
    digestNamespaces?: ReadonlySet<string>
): PollJob[] {
    const jobs: PollJob[] = [];
    for (const [namespace, spec] of Object.entries(POLL)) {
        if (!(namespace in ability)) {
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
            payload: spec.payload ? encodePayload(spec.payload, endpoints) : {},
            ...(spec.method ? { method: spec.method } : {}),
            ...(spec.calibrate ? { calibrate: spec.calibrate } : {})
        });
    }
    return jobs;
}

function encodePayload(spec: PayloadSpec, endpoints: readonly PollTarget[]): MerossPayload {
    if ('dict' in spec) {
        return {
            [spec.dict]: spec.channel === undefined ? {} : { channel: spec.channel }
        };
    }
    return { [spec.list]: encodeList(spec, endpoints) };
}

function encodeList(
    spec: Extract<PayloadSpec, { list: string }>,
    endpoints: readonly PollTarget[]
): unknown[] {
    if (spec.by === undefined) {
        return [];
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
