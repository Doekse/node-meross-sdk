import {
    ALARM_CONFIG_NAMESPACE,
    ALARM_NAMESPACE,
    CALIBRATION_NAMESPACE,
    COMPRESSOR_DELAY_NAMESPACE,
    CONFIG_SENSOR_ASSOCIATION_NAMESPACE,
    CTL_RANGE_NAMESPACE,
    DEAD_ZONE_NAMESPACE,
    FROST_NAMESPACE,
    HOLD_ACTION_NAMESPACE,
    HUB_EXCEPTION_NAMESPACE,
    HUB_MTS100_ADJUST_NAMESPACE,
    HUB_MTS100_ALL_NAMESPACE,
    HUB_MTS100_CONFIG_NAMESPACE,
    HUB_MTS100_MODE_NAMESPACE,
    HUB_MTS100_SCHEDULE_NAMESPACE,
    HUB_MTS100_SCHEDULEB_NAMESPACE,
    HUB_MTS100_SUPERCTL_NAMESPACE,
    HUB_MTS100_TEMPERATURE_NAMESPACE,
    HUB_MTS100_TIMESYNC_NAMESPACE,
    HUB_SUBDEVICE_VERSION_NAMESPACE,
    HUB_TOGGLEX_NAMESPACE,
    OVERHEAT_NAMESPACE,
    PHYSICAL_LOCK_NAMESPACE,
    SCHEDULE_NAMESPACE,
    SCHEDULEB_NAMESPACE,
    SCREEN_BRIGHTNESS_NAMESPACE,
    SENSOR_LATEST_NAMESPACE,
    SENSOR_NAMESPACE,
    SUMMER_MODE_NAMESPACE,
    TEMP_UNIT_NAMESPACE,
    THERMOSTAT_MODE_NAMESPACE,
    THERMOSTAT_MODEB_NAMESPACE,
    THERMOSTAT_MODEC_NAMESPACE,
    THERMOSTAT_SYSTEM_NAMESPACE,
    TIMER_NAMESPACE,
    WINDOW_OPENED_NAMESPACE
} from '../protocol/namespaces';
import {
    DEFAULT,
    ONCE,
    SMART_ALL,
    SMART_CLOUDMQTT,
    SMART_CONFIG,
    SMART_FAST_SLOW_CLOUD,
    SMART_SLOW,
    channelList,
    idList,
    type PollSpec
} from '../poll/spec';
import type { TraitCatalog } from './descriptor';

