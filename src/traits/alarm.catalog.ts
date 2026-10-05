import {
    CONTROL_ALARM_NAMESPACE,
    CONTROL_BEEP_NAMESPACE
} from '../protocol/namespaces';
import { DEFAULT, SMART_CONFIG, channelList, type PollSpec } from '../poll/spec';
import type { TraitCatalog } from './descriptor';

export const AlarmCatalog: TraitCatalog & { readonly name: 'alarm' } = {
    name: 'alarm',
    push: [CONTROL_ALARM_NAMESPACE, CONTROL_BEEP_NAMESPACE],
    poll: {
        [CONTROL_ALARM_NAMESPACE]: {
            ...DEFAULT,
            order: 26,
            payload: channelList('alarm', 'alarm')
        },
        [CONTROL_BEEP_NAMESPACE]: {
            ...SMART_CONFIG,
            order: 27,
            payload: channelList('alarm', 'alarm')
        }
    } satisfies Record<string, PollSpec>
};
