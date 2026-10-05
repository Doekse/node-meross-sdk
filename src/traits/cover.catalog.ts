import {
    GARAGE_CONFIG_NAMESPACE,
    GARAGE_MULTIPLE_CONFIG_NAMESPACE,
    GARAGE_STATE_NAMESPACE,
    SHUTTER_ADJUST_NAMESPACE,
    SHUTTER_CONFIG_NAMESPACE,
    SHUTTER_POSITION_NAMESPACE,
    SHUTTER_STATE_NAMESPACE,
    TOGGLEX_ALL_CHANNELS
} from '../protocol/namespaces';
import { DEFAULT, SMART_CONFIG, channelList, type PollSpec } from '../poll/spec';
import type { TraitCatalog } from './descriptor';

export const CoverCatalog: TraitCatalog & { readonly name: 'cover' } = {
    name: 'cover',
    push: [
        GARAGE_STATE_NAMESPACE,
        GARAGE_MULTIPLE_CONFIG_NAMESPACE,
        GARAGE_CONFIG_NAMESPACE,
        SHUTTER_POSITION_NAMESPACE,
        SHUTTER_STATE_NAMESPACE,
        SHUTTER_CONFIG_NAMESPACE
    ],
    poll: {
        [GARAGE_STATE_NAMESPACE]: {
            ...DEFAULT,
            order: 19,
            payload: { dict: 'state', channel: TOGGLEX_ALL_CHANNELS }
        },
        [GARAGE_CONFIG_NAMESPACE]: {
            ...SMART_CONFIG,
            order: 20,
            base: 410
        },
        [GARAGE_MULTIPLE_CONFIG_NAMESPACE]: {
            ...SMART_CONFIG,
            order: 21,
            item: 140
        },
        [SHUTTER_POSITION_NAMESPACE]: {
            ...DEFAULT,
            order: 22,
            item: 50
        },
        [SHUTTER_STATE_NAMESPACE]: {
            ...DEFAULT,
            order: 23,
            item: 40
        },
        [SHUTTER_CONFIG_NAMESPACE]: {
            ...SMART_CONFIG,
            order: 24,
            item: 70
        },
        [SHUTTER_ADJUST_NAMESPACE]: {
            ...SMART_CONFIG,
            order: 25,
            payload: channelList('adjust', 'cover'),
            item: 35
        }
    } satisfies Record<string, PollSpec>
};
