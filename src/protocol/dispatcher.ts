import type { MerossMessage } from './message';
import { PendingRequests } from './pending';

export type DispatchResult = 'reply' | 'push' | 'stale' | 'ignored';

export interface DispatcherHandlers {
    onPush?: (message: MerossMessage) => void;
    onInbound?: (message: MerossMessage) => void;
}

/**
 * MQTT reordering is a few seconds. A larger backward jump is NTP correcting
 * the device clock, not a stale PUSH.
 */
const PUSH_STALE_WINDOW_MS = 60_000;

/**
 * Match replies by `messageId`; apply unmatched PUSH in header-time order so
 * MQTT reordering cannot overwrite a newer update. One dispatcher serves the
 * whole session, so the gate key includes the appliance id.
 */
export class ProtocolDispatcher {
    readonly pending = new PendingRequests();
    private readonly lastTs = new Map<string, number>();
    private readonly handlers: DispatcherHandlers;

    constructor(handlers?: DispatcherHandlers | ((message: MerossMessage) => void)) {
        if (typeof handlers === 'function') {
            this.handlers = { onPush: handlers };
        } else {
            this.handlers = handlers ?? {};
        }
    }

    handle(message: MerossMessage): DispatchResult {
        this.handlers.onInbound?.(message);

        if (this.pending.settle(message)) {
            return 'reply';
        }
        if (message.header.method !== 'PUSH') {
            return 'ignored';
        }

        const id = message.header.uuid
            ?? /^\/appliance\/([^/]+)\//.exec(message.header.from)?.[1];
        const key = id ? `${id}:${message.header.namespace}` : message.header.namespace;
        const ts = message.header.timestamp * 1000 + (message.header.timestampMs ?? 0);
        const last = this.lastTs.get(key);
        if (last !== undefined && ts < last && last - ts < PUSH_STALE_WINDOW_MS) {
            return 'stale';
        }
        this.lastTs.set(key, ts);
        this.handlers.onPush?.(message);
        return 'push';
    }
}
