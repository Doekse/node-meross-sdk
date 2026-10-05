import {
    SYSTEM_ALL_NAMESPACE,
    SYSTEM_CLOCK_NAMESPACE,
    SYSTEM_DEBUG_NAMESPACE,
    SYSTEM_FIRMWARE_NAMESPACE,
    SYSTEM_HARDWARE_NAMESPACE,
    SYSTEM_POSITION_NAMESPACE,
    SYSTEM_RUNTIME_NAMESPACE,
    SYSTEM_TIME_NAMESPACE
} from '../protocol/namespaces';
import { ONCE, SMART_CONFIG, SYSTEM_ALL_PERIOD_MS, type PollSpec } from '../poll/spec';
import type { TraitCatalog } from './descriptor';

export const SystemCatalog: TraitCatalog & { readonly name: 'system' } = {
    name: 'system',
    push: [
        SYSTEM_ALL_NAMESPACE,
        SYSTEM_TIME_NAMESPACE,
        SYSTEM_FIRMWARE_NAMESPACE,
        SYSTEM_HARDWARE_NAMESPACE,
        SYSTEM_DEBUG_NAMESPACE,
        SYSTEM_POSITION_NAMESPACE,
        SYSTEM_RUNTIME_NAMESPACE,
        SYSTEM_CLOCK_NAMESPACE
    ],
    poll: {
        [SYSTEM_ALL_NAMESPACE]: {
            strategy: 'all',
            periodMs: SYSTEM_ALL_PERIOD_MS,
            periodCloudMs: 0,
            order: 0,
            base: 1_000
        },
        [SYSTEM_RUNTIME_NAMESPACE]: {
            ...SMART_CONFIG,
            order: 1,
            base: 330
        },
        [SYSTEM_FIRMWARE_NAMESPACE]: {
            ...ONCE,
            order: 2,
            skipIf: SYSTEM_ALL_NAMESPACE
        },
        [SYSTEM_HARDWARE_NAMESPACE]: {
            ...ONCE,
            order: 3,
            skipIf: SYSTEM_ALL_NAMESPACE
        },
        [SYSTEM_TIME_NAMESPACE]: {
            ...SMART_CONFIG,
            order: 4,
            skipIf: SYSTEM_ALL_NAMESPACE
        },
        [SYSTEM_POSITION_NAMESPACE]: {
            ...ONCE,
            order: 5
        },
        [SYSTEM_DEBUG_NAMESPACE]: {
            ...ONCE,
            order: 6,
            base: 1_900
        }
    } satisfies Record<string, PollSpec>
};
