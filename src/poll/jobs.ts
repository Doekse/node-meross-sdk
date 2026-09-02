import type { TraitName } from '../endpoint';
import { CONTROL_ALARM_NAMESPACE, CONTROL_BEEP_NAMESPACE } from '../protocol/codecs/alarm';
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
    ELECTRICITYX_ALL_CHANNELS,
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
    DIGEST_TIMERX_NAMESPACE,
    TIMERX_NAMESPACE
} from '../protocol/codecs/timerx';
import { TOGGLEX_ALL_CHANNELS, TOGGLEX_NAMESPACE } from '../protocol/codecs/togglex';
import {
    CONTROL_TRIGGER_NAMESPACE,
    DIGEST_TRIGGERX_NAMESPACE,
    TRIGGERX_NAMESPACE
} from '../protocol/codecs/triggerx';
import { CONTROL_WATER_NAMESPACE, DEVICE_CFG_NAMESPACE } from '../protocol/codecs/water';
import type { MerossPayload } from '../protocol/message';
import type { AbilityMap } from '../protocol/codecs/ability';
import type { GraphEndpoint } from '../device';
import type { PollJob, PollStrategy } from './poller';
import { SYSTEM_ALL_NAMESPACE } from '../protocol/codecs/system-all';
import type { SystemAll } from '../protocol/codecs/system-all';

/**
 * Firmware heartbeat window. HTTP is also probed on this interval while MQTT
 * is current, so a dropped LAN path is noticed even while PUSH is still
 * arriving.
 */
export const SYSTEM_ALL_PERIOD_MS = 295_000;

/** Watt-hour totals do not need the instantaneous electricity period. */
export const ENERGY_PERIOD_MS = 55_000;

/** Consumption over cloud MQTT so daily totals do not fill the broker budget. */
export const ENERGY_CLOUD_PERIOD_MS = 600_000;

/** Live power / presence: due on every LAN tick. */
export const SENSOR_FAST_PERIOD_MS = 0;

/** Live sensors when the request rides cloud MQTT. */
export const SENSOR_FAST_CLOUD_PERIOD_MS = 180_000;

/** Config and slowly changing sensors on LAN. */
export const SENSOR_SLOW_PERIOD_MS = 300_000;

/** Slowly changing sensors over cloud MQTT. */
export const SENSOR_SLOW_CLOUD_PERIOD_MS = 600_000;

/** Config GETs over cloud MQTT; the slowest period, as they rarely change. */
export const CLOUDMQTT_PERIOD_MS = 1_195_000;

/** Hub battery percent barely moves; about once an hour is enough. */
export const HUB_BATTERY_PERIOD_MS = 3_600_000;

/**
 * Control.Multiple's envelope is counted before any sub-GETACK so the HTTP
 * ~3000-byte ceiling is not spent twice.
 */
export const POLL_RESPONSE_HEADER_SIZE = 300;

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
    base: number;
    item: number;
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

interface PollPeriods {
    strategy: PollStrategy;
    periodMs: number;
    periodCloudMs: number;
}

/**
 * GET body grammar. Omitted payload is `{}`.
 * `dict` — `{ key: { channel } }` or `{ key: {} }` when channel is omitted.
 * `list` without `by` — `{ key: [] }` (Light.Effect catalog).
 * `list` with `by` — `{ key: [{ channel | id | subId }] }` from enrolled endpoints.
 * `either` — hub children (`subId`) when present, otherwise board channels.
 */
type PayloadSpec =
    | { dict: string; channel?: number }
    | {
        list: string;
        by?: 'channel' | 'id' | 'subId' | 'either';
        for?: TraitName;
        data?: string[];
        dataId?: string[];
    };

interface PollSpec extends PollPeriods {
    skipIf?: string;
    payload?: PayloadSpec;
    method?: 'GET' | 'PUSH';
    calibrate?: (payload: MerossPayload) => number | undefined;
    /**
     * GETACK bytes. Omitted `base` is {@link POLL_RESPONSE_HEADER_SIZE} and
     * omitted `item` is 0, so packing still charges the Multiple envelope
     * instead of treating the namespace as free.
     */
    base?: number;
    item?: number;
}

const DEFAULT: PollPeriods = {
    strategy: 'default',
    periodMs: 0,
    periodCloudMs: CLOUDMQTT_PERIOD_MS
};

const ONCE: PollPeriods = {
    strategy: 'once',
    periodMs: 0,
    periodCloudMs: 0
};

const SMART_FAST: PollPeriods = {
    strategy: 'smart',
    periodMs: SENSOR_FAST_PERIOD_MS,
    periodCloudMs: SENSOR_FAST_CLOUD_PERIOD_MS
};

/** LatestX stays every LAN tick; over MQTT it uses the config cloud period. */
const SMART_FAST_MQTT: PollPeriods = {
    strategy: 'smart',
    periodMs: SENSOR_FAST_PERIOD_MS,
    periodCloudMs: CLOUDMQTT_PERIOD_MS
};

