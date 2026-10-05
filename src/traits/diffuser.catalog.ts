import {
    DIFFUSER_LIGHT_NAMESPACE,
    DIFFUSER_SENSOR_NAMESPACE,
    DIFFUSER_SPRAY_NAMESPACE
} from '../protocol/namespaces';
import { DEFAULT, SMART_SLOW, type PollSpec } from '../poll/spec';
import type { TraitCatalog } from './descriptor';

export const DiffuserCatalog: TraitCatalog & { readonly name: 'diffuser' } = {
    name: 'diffuser',
    push: [
        DIFFUSER_LIGHT_NAMESPACE,
        DIFFUSER_SPRAY_NAMESPACE,
        DIFFUSER_SENSOR_NAMESPACE
    ],
    poll: {
        [DIFFUSER_LIGHT_NAMESPACE]: {
            ...DEFAULT,
            order: 17
        },
        [DIFFUSER_SPRAY_NAMESPACE]: {
            ...DEFAULT,
            order: 18
        },
        [DIFFUSER_SENSOR_NAMESPACE]: {
            ...SMART_SLOW,
            order: 32,
            item: 100
        }
    } satisfies Record<string, PollSpec>
};
