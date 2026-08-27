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
import { CONSUMPTIONX_NAMESPACE } from '../protocol/codecs/consumptionx';
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
import { HUB_TOGGLEX_NAMESPACE } from '../protocol/codecs/multiple';
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
import { DIGEST_TIMERX_NAMESPACE } from '../protocol/codecs/timerx';
import { TOGGLEX_ALL_CHANNELS, TOGGLEX_NAMESPACE } from '../protocol/codecs/togglex';
import { DIGEST_TRIGGERX_NAMESPACE } from '../protocol/codecs/triggerx';
import { CONTROL_WATER_NAMESPACE, DEVICE_CFG_NAMESPACE } from '../protocol/codecs/water';
import type { MerossPayload } from '../protocol/message';
import type { AbilityMap } from './ability';
import {
    CLOUDMQTT_PERIOD_MS,
    ENERGY_CLOUD_PERIOD_MS,
    ENERGY_PERIOD_MS,
    HUB_BATTERY_PERIOD_MS,
    SENSOR_FAST_CLOUD_PERIOD_MS,
    SENSOR_FAST_PERIOD_MS,
    SENSOR_SLOW_CLOUD_PERIOD_MS,
    SENSOR_SLOW_PERIOD_MS,
    SYSTEM_ALL_PERIOD_MS,
    type PollJob,
    type PollStrategy
} from './poller';
import { SYSTEM_ALL_NAMESPACE } from './system-all';

/** LIST GETs need enrolled channels/ids, not just Ability keys. */
export interface PollEndpoint {
    channel?: number;
    subDeviceId?: string;
    traits: readonly TraitName[];
}

