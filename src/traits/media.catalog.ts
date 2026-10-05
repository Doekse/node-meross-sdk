import { MP3_NAMESPACE } from '../protocol/namespaces';
import { DEFAULT, type PollSpec } from '../poll/spec';
import type { TraitCatalog } from './descriptor';

export const MediaCatalog: TraitCatalog & { readonly name: 'media' } = {
    name: 'media',
    push: [MP3_NAMESPACE],
    poll: {
        [MP3_NAMESPACE]: {
            ...DEFAULT,
            order: 16,
            payload: { dict: 'mp3' },
            base: 380
        }
    } satisfies Record<string, PollSpec>
};
