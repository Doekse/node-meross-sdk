import {
    CONTROL_ALERT_CONFIG_NAMESPACE,
    CONTROL_ALERT_REPORT_NAMESPACE
} from '../protocol/namespaces';
import { SMART_CONFIG, channelList, type PollSpec } from '../poll/spec';
import type { TraitCatalog } from './descriptor';

export const AlertCatalog: TraitCatalog & { readonly name: 'alert' } = {
    name: 'alert',
    push: [CONTROL_ALERT_CONFIG_NAMESPACE, CONTROL_ALERT_REPORT_NAMESPACE],
    poll: {
        [CONTROL_ALERT_CONFIG_NAMESPACE]: {
            ...SMART_CONFIG,
            order: 9,
            payload: channelList('config', 'alert')
        }
    } satisfies Record<string, PollSpec>
};
