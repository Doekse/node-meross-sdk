import {
    FAN_CONFIG_NAMESPACE,
    FAN_NAMESPACE,
    FILTER_MAINTENANCE_NAMESPACE,
    TOGGLE_NAMESPACE,
    TOGGLEX_NAMESPACE
} from '../protocol/namespaces';
import {
    DEFAULT,
    SMART_CLOUDMQTT,
    SMART_CONFIG,
    channelList,
    type PollSpec
} from '../poll/spec';
import type { TraitCatalog } from './descriptor';

export const FanCatalog: TraitCatalog & { readonly name: 'fan' } = {
    name: 'fan',
    push: [
        TOGGLEX_NAMESPACE,
        TOGGLE_NAMESPACE,
        FAN_NAMESPACE,
        FAN_CONFIG_NAMESPACE,
        FILTER_MAINTENANCE_NAMESPACE
    ],
    poll: {
        [FAN_NAMESPACE]: {
            ...DEFAULT,
            order: 15,
            payload: channelList('fan', 'fan'),
            item: 20
        },
        [FAN_CONFIG_NAMESPACE]: {
            ...SMART_CONFIG,
            order: 30,
            payload: channelList('config', 'fan')
        },
        [FILTER_MAINTENANCE_NAMESPACE]: {
            ...SMART_CLOUDMQTT,
            order: 31,
            method: 'PUSH',
            item: 35
        }
    } satisfies Record<string, PollSpec>
};
