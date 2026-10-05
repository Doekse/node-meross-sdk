import {
    CONFIG_OVERTEMP_NAMESPACE,
    CONTROL_OVERTEMP_NAMESPACE
} from '../protocol/namespaces';
import { SMART_CONFIG, type PollSpec } from '../poll/spec';
import type { TraitCatalog } from './descriptor';

export const OverTempCatalog: TraitCatalog & { readonly name: 'overtemp' } = {
    name: 'overtemp',
    push: [CONFIG_OVERTEMP_NAMESPACE, CONTROL_OVERTEMP_NAMESPACE],
    poll: {
        [CONFIG_OVERTEMP_NAMESPACE]: {
            ...SMART_CONFIG,
            order: 7,
            payload: { dict: 'overTemp' },
            base: 340
        }
    } satisfies Record<string, PollSpec>
};
