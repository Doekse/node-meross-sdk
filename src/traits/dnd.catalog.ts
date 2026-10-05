import { DND_MODE_NAMESPACE } from '../protocol/namespaces';
import { SMART_CONFIG, type PollSpec } from '../poll/spec';
import type { TraitCatalog } from './descriptor';

export const DndCatalog: TraitCatalog & { readonly name: 'dnd' } = {
    name: 'dnd',
    push: [DND_MODE_NAMESPACE],
    poll: {
        [DND_MODE_NAMESPACE]: {
            ...SMART_CONFIG,
            order: 33,
            payload: { dict: 'DNDMode' },
            base: 320
        }
    } satisfies Record<string, PollSpec>
};
