import {
    HUB_EXCEPTION_NAMESPACE,
    HUB_SUBDEVICE_VERSION_NAMESPACE,
    HUB_TOGGLEX_NAMESPACE,
    TOGGLE_NAMESPACE,
    TOGGLEX_NAMESPACE
} from '../protocol/namespaces';
import { ALL_CHANNELS, DEFAULT, ONCE, idList, type PollSpec } from '../poll/spec';
import type { TraitCatalog } from './descriptor';

export const SwitchCatalog: TraitCatalog & { readonly name: 'switch' } = {
    name: 'switch',
    push: [
        TOGGLEX_NAMESPACE,
        TOGGLE_NAMESPACE,
        HUB_TOGGLEX_NAMESPACE,
        HUB_EXCEPTION_NAMESPACE,
        HUB_SUBDEVICE_VERSION_NAMESPACE
    ],
    poll: {
        [TOGGLEX_NAMESPACE]: {
            ...DEFAULT,
            order: 11,
            payload: ALL_CHANNELS
        },
        [TOGGLE_NAMESPACE]: {
            ...DEFAULT,
            order: 12,
            payload: { dict: 'toggle' }
        },
        /**
         * Shared with climate hub setOn; keep unfiltered
         * `idList('togglex')` so MTS100 stays in the GET.
         */
        [HUB_TOGGLEX_NAMESPACE]: {
            ...DEFAULT,
            order: 28,
            payload: idList('togglex')
        },
        /**
         * Shared with sensor, sprinkler, climate handlePush; keep unfiltered
         * `idList('version')` so mixed children stay in the GET.
         */
        [HUB_SUBDEVICE_VERSION_NAMESPACE]: {
            ...ONCE,
            order: 82,
            payload: idList('version')
        }
    } satisfies Record<string, PollSpec>
};
