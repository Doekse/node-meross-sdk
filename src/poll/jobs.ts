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
    CONFIG_OVERTEMP_NAMESPACE,
    CONTROL_OVERTEMP_NAMESPACE
} from '../protocol/codecs/overtemp';
import {
    CONTROL_ALERT_CONFIG_NAMESPACE
} from '../protocol/codecs/alertconfig';
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
import { TOGGLEX_ALL_CHANNELS, TOGGLEX_NAMESPACE } from '../protocol/codecs/togglex';
import {
    CONTROL_TRIGGER_NAMESPACE,
    DIGEST_TRIGGERX_NAMESPACE
} from '../protocol/codecs/triggerx';
import { CONTROL_WATER_NAMESPACE, DEVICE_CFG_NAMESPACE } from '../protocol/codecs/water';
import type { MerossPayload } from '../protocol/message';
import type { AbilityMap } from '../protocol/codecs/ability';
import { AlarmDescriptor } from '../traits/alarm';
import { DndDescriptor } from '../traits/dnd';
import { EnergyDescriptor } from '../traits/energy';
import { MediaDescriptor } from '../traits/media';
import { SwitchDescriptor, TOGGLE_NAMESPACE } from '../traits/switch';
import { SystemDescriptor } from '../traits/system';
import { TimerDescriptor } from '../traits/timer';
import { TriggerDescriptor } from '../traits/trigger';
import type { PollJob } from './poller';
import { SYSTEM_ALL_NAMESPACE } from '../protocol/codecs/system-all';
import {
    channelList,
    DEFAULT,
    idList,
    ONCE,
    POLL_RESPONSE_HEADER_SIZE,
    SMART_ALL,
    SMART_BATTERY,
    SMART_CLOUDMQTT,
    SMART_CONFIG,
    SMART_FAST_MQTT,
    SMART_FAST_SLOW_CLOUD,
    SMART_SLOW,
    subIdList,
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
 */
const POLL: Record<string, PollSpec> = {
    [SYSTEM_ALL_NAMESPACE]: SystemDescriptor.poll[SYSTEM_ALL_NAMESPACE],
    'Appliance.System.Runtime': SystemDescriptor.poll['Appliance.System.Runtime'],
    [SYSTEM_FIRMWARE_NAMESPACE]: SystemDescriptor.poll[SYSTEM_FIRMWARE_NAMESPACE],
    [SYSTEM_HARDWARE_NAMESPACE]: SystemDescriptor.poll[SYSTEM_HARDWARE_NAMESPACE],
    [SYSTEM_TIME_NAMESPACE]: SystemDescriptor.poll[SYSTEM_TIME_NAMESPACE],
    [SYSTEM_POSITION_NAMESPACE]: SystemDescriptor.poll[SYSTEM_POSITION_NAMESPACE],
    [SYSTEM_DEBUG_NAMESPACE]: SystemDescriptor.poll[SYSTEM_DEBUG_NAMESPACE],
    [CONFIG_OVERTEMP_NAMESPACE]: EnergyDescriptor.poll[CONFIG_OVERTEMP_NAMESPACE],
    [CONTROL_OVERTEMP_NAMESPACE]: EnergyDescriptor.poll[CONTROL_OVERTEMP_NAMESPACE],
    [CONFIG_SENSOR_ASSOCIATION_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: channelList('config'),
        item: 30
    },
    [CONTROL_ALERT_CONFIG_NAMESPACE]: EnergyDescriptor.poll[CONTROL_ALERT_CONFIG_NAMESPACE],
    [CONFIG_STANDBY_KILLER_NAMESPACE]: EnergyDescriptor.poll[CONFIG_STANDBY_KILLER_NAMESPACE],

    // Digest / device state
    [TOGGLEX_NAMESPACE]: SwitchDescriptor.poll[TOGGLEX_NAMESPACE],
    [TOGGLE_NAMESPACE]: SwitchDescriptor.poll[TOGGLE_NAMESPACE],
    [LIGHT_NAMESPACE]: DEFAULT,
    [SPRAY_NAMESPACE]: {
        ...DEFAULT,
        payload: { dict: 'spray' }
    },
    [FAN_NAMESPACE]: {
        ...DEFAULT,
        payload: channelList('fan', 'fan'),
        item: 20
    },
    [MP3_NAMESPACE]: MediaDescriptor.poll[MP3_NAMESPACE],
    [DIFFUSER_LIGHT_NAMESPACE]: DEFAULT,
    [DIFFUSER_SPRAY_NAMESPACE]: DEFAULT,
    [GARAGE_STATE_NAMESPACE]: {
        ...DEFAULT,
        payload: { dict: 'state', channel: TOGGLEX_ALL_CHANNELS }
    },
    [GARAGE_CONFIG_NAMESPACE]: { ...SMART_CONFIG, base: 410 },
    [GARAGE_MULTIPLE_CONFIG_NAMESPACE]: { ...SMART_CONFIG, item: 140 },
    [SHUTTER_POSITION_NAMESPACE]: { ...DEFAULT, item: 50 },
    [SHUTTER_STATE_NAMESPACE]: { ...DEFAULT, item: 40 },
    [SHUTTER_CONFIG_NAMESPACE]: { ...SMART_CONFIG, item: 70 },
    [SHUTTER_ADJUST_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: channelList('adjust', 'cover'),
        item: 35
    },
    [CONTROL_ALARM_NAMESPACE]: AlarmDescriptor.poll[CONTROL_ALARM_NAMESPACE],
    [CONTROL_BEEP_NAMESPACE]: AlarmDescriptor.poll[CONTROL_BEEP_NAMESPACE],
    [HUB_TOGGLEX_NAMESPACE]: SwitchDescriptor.poll[HUB_TOGGLEX_NAMESPACE],

    // Config / slow sensors
    [LIGHT_EFFECT_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: { list: 'effect' },
        base: 1_850
    },
    [FAN_CONFIG_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: channelList('config', 'fan')
    },
    [FILTER_MAINTENANCE_NAMESPACE]: {
        ...SMART_CLOUDMQTT,
        method: 'PUSH',
        item: 35
    },
    [DIFFUSER_SENSOR_NAMESPACE]: { ...SMART_SLOW, item: 100 },
    [DND_MODE_NAMESPACE]: DndDescriptor.poll[DND_MODE_NAMESPACE],
    [PRESENCE_CONFIG_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: channelList('config', 'presence'),
        item: 260
    },

    // Energy / fast sensors
    [ELECTRICITY_NAMESPACE]: EnergyDescriptor.poll[ELECTRICITY_NAMESPACE],
    [ELECTRICITYX_NAMESPACE]: EnergyDescriptor.poll[ELECTRICITYX_NAMESPACE],
    [CONSUMPTIONX_NAMESPACE]: EnergyDescriptor.poll[CONSUMPTIONX_NAMESPACE],
    [CONSUMPTIONH_NAMESPACE]: EnergyDescriptor.poll[CONSUMPTIONH_NAMESPACE],
    [SENSOR_LATESTX_NAMESPACE]: {
        ...SMART_FAST_MQTT,
        payload: {
            list: 'latest',
            by: 'either',
            data: ['presence', 'light'],
            dataId: ['light', 'temp', 'humi']
        },
        item: 220
    },
    [SENSOR_LATEST_NAMESPACE]: {
        ...SMART_FAST_SLOW_CLOUD,
        payload: channelList('latest', 'climate'),
        item: 80
    },

    // Timer / trigger indexes (X) and legacy full-list GETs (pre-X)
    [DIGEST_TIMERX_NAMESPACE]: TimerDescriptor.poll[DIGEST_TIMERX_NAMESPACE],
    [DIGEST_TRIGGERX_NAMESPACE]: TriggerDescriptor.poll[DIGEST_TRIGGERX_NAMESPACE],
    [CONTROL_TIMER_NAMESPACE]: TimerDescriptor.poll[CONTROL_TIMER_NAMESPACE],
    [CONTROL_TRIGGER_NAMESPACE]: TriggerDescriptor.poll[CONTROL_TRIGGER_NAMESPACE],

    // Board climate
    [THERMOSTAT_MODE_NAMESPACE]: {
        ...DEFAULT,
        payload: channelList('mode', 'climate')
    },
    [THERMOSTAT_MODEB_NAMESPACE]: {
        ...DEFAULT,
        payload: channelList('modeB', 'climate')
    },
    [THERMOSTAT_MODEC_NAMESPACE]: {
        ...DEFAULT,
        payload: channelList('control', 'climate')
    },
    [TIMER_NAMESPACE]: {
        ...DEFAULT,
        payload: channelList('timer', 'climate')
    },
    [ALARM_NAMESPACE]: {
        ...DEFAULT,
        payload: channelList('alarm', 'climate')
    },
    [HOLD_ACTION_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: channelList('holdAction', 'climate')
    },
    [WINDOW_OPENED_NAMESPACE]: {
        ...SMART_SLOW,
        payload: channelList('windowOpened', 'climate')
    },
    [SENSOR_NAMESPACE]: {
        ...SMART_SLOW,
        payload: channelList('sensor', 'climate')
    },
    [CALIBRATION_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: channelList('calibration', 'climate')
    },
    [DEAD_ZONE_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: channelList('deadZone', 'climate')
    },
    [SUMMER_MODE_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: channelList('summerMode', 'climate')
    },
    [COMPRESSOR_DELAY_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: channelList('delay', 'climate')
    },
    [ALARM_CONFIG_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: channelList('alarmConfig', 'climate')
    },
    [SCHEDULE_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: channelList('schedule', 'climate')
    },
    [SCHEDULEB_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: channelList('scheduleB', 'climate')
    },
    [TEMP_UNIT_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: channelList('tempUnit', 'climate')
    },
    [SCREEN_BRIGHTNESS_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: channelList('brightness', 'climate'),
        item: 70
    },
    [PHYSICAL_LOCK_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: { list: 'lock', by: 'either', for: 'climate' },
        item: 35
    },
    [FROST_NAMESPACE]: {
        ...SMART_SLOW,
        payload: channelList('frost', 'climate')
    },
    [OVERHEAT_NAMESPACE]: {
        ...SMART_SLOW,
        payload: channelList('overheat', 'climate')
    },
    [CTL_RANGE_NAMESPACE]: {
        ...ONCE,
        payload: channelList('ctlRange', 'climate')
    },

    // Hub climate
    [HUB_MTS100_ALL_NAMESPACE]: {
        ...SMART_ALL,
        payload: idList('all', 'climate')
    },
    [HUB_MTS100_MODE_NAMESPACE]: {
        ...DEFAULT,
        skipIf: HUB_MTS100_ALL_NAMESPACE,
        payload: idList('mode', 'climate')
    },
    [HUB_MTS100_TEMPERATURE_NAMESPACE]: {
        ...DEFAULT,
        skipIf: HUB_MTS100_ALL_NAMESPACE,
        payload: idList('temperature', 'climate')
    },
    [HUB_MTS100_ADJUST_NAMESPACE]: {
        ...SMART_CLOUDMQTT,
        payload: idList('adjust', 'climate')
    },
    [HUB_MTS100_CONFIG_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: idList('config', 'climate')
    },
    [HUB_MTS100_SUPERCTL_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: idList('superCtl', 'climate')
    },
    [HUB_MTS100_TIMESYNC_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: idList('timeSync', 'climate')
    },
    [HUB_MTS100_SCHEDULE_NAMESPACE]: {
        ...SMART_CLOUDMQTT,
        payload: idList('schedule', 'climate')
    },
    [HUB_MTS100_SCHEDULEB_NAMESPACE]: {
        ...SMART_CLOUDMQTT,
        payload: idList('schedule', 'climate')
    },

    // Hub sensors / sprinkler
    [HUB_SENSOR_ALL_NAMESPACE]: {
        ...SMART_ALL,
        payload: idList('all', 'sensor')
    },
    [HUB_SENSOR_TEMPHUM_NAMESPACE]: {
        ...DEFAULT,
        skipIf: HUB_SENSOR_ALL_NAMESPACE,
        payload: idList('tempHum', 'sensor')
    },
    [HUB_SENSOR_DOORWINDOW_NAMESPACE]: {
        ...DEFAULT,
        skipIf: HUB_SENSOR_ALL_NAMESPACE,
        payload: idList('doorWindow', 'sensor')
    },
    [HUB_SENSOR_WATERLEAK_NAMESPACE]: {
        ...DEFAULT,
        skipIf: HUB_SENSOR_ALL_NAMESPACE,
        payload: idList('waterLeak', 'sensor')
    },
    [HUB_SENSOR_MOTION_NAMESPACE]: {
        ...DEFAULT,
        skipIf: HUB_SENSOR_ALL_NAMESPACE,
        payload: idList('motion', 'sensor')
    },
    [HUB_SENSOR_SMOKE_NAMESPACE]: {
        ...DEFAULT,
        skipIf: HUB_SENSOR_ALL_NAMESPACE,
        payload: idList('smokeAlarm', 'sensor')
    },
    [HUB_BATTERY_NAMESPACE]: {
        ...SMART_BATTERY,
        payload: idList('battery')
    },
    [HUB_SUBDEVICE_VERSION_NAMESPACE]: SwitchDescriptor.poll[HUB_SUBDEVICE_VERSION_NAMESPACE],
    [HUB_SENSOR_ADJUST_NAMESPACE]: {
        ...SMART_CLOUDMQTT,
        payload: idList('adjust', 'sensor')
    },
    [HUB_SENSOR_ALERT_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: idList('alert', 'sensor')
    },
    [SMOKE_CONFIG_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: subIdList('config', 'sensor')
    },
    [CONTROL_WATER_NAMESPACE]: {
        ...DEFAULT,
        payload: subIdList('control', 'sprinkler')
    },
    [DEVICE_CFG_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: subIdList('config', 'sprinkler')
    }
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
