import {
    CONTROL_TIMER_NAMESPACE,
    DIGEST_TIMERX_NAMESPACE,
    TIMERX_NAMESPACE
} from '../protocol/namespaces';
import { ONCE, SMART_CONFIG, type PollSpec } from '../poll/spec';
import type { TraitCatalog } from './descriptor';

export const TimerCatalog: TraitCatalog & { readonly name: 'timer' } = {
    name: 'timer',
    push: [CONTROL_TIMER_NAMESPACE, DIGEST_TIMERX_NAMESPACE, TIMERX_NAMESPACE],
    poll: {
        [DIGEST_TIMERX_NAMESPACE]: {
            ...ONCE,
            order: 41
        },
        [CONTROL_TIMER_NAMESPACE]: {
            ...SMART_CONFIG,
            order: 43,
            skipIf: TIMERX_NAMESPACE,
            payload: { list: 'timer' }
        }
    } satisfies Record<string, PollSpec>
};
