import { uuidFromHeader, type MerossMessage } from './message';
import { PendingRequests } from './pending';

export type DispatchResult = 'reply' | 'push' | 'stale' | 'ignored';

export interface DispatcherHandlers {
    onPush?: (message: MerossMessage) => void;
    onInbound?: (message: MerossMessage, originUuid?: string) => void;
}

/**
 * MQTT reordering is a few seconds. A larger backward jump is NTP correcting
 * the device clock, not a stale PUSH.
 */
const PUSH_STALE_WINDOW_MS = 60_000;

/**
 * Match replies by `messageId`; apply unmatched PUSH in header-time order so
 * MQTT reordering cannot overwrite a newer update. Nested by uuid so
 * {@link forget} can drop one device. Envelopes that name no device share a
 * separate unnamed clock, which is not a uuid and is not dropped with one.
 */
export class ProtocolDispatcher {
    readonly pending = new PendingRequests();
    private readonly lastTs = new Map<string, Map<string, number>>();
    private readonly unnamedLastTs = new Map<string, number>();
    private readonly handlers: DispatcherHandlers;

    constructor(handlers?: DispatcherHandlers | ((message: MerossMessage) => void)) {
        if (typeof handlers === 'function') {
            this.handlers = { onPush: handlers };
        } else {
            this.handlers = handlers ?? {};
        }
    }

    /**
     * meross_lan applies HTTP on the Device that POSTed. Pass that uuid when
     * the envelope cannot identify the device; the stale-PUSH gate uses it too.
     * An empty origin is omitted so it cannot shadow a header uuid.
     */
    handle(message: MerossMessage, originUuid?: string): DispatchResult {
        this.handlers.onInbound?.(message, originUuid);

        if (this.pending.settle(message)) {
            return 'reply';
        }
        if (message.header.method !== 'PUSH') {
            return 'ignored';
        }

        const id = originUuid || uuidFromHeader(message.header);
        const namespace = message.header.namespace;
        const ts = message.header.timestamp * 1000 + (message.header.timestampMs ?? 0);
        const byNs = id ? this.lastTs.get(id) : this.unnamedLastTs;
        const last = byNs?.get(namespace);
        if (last !== undefined && ts < last && last - ts < PUSH_STALE_WINDOW_MS) {
            return 'stale';
        }
        if (!id) {
            this.unnamedLastTs.set(namespace, ts);
        } else if (byNs) {
            byNs.set(namespace, ts);
        } else {
            this.lastTs.set(id, new Map([[namespace, ts]]));
        }
        this.handlers.onPush?.(message);
        return 'push';
    }

    /**
     * Device left or is being rebuilt. A later enrollment of this uuid must
     * not treat a fresh PUSH as stale against the previous runtime's clock.
     * Unnamed envelopes are not a device; `uuid` must be non-empty.
     */
    forget(uuid: string): void {
        if (!uuid) {
            return;
        }
        this.lastTs.delete(uuid);
    }
}
