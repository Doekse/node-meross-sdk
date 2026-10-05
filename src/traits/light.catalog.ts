import {
    LIGHT_EFFECT_NAMESPACE,
    LIGHT_NAMESPACE,
    TOGGLE_NAMESPACE,
    TOGGLEX_NAMESPACE
} from '../protocol/namespaces';
import { DEFAULT, SMART_CONFIG, type PollSpec } from '../poll/spec';
import type { TraitCatalog } from './descriptor';

export const LightCatalog: TraitCatalog & { readonly name: 'light' } = {
    name: 'light',
    push: [
        TOGGLEX_NAMESPACE,
        TOGGLE_NAMESPACE,
        LIGHT_NAMESPACE,
        LIGHT_EFFECT_NAMESPACE
    ],
    poll: {
        [LIGHT_NAMESPACE]: {
            ...DEFAULT,
            order: 13
        },
        [LIGHT_EFFECT_NAMESPACE]: {
            ...SMART_CONFIG,
            order: 29,
            payload: { list: 'effect' },
            base: 1_850
        }
    } satisfies Record<string, PollSpec>
};
