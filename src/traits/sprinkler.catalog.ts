import {
    CONTROL_WATER_EVENT_NAMESPACE,
    CONTROL_WATER_NAMESPACE,
    DEVICE_CFG_NAMESPACE,
    HUB_BATTERY_NAMESPACE,
    HUB_EXCEPTION_NAMESPACE,
    HUB_SUBDEVICE_VERSION_NAMESPACE
} from '../protocol/namespaces';
import { DEFAULT, SMART_CONFIG, subIdList, type PollSpec } from '../poll/spec';
import type { TraitCatalog } from './descriptor';

export const SprinklerCatalog: TraitCatalog & { readonly name: 'sprinkler' } = {
    name: 'sprinkler',
    push: [
        CONTROL_WATER_NAMESPACE,
        CONTROL_WATER_EVENT_NAMESPACE,
        DEVICE_CFG_NAMESPACE,
        HUB_BATTERY_NAMESPACE,
        HUB_EXCEPTION_NAMESPACE,
        HUB_SUBDEVICE_VERSION_NAMESPACE
    ],
    poll: {
        [CONTROL_WATER_NAMESPACE]: {
            ...DEFAULT,
            order: 86,
            payload: subIdList('control', 'sprinkler')
        },
        [DEVICE_CFG_NAMESPACE]: {
            ...SMART_CONFIG,
            order: 87,
            payload: subIdList('config', 'sprinkler')
        }
    } satisfies Record<string, PollSpec>
};
