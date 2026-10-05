import { CONFIG_STANDBY_KILLER_NAMESPACE } from '../protocol/namespaces';
import { SMART_CONFIG, channelList, type PollSpec } from '../poll/spec';
import type { TraitCatalog } from './descriptor';

export const StandbyKillerCatalog: TraitCatalog & { readonly name: 'standbykiller' } = {
    name: 'standbykiller',
    push: [CONFIG_STANDBY_KILLER_NAMESPACE],
    poll: {
        [CONFIG_STANDBY_KILLER_NAMESPACE]: {
            ...SMART_CONFIG,
            order: 10,
            payload: channelList('config', 'standbykiller')
        }
    } satisfies Record<string, PollSpec>
};