/** Latest is live on LAN; over MQTT it can wait with other slow sensors. */
const SMART_FAST_SLOW_CLOUD: PollPeriods = {
    strategy: 'smart',
    periodMs: SENSOR_FAST_PERIOD_MS,
    periodCloudMs: SENSOR_SLOW_CLOUD_PERIOD_MS
};

const SMART_SLOW: PollPeriods = {
    strategy: 'smart',
    periodMs: SENSOR_SLOW_PERIOD_MS,
    periodCloudMs: SENSOR_SLOW_CLOUD_PERIOD_MS
};

const SMART_CONFIG: PollPeriods = {
    strategy: 'smart',
    periodMs: SENSOR_SLOW_PERIOD_MS,
    periodCloudMs: CLOUDMQTT_PERIOD_MS
};

const SMART_ENERGY: PollPeriods = {
    strategy: 'smart',
    periodMs: ENERGY_PERIOD_MS,
    periodCloudMs: ENERGY_CLOUD_PERIOD_MS
};

const SMART_CLOUDMQTT: PollPeriods = {
    strategy: 'smart',
    periodMs: CLOUDMQTT_PERIOD_MS,
    periodCloudMs: CLOUDMQTT_PERIOD_MS
};

const SMART_BATTERY: PollPeriods = {
    strategy: 'smart',
    periodMs: HUB_BATTERY_PERIOD_MS,
    periodCloudMs: CLOUDMQTT_PERIOD_MS
};

const SMART_ALL: PollPeriods = {
    strategy: 'smart',
    periodMs: SYSTEM_ALL_PERIOD_MS,
    periodCloudMs: CLOUDMQTT_PERIOD_MS
};

const ALL_CHANNELS = { dict: 'togglex', channel: TOGGLEX_ALL_CHANNELS } as const;

function channelList(list: string, trait?: TraitName): PayloadSpec {
    return { list, by: 'channel', ...(trait ? { for: trait } : {}) };
}

function idList(list: string, trait?: TraitName): PayloadSpec {
    return { list, by: 'id', ...(trait ? { for: trait } : {}) };
}

function subIdList(list: string, trait: TraitName): PayloadSpec {
    return { list, by: 'subId', for: trait };
}

/**
 * GET schedule keyed by Ability. Unadvertised namespaces stay off the wire.
 * FilterMaintenance is PUSH-query (GET disconnects MAP100).
 * `base`/`item` live here so packing does not keep a second per-namespace table.
 */
