import {
    PRESENCE_CONFIG_NAMESPACE,
    SENSOR_LATESTX_NAMESPACE
} from '../protocol/namespaces';
import {
    SMART_CONFIG,
    SMART_FAST_MQTT,
    channelList,
    type PollSpec
} from '../poll/spec';
import type { TraitCatalog } from './descriptor';

export const PresenceCatalog: TraitCatalog & { readonly name: 'presence' } = {
    name: 'presence',
    push: [SENSOR_LATESTX_NAMESPACE, PRESENCE_CONFIG_NAMESPACE],
    poll: {
        [PRESENCE_CONFIG_NAMESPACE]: {
            ...SMART_CONFIG,
            order: 34,
            payload: channelList('config', 'presence'),
            item: 260
        },
        /**
         * Shared with sensor tempHum handlePush; keep `by: 'either'` + data /
         * dataId so hub children stay in the GET. preferTrait stays in jobs.
         */
        [SENSOR_LATESTX_NAMESPACE]: {
            ...SMART_FAST_MQTT,
            order: 39,
            payload: {
                list: 'latest',
                by: 'either',
                data: ['presence', 'light'],
                dataId: ['light', 'temp', 'humi']
            },
            item: 220
        }
    } satisfies Record<string, PollSpec>
};