interface PollCadence {
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

interface PollSpec extends PollCadence {
    skipIf?: string;
    payload?: PayloadSpec;
    method?: 'GET' | 'PUSH';
}

const DEFAULT: PollCadence = {
    strategy: 'default',
    periodMs: 0,
    periodCloudMs: CLOUDMQTT_PERIOD_MS
};

const ONCE: PollCadence = {
    strategy: 'once',
    periodMs: 0,
    periodCloudMs: 0
};

const SMART_FAST: PollCadence = {
    strategy: 'smart',
    periodMs: SENSOR_FAST_PERIOD_MS,
    periodCloudMs: SENSOR_FAST_CLOUD_PERIOD_MS
};

/** LatestX stays every LAN tick; over MQTT it uses the config cloud floor. */
const SMART_FAST_MQTT: PollCadence = {
    strategy: 'smart',
    periodMs: SENSOR_FAST_PERIOD_MS,
    periodCloudMs: CLOUDMQTT_PERIOD_MS
};

/** Latest is live on LAN; over MQTT it can wait with other slow sensors. */
const SMART_FAST_SLOW_CLOUD: PollCadence = {
    strategy: 'smart',
    periodMs: SENSOR_FAST_PERIOD_MS,
    periodCloudMs: SENSOR_SLOW_CLOUD_PERIOD_MS
};

const SMART_SLOW: PollCadence = {
    strategy: 'smart',
    periodMs: SENSOR_SLOW_PERIOD_MS,
    periodCloudMs: SENSOR_SLOW_CLOUD_PERIOD_MS
};

const SMART_CONFIG: PollCadence = {
    strategy: 'smart',
    periodMs: SENSOR_SLOW_PERIOD_MS,
    periodCloudMs: CLOUDMQTT_PERIOD_MS
};

const SMART_ENERGY: PollCadence = {
    strategy: 'smart',
    periodMs: ENERGY_PERIOD_MS,
    periodCloudMs: ENERGY_CLOUD_PERIOD_MS
};

const SMART_CLOUDMQTT: PollCadence = {
    strategy: 'smart',
    periodMs: CLOUDMQTT_PERIOD_MS,
    periodCloudMs: CLOUDMQTT_PERIOD_MS
};

const SMART_BATTERY: PollCadence = {
    strategy: 'smart',
    periodMs: HUB_BATTERY_PERIOD_MS,
    periodCloudMs: CLOUDMQTT_PERIOD_MS
};

const SMART_ALL: PollCadence = {
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
 */
const POLL: Record<string, PollSpec> = {
    [SYSTEM_ALL_NAMESPACE]: {
        strategy: 'all',
        periodMs: SYSTEM_ALL_PERIOD_MS,
        periodCloudMs: CLOUDMQTT_PERIOD_MS
    },
    'Appliance.System.Runtime': SMART_CONFIG,
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
    [SYSTEM_DEBUG_NAMESPACE]: ONCE,
    [CONFIG_OVERTEMP_NAMESPACE]: SMART_CONFIG,
    [CONTROL_OVERTEMP_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: channelList('overTemp', 'energy')
    },
    [CONFIG_SENSOR_ASSOCIATION_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: channelList('config')
    },
    [CONTROL_ALERT_CONFIG_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: channelList('config')
    },
    [CONFIG_STANDBY_KILLER_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: channelList('config', 'energy')
    },

    // Digest / board state
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
        payload: channelList('fan', 'fan')
    },
    [MP3_NAMESPACE]: {
        ...DEFAULT,
        payload: { dict: 'mp3' }
    },
    [DIFFUSER_LIGHT_NAMESPACE]: DEFAULT,
    [DIFFUSER_SPRAY_NAMESPACE]: DEFAULT,
    [GARAGE_STATE_NAMESPACE]: {
        ...DEFAULT,
        payload: { dict: 'state', channel: TOGGLEX_ALL_CHANNELS }
    },
    [GARAGE_CONFIG_NAMESPACE]: SMART_CONFIG,
    [GARAGE_MULTIPLE_CONFIG_NAMESPACE]: SMART_CONFIG,
    [SHUTTER_POSITION_NAMESPACE]: DEFAULT,
    [SHUTTER_STATE_NAMESPACE]: DEFAULT,
    [SHUTTER_CONFIG_NAMESPACE]: SMART_CONFIG,
    [SHUTTER_ADJUST_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: channelList('adjust', 'cover')
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
        payload: { list: 'effect' }
    },
    [FAN_CONFIG_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: channelList('config', 'fan')
    },
    [FILTER_MAINTENANCE_NAMESPACE]: {
        ...SMART_CLOUDMQTT,
        method: 'PUSH'
    },
    [DIFFUSER_SENSOR_NAMESPACE]: SMART_SLOW,
    [DND_MODE_NAMESPACE]: SMART_CONFIG,
    [PRESENCE_CONFIG_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: channelList('config', 'presence')
    },

    // Energy / fast sensors
    [ELECTRICITY_NAMESPACE]: {
        ...SMART_FAST,
        payload: { dict: 'electricity', channel: 0 }
    },
    [ELECTRICITYX_NAMESPACE]: {
        ...SMART_FAST,
        payload: { dict: 'electricity', channel: ELECTRICITYX_ALL_CHANNELS }
    },
    [CONSUMPTIONX_NAMESPACE]: SMART_ENERGY,
    [CONSUMPTIONH_NAMESPACE]: {
        ...SMART_ENERGY,
        payload: channelList('consumptionH', 'energy')
    },
    [SENSOR_LATESTX_NAMESPACE]: {
        ...SMART_FAST_MQTT,
        payload: {
            list: 'latest',
            by: 'either',
            data: ['presence', 'light'],
            dataId: ['light', 'temp', 'humi']
        }
    },
    [SENSOR_LATEST_NAMESPACE]: {
        ...SMART_FAST_SLOW_CLOUD,
        payload: channelList('latest', 'climate')
    },

    // Timer / trigger indexes
    [DIGEST_TIMERX_NAMESPACE]: ONCE,
    [DIGEST_TRIGGERX_NAMESPACE]: ONCE,

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
        payload: channelList('brightness', 'climate')
    },
    [PHYSICAL_LOCK_NAMESPACE]: {
        ...SMART_CONFIG,
        payload: { list: 'lock', by: 'either', for: 'climate' }
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
 * Builds the board poll table from Ability. LIST payloads come from enrolled
 * endpoints so a strip or hub issues one GET per namespace.
 */
export function buildPollJobs(
    ability: AbilityMap,
    endpoints: readonly PollEndpoint[]
): PollJob[] {
    const jobs: PollJob[] = [];
    for (const [namespace, spec] of Object.entries(POLL)) {
        if (!(namespace in ability)) {
            continue;
        }
        if (spec.skipIf !== undefined && spec.skipIf in ability) {
            continue;
        }
        jobs.push({
            namespace,
            strategy: spec.strategy,
            periodMs: spec.periodMs,
            periodCloudMs: spec.periodCloudMs,
            payload: spec.payload ? encodePayload(spec.payload, endpoints) : {},
            ...(spec.method ? { method: spec.method } : {})
        });
    }
    return jobs;
}

function encodePayload(spec: PayloadSpec, endpoints: readonly PollEndpoint[]): MerossPayload {
    if ('dict' in spec) {
        return {
            [spec.dict]: spec.channel === undefined ? {} : { channel: spec.channel }
        };
    }
    return { [spec.list]: encodeList(spec, endpoints) };
}

function encodeList(
    spec: Extract<PayloadSpec, { list: string }>,
    endpoints: readonly PollEndpoint[]
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

    const board = spec.data ? preferTrait(withChannel, 'presence') : withChannel;
    return board.map((endpoint) => ({
        channel: endpoint.channel,
        ...(spec.data ? { data: spec.data } : {})
    }));
}

/**
 * LatestX is shared by MS600 (presence) and MS130 (hub sensor). Prefer the
 * matching trait so a mixed hub does not GET LatestX for MTS100 children.
 */
function preferTrait(
    endpoints: readonly PollEndpoint[],
    trait: TraitName
): PollEndpoint[] {
    const matched = endpoints.filter((endpoint) => endpoint.traits.includes(trait));
    return matched.length > 0 ? matched : [...endpoints];
}