const POLL: Record<string, PollSpec> = {
    [SYSTEM_ALL_NAMESPACE]: {
        strategy: 'all',
        periodMs: SYSTEM_ALL_PERIOD_MS,
        periodCloudMs: 0,
        base: 1_000
    },
    'Appliance.System.Runtime': { ...SMART_CONFIG, base: 330 },
    // Firmware / Hardware / Time ride System.All; standalone GET is the fallback.
    [SYSTEM_FIRMWARE_NAMESPACE]: {
        ...ONCE,
        skipIf: SYSTEM_ALL_NAMESPACE
    },
    [SYSTEM_HARDWARE_NAMESPACE]: {
        ...ONCE,
        skipIf: SYSTEM_ALL_NAMESPACE
    },
    [SYSTEM_TIME_NAMESPACE]: {
        ...SMART_CONFIG,
        skipIf: SYSTEM_ALL_NAMESPACE
    },
    [SYSTEM_POSITION_NAMESPACE]: ONCE,
    [SYSTEM_DEBUG_NAMESPACE]: { ...ONCE, base: 1_900 },
    [CONFIG_OVERTEMP_NAMESPACE]: { ...SMART_CONFIG, base: 340 },
    [CONTROL_OVERTEMP_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: channelList('overTemp', 'energy')
    },
    [CONFIG_SENSOR_ASSOCIATION_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: channelList('config'),
        item: 30
    },
    [CONTROL_ALERT_CONFIG_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: channelList('config')
    },
    [CONFIG_STANDBY_KILLER_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: channelList('config', 'energy')
    },

    // Digest / device state
    [TOGGLEX_NAMESPACE]: {
        ...DEFAULT,
        payload: ALL_CHANNELS
    },
    'Appliance.Control.Toggle': {
        ...DEFAULT,
        payload: { dict: 'toggle' }
    },
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
    [MP3_NAMESPACE]: {
        ...DEFAULT,
        payload: { dict: 'mp3' },
        base: 380
    },
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
    [CONTROL_ALARM_NAMESPACE]: {
        ...DEFAULT,
        payload: channelList('alarm', 'alarm')
    },
    [CONTROL_BEEP_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: channelList('alarm', 'alarm')
    },
    [HUB_TOGGLEX_NAMESPACE]: {
        ...DEFAULT,
        payload: idList('togglex')
    },

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
    [DND_MODE_NAMESPACE]: { ...SMART_CONFIG, base: 320 },
    [PRESENCE_CONFIG_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: channelList('config', 'presence'),
        item: 260
    },

    // Energy / fast sensors
    [ELECTRICITY_NAMESPACE]: {
        ...SMART_FAST,
        payload: { dict: 'electricity', channel: 0 },
        base: 430
    },
    [ELECTRICITYX_NAMESPACE]: {
        ...SMART_FAST,
        payload: { dict: 'electricity', channel: ELECTRICITYX_ALL_CHANNELS },
        item: 100
    },
    [CONSUMPTIONX_NAMESPACE]: {
        ...SMART_ENERGY,
        base: 320,
        item: 53,
        calibrate: (payload) => (
            consumptionXDays(payload) === undefined
                ? undefined
                : estimateResponseSize(CONSUMPTIONX_NAMESPACE, payload)
        )
    },
    [CONSUMPTIONH_NAMESPACE]: {
        ...SMART_ENERGY,
        payload: channelList('consumptionH', 'energy'),
        base: 320,
        item: 1_900
    },
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
    [DIGEST_TIMERX_NAMESPACE]: ONCE,
    [DIGEST_TRIGGERX_NAMESPACE]: ONCE,
    [CONTROL_TIMER_NAMESPACE]: {
        ...SMART_CONFIG,
        skipIf: TIMERX_NAMESPACE,
        payload: { list: 'timer' }
    },
    [CONTROL_TRIGGER_NAMESPACE]: {
        ...SMART_CONFIG,
        skipIf: TRIGGERX_NAMESPACE,
        payload: { dict: 'trigger' }
    },

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
    [HUB_SUBDEVICE_VERSION_NAMESPACE]: {
        ...ONCE,
        payload: idList('version')
    },
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
 * Namespaces whose state is already in the System.All digest, so they GET
 * only when All is skipped, not beside it.
 */
export function getDigestNamespaces(digest: SystemAll['digest']): Set<string> {
    const namespaces = new Set<string>();
    if (digest.togglex.length > 0) {
        namespaces.add(TOGGLEX_NAMESPACE);
    }
    if (digest.light.length > 0) {
        namespaces.add(LIGHT_NAMESPACE);
    }
    if (digest.garageDoor.length > 0) {
        namespaces.add(GARAGE_STATE_NAMESPACE);
    }
    if (digest.spray.length > 0) {
        namespaces.add(SPRAY_NAMESPACE);
    }
    if (digest.fan.length > 0) {
        namespaces.add(FAN_NAMESPACE);
    }
    if (digest.diffuser) {
        if (digest.diffuser.light.length > 0) {
            namespaces.add(DIFFUSER_LIGHT_NAMESPACE);
        }
        if (digest.diffuser.spray.length > 0) {
            namespaces.add(DIFFUSER_SPRAY_NAMESPACE);
        }
    }
    if (digest.thermostat) {
        if (digest.thermostat.mode !== undefined) {
            namespaces.add(THERMOSTAT_MODE_NAMESPACE);
        }
        if (digest.thermostat.modeB !== undefined) {
            namespaces.add(THERMOSTAT_MODEB_NAMESPACE);
        }
        if (digest.thermostat.summerMode !== undefined) {
            namespaces.add(SUMMER_MODE_NAMESPACE);
        }
        if (digest.thermostat.windowOpened !== undefined) {
            namespaces.add(WINDOW_OPENED_NAMESPACE);
        }
    }
    return namespaces;
}

/**
 * Builds the device poll table from Ability. LIST payloads come from enrolled
 * endpoints so a strip or hub issues one GET per namespace.
 */
export function buildPollJobs(
    ability: AbilityMap,
    endpoints: readonly GraphEndpoint[],
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

function encodePayload(spec: PayloadSpec, endpoints: readonly GraphEndpoint[]): MerossPayload {
    if ('dict' in spec) {
        return {
            [spec.dict]: spec.channel === undefined ? {} : { channel: spec.channel }
        };
    }
    return { [spec.list]: encodeList(spec, endpoints) };
}

function encodeList(
    spec: Extract<PayloadSpec, { list: string }>,
    endpoints: readonly GraphEndpoint[]
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

    if (spec.by === 'id') {
        return withId.map((endpoint) => ({ id: endpoint.subDeviceId }));
    }
    if (spec.by === 'subId') {
        return withId.map((endpoint) => ({
            subId: endpoint.subDeviceId,
            channel: 0
        }));
    }
    if (spec.by === 'either' && withId.length > 0) {
        const hub = spec.dataId ? preferTrait(withId, 'sensor') : withId;
        return hub.map((endpoint) => ({
            channel: 0,
            subId: endpoint.subDeviceId,
            ...(spec.dataId ? { data: spec.dataId } : {})
        }));
    }

    const targets = spec.data ? preferTrait(withChannel, 'presence') : withChannel;
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
    endpoints: readonly GraphEndpoint[],
    trait: TraitName
): GraphEndpoint[] {
    const matched = endpoints.filter((endpoint) => endpoint.traits.includes(trait));
    return matched.length > 0 ? matched : [...endpoints];
}
