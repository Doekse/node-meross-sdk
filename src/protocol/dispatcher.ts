import type { MerossMessage } from './message';
import { PendingRequests } from './pending';

export type DispatchResult = 'reply' | 'push' | 'stale' | 'ignored';

/**
 * Match replies by `messageId`; apply unmatched PUSH in header-time order so
 * MQTT reordering cannot overwrite a newer update. One dispatcher serves the
 * whole session, so the gate key includes the appliance id.
 */
export class ProtocolDispatcher {
    readonly pending = new PendingRequests();
    private readonly lastTs = new Map<string, number>();

    constructor(private readonly onPush?: (message: MerossMessage) => void) {}

    handle(message: MerossMessage): DispatchResult {
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
        if (last !== undefined && ts < last) {
            return 'stale';
        }
        this.lastTs.set(key, ts);
        this.onPush?.(message);
        return 'push';
    }
}
