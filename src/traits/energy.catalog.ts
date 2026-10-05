import { consumptionXDays } from '../protocol/codecs/consumptionx';
import {
    CONSUMPTIONH_NAMESPACE,
    CONSUMPTIONX_NAMESPACE,
    ELECTRICITY_NAMESPACE,
    ELECTRICITYX_ALL_CHANNELS,
    ELECTRICITYX_NAMESPACE
} from '../protocol/namespaces';
import {
    SMART_ENERGY,
    SMART_FAST,
    channelList,
    pollSpecSize,
    type PollSpec
} from '../poll/spec';
import type { TraitCatalog } from './descriptor';

/** Shared with calibrate so packing cannot drift from the POLL row. */
const CONSUMPTIONX_SIZE = { base: 320, item: 53 } as const;

export const EnergyCatalog: TraitCatalog & { readonly name: 'energy' } = {
    name: 'energy',
    push: [
        ELECTRICITY_NAMESPACE,
        ELECTRICITYX_NAMESPACE,
        CONSUMPTIONX_NAMESPACE,
        CONSUMPTIONH_NAMESPACE
    ],
    poll: {
        [ELECTRICITY_NAMESPACE]: {
            ...SMART_FAST,
            order: 35,
            payload: { dict: 'electricity', channel: 0 },
            base: 430
        },
        [ELECTRICITYX_NAMESPACE]: {
            ...SMART_FAST,
            order: 36,
            payload: { dict: 'electricity', channel: ELECTRICITYX_ALL_CHANNELS },
            item: 100
        },
        [CONSUMPTIONX_NAMESPACE]: {
            ...SMART_ENERGY,
            order: 37,
            ...CONSUMPTIONX_SIZE,
            calibrate: (payload) => {
                const days = consumptionXDays(payload);
                if (days === undefined) {
                    return undefined;
                }
                return pollSpecSize(CONSUMPTIONX_SIZE, days.length);
            }
        },
        [CONSUMPTIONH_NAMESPACE]: {
            ...SMART_ENERGY,
            order: 38,
            payload: channelList('consumptionH', 'energy'),
            base: 320,
            item: 1_900
        }
    } satisfies Record<string, PollSpec>
};
