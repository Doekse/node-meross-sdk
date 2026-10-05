import {
    CONTROL_TRIGGER_NAMESPACE,
    DIGEST_TRIGGERX_NAMESPACE,
    TRIGGERX_NAMESPACE
} from '../protocol/namespaces';
import { ONCE, SMART_CONFIG, type PollSpec } from '../poll/spec';
import type { TraitCatalog } from './descriptor';

export const TriggerCatalog: TraitCatalog & { readonly name: 'trigger' } = {
    name: 'trigger',
    push: [CONTROL_TRIGGER_NAMESPACE, DIGEST_TRIGGERX_NAMESPACE, TRIGGERX_NAMESPACE],
    poll: {
        [DIGEST_TRIGGERX_NAMESPACE]: {
            ...ONCE,
            order: 42
        },
        [CONTROL_TRIGGER_NAMESPACE]: {
            ...SMART_CONFIG,
            order: 44,
            skipIf: TRIGGERX_NAMESPACE,
            payload: { dict: 'trigger' }
        }
    } satisfies Record<string, PollSpec>
};
