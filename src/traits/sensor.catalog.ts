import {
    CONFIG_SENSOR_ASSOCIATION_NAMESPACE,
    HUB_BATTERY_NAMESPACE,
    HUB_EXCEPTION_NAMESPACE,
    HUB_SENSOR_ADJUST_NAMESPACE,
    HUB_SENSOR_ALERT_NAMESPACE,
    HUB_SENSOR_ALL_NAMESPACE,
    HUB_SENSOR_DOORWINDOW_NAMESPACE,
    HUB_SENSOR_MOTION_NAMESPACE,
    HUB_SENSOR_SMOKE_NAMESPACE,
    HUB_SENSOR_TEMPHUM_NAMESPACE,
    HUB_SENSOR_WATERLEAK_NAMESPACE,
    HUB_SUBDEVICE_VERSION_NAMESPACE,
    SENSOR_LATESTX_NAMESPACE,
    SMOKE_CONFIG_NAMESPACE
} from '../protocol/namespaces';
import {
    DEFAULT,
    SMART_ALL,
    SMART_BATTERY,
    SMART_CLOUDMQTT,
    SMART_CONFIG,
    channelList,
    idList,
    subIdList,
    type PollSpec
} from '../poll/spec';
import type { TraitCatalog } from './descriptor';

export const SensorCatalog: TraitCatalog & { readonly name: 'sensor' } = {
    name: 'sensor',
    push: [
        HUB_SENSOR_TEMPHUM_NAMESPACE,
        HUB_SENSOR_DOORWINDOW_NAMESPACE,
        HUB_SENSOR_WATERLEAK_NAMESPACE,
        HUB_SENSOR_MOTION_NAMESPACE,
        HUB_SENSOR_SMOKE_NAMESPACE,
        SMOKE_CONFIG_NAMESPACE,
        HUB_BATTERY_NAMESPACE,
        HUB_EXCEPTION_NAMESPACE,
        HUB_SUBDEVICE_VERSION_NAMESPACE,
        HUB_SENSOR_ADJUST_NAMESPACE,
        HUB_SENSOR_ALERT_NAMESPACE,
        HUB_SENSOR_ALL_NAMESPACE,
        SENSOR_LATESTX_NAMESPACE,
        CONFIG_SENSOR_ASSOCIATION_NAMESPACE
    ],
    poll: {
        /**
         * Shared with climate board SET/PUSH; keep unfiltered
         * `channelList('config')` so MTS300 GETs are not dropped.
         */
        [CONFIG_SENSOR_ASSOCIATION_NAMESPACE]: {
            ...SMART_CONFIG,
            order: 8,
            payload: channelList('config'),
            item: 30
        },
        [HUB_SENSOR_ALL_NAMESPACE]: {
            ...SMART_ALL,
            order: 75,
            payload: idList('all', 'sensor')
        },
        [HUB_SENSOR_TEMPHUM_NAMESPACE]: {
            ...DEFAULT,
            order: 76,
            skipIf: HUB_SENSOR_ALL_NAMESPACE,
            payload: idList('tempHum', 'sensor')
        },
        [HUB_SENSOR_DOORWINDOW_NAMESPACE]: {
            ...DEFAULT,
            order: 77,
            skipIf: HUB_SENSOR_ALL_NAMESPACE,
            payload: idList('doorWindow', 'sensor')
        },
        [HUB_SENSOR_WATERLEAK_NAMESPACE]: {
            ...DEFAULT,
            order: 78,
            skipIf: HUB_SENSOR_ALL_NAMESPACE,
            payload: idList('waterLeak', 'sensor')
        },
        [HUB_SENSOR_MOTION_NAMESPACE]: {
            ...DEFAULT,
            order: 79,
            skipIf: HUB_SENSOR_ALL_NAMESPACE,
            payload: idList('motion', 'sensor')
        },
        [HUB_SENSOR_SMOKE_NAMESPACE]: {
            ...DEFAULT,
            order: 80,
            skipIf: HUB_SENSOR_ALL_NAMESPACE,
            payload: idList('smokeAlarm', 'sensor')
        },
        /**
         * Shared with sprinkler handlePush; keep unfiltered
         * `idList('battery')` so mixed children stay in the GET.
         */
        [HUB_BATTERY_NAMESPACE]: {
            ...SMART_BATTERY,
            order: 81,
            payload: idList('battery')
        },
        [HUB_SENSOR_ADJUST_NAMESPACE]: {
            ...SMART_CLOUDMQTT,
            order: 83,
            payload: idList('adjust', 'sensor')
        },
        [HUB_SENSOR_ALERT_NAMESPACE]: {
            ...SMART_CONFIG,
            order: 84,
            payload: idList('alert', 'sensor')
        },
        [SMOKE_CONFIG_NAMESPACE]: {
            ...SMART_CONFIG,
            order: 85,
            payload: subIdList('config', 'sensor')
        }
    } satisfies Record<string, PollSpec>
};