export const ClimateCatalog: TraitCatalog & { readonly name: 'climate' } = {
    name: 'climate',
    push: [
        HUB_MTS100_ALL_NAMESPACE,
        HUB_TOGGLEX_NAMESPACE,
        HUB_EXCEPTION_NAMESPACE,
        HUB_SUBDEVICE_VERSION_NAMESPACE,
        HUB_MTS100_MODE_NAMESPACE,
        HUB_MTS100_TEMPERATURE_NAMESPACE,
        HUB_MTS100_ADJUST_NAMESPACE,
        HUB_MTS100_CONFIG_NAMESPACE,
        HUB_MTS100_SUPERCTL_NAMESPACE,
        HUB_MTS100_SCHEDULE_NAMESPACE,
        HUB_MTS100_SCHEDULEB_NAMESPACE,
        HUB_MTS100_TIMESYNC_NAMESPACE,
        PHYSICAL_LOCK_NAMESPACE,
        THERMOSTAT_MODE_NAMESPACE,
        THERMOSTAT_MODEB_NAMESPACE,
        THERMOSTAT_MODEC_NAMESPACE,
        HOLD_ACTION_NAMESPACE,
        WINDOW_OPENED_NAMESPACE,
        SENSOR_NAMESPACE,
        FROST_NAMESPACE,
        CALIBRATION_NAMESPACE,
        OVERHEAT_NAMESPACE,
        DEAD_ZONE_NAMESPACE,
        SUMMER_MODE_NAMESPACE,
        COMPRESSOR_DELAY_NAMESPACE,
        CTL_RANGE_NAMESPACE,
        TIMER_NAMESPACE,
        ALARM_NAMESPACE,
        ALARM_CONFIG_NAMESPACE,
        SCHEDULE_NAMESPACE,
        SCHEDULEB_NAMESPACE,
        TEMP_UNIT_NAMESPACE,
        SCREEN_BRIGHTNESS_NAMESPACE,
        SENSOR_LATEST_NAMESPACE,
        THERMOSTAT_SYSTEM_NAMESPACE,
        CONFIG_SENSOR_ASSOCIATION_NAMESPACE
    ],
    poll: {
        [SENSOR_LATEST_NAMESPACE]: {
            ...SMART_FAST_SLOW_CLOUD,
            order: 40,
            payload: channelList('latest', 'climate'),
            item: 80
        },
        [THERMOSTAT_MODE_NAMESPACE]: {
            ...DEFAULT,
            order: 45,
            payload: channelList('mode', 'climate')
        },
        [THERMOSTAT_MODEB_NAMESPACE]: {
            ...DEFAULT,
            order: 46,
            payload: channelList('modeB', 'climate')
        },
        [THERMOSTAT_MODEC_NAMESPACE]: {
            ...DEFAULT,
            order: 47,
            payload: channelList('control', 'climate')
        },
        [TIMER_NAMESPACE]: {
            ...DEFAULT,
            order: 48,
            payload: channelList('timer', 'climate')
        },
        [ALARM_NAMESPACE]: {
            ...DEFAULT,
            order: 49,
            payload: channelList('alarm', 'climate')
        },
        [HOLD_ACTION_NAMESPACE]: {
            ...SMART_CONFIG,
            order: 50,
            payload: channelList('holdAction', 'climate')
        },
        [WINDOW_OPENED_NAMESPACE]: {
            ...SMART_SLOW,
            order: 51,
            payload: channelList('windowOpened', 'climate')
        },
        [SENSOR_NAMESPACE]: {
            ...SMART_SLOW,
            order: 52,
            payload: channelList('sensor', 'climate')
        },
        [CALIBRATION_NAMESPACE]: {
            ...SMART_CONFIG,
            order: 53,
            payload: channelList('calibration', 'climate')
        },
        [DEAD_ZONE_NAMESPACE]: {
            ...SMART_CONFIG,
            order: 54,
            payload: channelList('deadZone', 'climate')
        },
        [SUMMER_MODE_NAMESPACE]: {
            ...SMART_CONFIG,
            order: 55,
            payload: channelList('summerMode', 'climate')
        },
        [COMPRESSOR_DELAY_NAMESPACE]: {
            ...SMART_CONFIG,
            order: 56,
            payload: channelList('delay', 'climate')
        },
        [ALARM_CONFIG_NAMESPACE]: {
            ...SMART_CONFIG,
            order: 57,
            payload: channelList('alarmConfig', 'climate')
        },
        [SCHEDULE_NAMESPACE]: {
            ...SMART_CONFIG,
            order: 58,
            payload: channelList('schedule', 'climate')
        },
        [SCHEDULEB_NAMESPACE]: {
            ...SMART_CONFIG,
            order: 59,
            payload: channelList('scheduleB', 'climate')
        },
        [TEMP_UNIT_NAMESPACE]: {
            ...SMART_CONFIG,
            order: 60,
            payload: channelList('tempUnit', 'climate')
        },
        [SCREEN_BRIGHTNESS_NAMESPACE]: {
            ...SMART_CONFIG,
            order: 61,
            payload: channelList('brightness', 'climate'),
            item: 70
        },
        [PHYSICAL_LOCK_NAMESPACE]: {
            ...SMART_CONFIG,
            order: 62,
            payload: { list: 'lock', by: 'either', for: 'climate' },
            item: 35
        },
        [FROST_NAMESPACE]: {
            ...SMART_SLOW,
            order: 63,
            payload: channelList('frost', 'climate')
        },
        [OVERHEAT_NAMESPACE]: {
            ...SMART_SLOW,
            order: 64,
            payload: channelList('overheat', 'climate')
        },
        [CTL_RANGE_NAMESPACE]: {
            ...ONCE,
            order: 65,
            payload: channelList('ctlRange', 'climate')
        },
        [HUB_MTS100_ALL_NAMESPACE]: {
            ...SMART_ALL,
            order: 66,
            payload: idList('all', 'climate')
        },
        [HUB_MTS100_MODE_NAMESPACE]: {
            ...DEFAULT,
            order: 67,
            skipIf: HUB_MTS100_ALL_NAMESPACE,
            payload: idList('mode', 'climate')
        },
        [HUB_MTS100_TEMPERATURE_NAMESPACE]: {
            ...DEFAULT,
            order: 68,
            skipIf: HUB_MTS100_ALL_NAMESPACE,
            payload: idList('temperature', 'climate')
        },
        [HUB_MTS100_ADJUST_NAMESPACE]: {
            ...SMART_CLOUDMQTT,
            order: 69,
            payload: idList('adjust', 'climate')
        },
        [HUB_MTS100_CONFIG_NAMESPACE]: {
            ...SMART_CONFIG,
            order: 70,
            payload: idList('config', 'climate')
        },
        [HUB_MTS100_SUPERCTL_NAMESPACE]: {
            ...SMART_CONFIG,
            order: 71,
            payload: idList('superCtl', 'climate')
        },
        [HUB_MTS100_TIMESYNC_NAMESPACE]: {
            ...SMART_CONFIG,
            order: 72,
            payload: idList('timeSync', 'climate')
        },
        [HUB_MTS100_SCHEDULE_NAMESPACE]: {
            ...SMART_CLOUDMQTT,
            order: 73,
            payload: idList('schedule', 'climate')
        },
        [HUB_MTS100_SCHEDULEB_NAMESPACE]: {
            ...SMART_CLOUDMQTT,
            order: 74,
            payload: idList('schedule', 'climate')
        }
    } satisfies Record<string, PollSpec>
};
