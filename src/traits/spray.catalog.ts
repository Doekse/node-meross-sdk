import { SPRAY_NAMESPACE } from '../protocol/namespaces';
import { DEFAULT, type PollSpec } from '../poll/spec';
import type { TraitCatalog } from './descriptor';

export const SprayCatalog: TraitCatalog & { readonly name: 'spray' } = {
    name: 'spray',
    push: [SPRAY_NAMESPACE],
    poll: {
        [SPRAY_NAMESPACE]: {
            ...DEFAULT,
            order: 14,
            payload: { dict: 'spray' }
        }
    } satisfies Record<string, PollSpec>
};
