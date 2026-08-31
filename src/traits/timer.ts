import { MerossError } from '../errors';
import {
    CONTROL_TIMER_NAMESPACE,
    DIGEST_TIMERX_NAMESPACE,
    TIMERX_NAMESPACE,
    decodeControlTimerPush,
    decodeDigestTimerXGetAck,
    decodeTimerXGetAck,
    decodeTimerXPush,
    encodeControlTimerSet,
    encodeTimerXDelete,
    encodeTimerXGet,
    encodeTimerXSet,
    type MerossMessage,
    type TimerXEntry
} from '../protocol';
import type { RoutedRequestOptions } from '../transport/router';

export type TimerEntry = TimerXEntry;

/** TimerX when advertised; classic Control.Timer only when TimerX is absent. */
export type TimerGeneration = 'x' | 'legacy';

export interface TimerValues {
    entries?: TimerEntry[];
}

/**
 * Partial row for {@link TimerTrait.set}. Missing required wire fields get defaults;
 * `id` is generated when omitted. `on` is required so a "turn off" timer cannot
 * silently default to on.
 */
export type TimerSetInput = Partial<TimerEntry> & {
    time: number;
    week: number;
    on: boolean;
};

/**
 * Transport + channel bind for one TimerX / Control.Timer endpoint. Session
 * supplies this; trait tests inject a fake request/emit pair.
 */
export interface TimerTraitBind {
    uuid: string;
    channel: number;
    /** Chosen at enrollment from Ability: TimerX preferred over Control.Timer. */
    generation: TimerGeneration;
    /**
     * Ability keys advertised by the device. Digest.TimerX listing no-ops when absent.
     */
    namespaces?: ReadonlySet<string>;
    request: (options: Omit<RoutedRequestOptions, 'uuid' | 'ip' | 'encryptionKey'>) => Promise<MerossMessage>;
    emitChange: (values: TimerValues) => void;
}

/**
 * Per-channel clock schedules via Appliance.Control.TimerX (or legacy Timer).
 * Digest.TimerX is only an id index; poller GETACK triggers Control.TimerX
 * GET-by-id in {@link handlePush} (ids are dynamic, not static jobs). Legacy
 * Control.Timer has no Digest — GETACK carries the full list.
 */
export class TimerTrait {
    private readonly bind: TimerTraitBind;
    private entries: TimerEntry[] = [];

    constructor(bind: TimerTraitBind) {
        this.bind = bind;
    }

    /** After digest resolve / set / PUSH. Empty until then. */
    list(): TimerEntry[] {
        return this.entries.map(cloneEntry);
    }

    /**
     * Only ToggleX-shaped extend is written; cover/climate/humidifier/speaker use other extend objects.
     */
    async set(input: TimerSetInput): Promise<TimerEntry> {
        const entry = normalizeSet(input, this.bind.channel);
        if (this.bind.generation === 'legacy') {
            const next = upsertLocal(this.entries, entry);
            await this.bind.request({
                namespace: CONTROL_TIMER_NAMESPACE,
                method: 'SET',
                payload: encodeControlTimerSet(next)
            });
            this.applyEntries(next);
            return cloneEntry(entry);
        }
        await this.bind.request({
            namespace: TIMERX_NAMESPACE,
            method: 'SET',
            payload: encodeTimerXSet(entry)
        });
        this.upsert(entry);
        return cloneEntry(entry);
    }

    async setEnabled(id: string, enabled: boolean): Promise<TimerEntry> {
        const existing = this.entries.find((entry) => entry.id === id);
        if (!existing) {
            throw new MerossError(`Unknown timer id: ${id}`, 'TIMER_NOT_FOUND');
        }
        return this.set({ ...existing, enabled, on: existing.on !== false });
    }

    /**
     * Firmware does not PUSH after DELETE (TimerX) or after a full-list SET
     * (legacy), so the local list updates here.
     */
    async remove(id: string): Promise<void> {
        if (this.bind.generation === 'legacy') {
            const next = this.entries.filter((entry) => entry.id !== id);
            await this.bind.request({
                namespace: CONTROL_TIMER_NAMESPACE,
                method: 'SET',
                payload: encodeControlTimerSet(next)
            });
            this.applyEntries(next);
            return;
        }
        await this.bind.request({
            namespace: TIMERX_NAMESPACE,
            method: 'DELETE',
            payload: encodeTimerXDelete({ id })
        });
        this.applyEntries(this.entries.filter((entry) => entry.id !== id));
    }

    handlePush(message: MerossMessage): void {
        const uuid = message.header.uuid
            ?? /^\/appliance\/([^/]+)\//.exec(message.header.from)?.[1];
        if (!uuid || uuid !== this.bind.uuid) {
            return;
        }
        if (message.header.namespace === CONTROL_TIMER_NAMESPACE && this.bind.generation === 'legacy') {
            // Classic Toggle only applies on channel 0; pre-X Timer is the same device-wide list.
            if (this.bind.channel !== 0) {
                return;
            }
            this.applyEntries(decodeControlTimerPush(message.payload));
            return;
        }
        if (this.bind.generation === 'legacy') {
            return;
        }
        if (message.header.namespace === DIGEST_TIMERX_NAMESPACE) {
            void this.resolveFromDigest(message);
            return;
        }
        if (message.header.namespace !== TIMERX_NAMESPACE) {
            return;
        }
        const next = this.entries.map(cloneEntry);
        for (const entry of decodeTimerXPush(message.payload)) {
            if (entry.channel !== this.bind.channel) {
                continue;
            }
            const index = next.findIndex((item) => item.id === entry.id);
            if (index >= 0) {
                next[index] = cloneEntry(entry);
            } else {
                next.push(cloneEntry(entry));
            }
        }
        this.applyEntries(next);
    }

    private async resolveFromDigest(message: MerossMessage): Promise<void> {
        try {
            const ids = decodeDigestTimerXGetAck(message.payload)
                .filter((row) => row.channel === this.bind.channel)
                .map((row) => row.id);
            const groups = await Promise.all(ids.map(async (id) => {
                try {
                    const reply = await this.bind.request({
                        namespace: TIMERX_NAMESPACE,
                        method: 'GET',
                        payload: encodeTimerXGet({ id })
                    });
                    return decodeTimerXGetAck(reply.payload)
                        .filter((entry) => entry.channel === this.bind.channel);
                } catch {
                    return [];
                }
            }));
            this.applyEntries(groups.flat());
        } catch {
            // Next PUSH or setter call will recover.
        }
    }

    private upsert(entry: TimerEntry): void {
        this.applyEntries(upsertLocal(this.entries, entry));
    }

    private applyEntries(next: TimerEntry[]): void {
        if (sameEntries(this.entries, next)) {
            return;
        }
        this.entries = next.map(cloneEntry);
        this.bind.emitChange({ entries: this.list() });
    }
}

function upsertLocal(entries: TimerEntry[], entry: TimerEntry): TimerEntry[] {
    const next = entries.map(cloneEntry);
    const index = next.findIndex((item) => item.id === entry.id);
    if (index >= 0) {
        next[index] = cloneEntry(entry);
    } else {
        next.push(cloneEntry(entry));
    }
    return next;
}

function normalizeSet(input: TimerSetInput, channel: number): TimerEntry {
    return {
        id: input.id ?? generateTimerId(),
        channel,
        alias: input.alias ?? '',
        enabled: input.enabled !== false,
        type: input.type ?? 1,
        time: input.time,
        week: input.week,
        duration: input.duration ?? 0,
        sunOffset: input.sunOffset ?? 0,
        createTime: input.createTime ?? Math.floor(Date.now() / 1000),
        on: input.on
    };
}

/** 16-ish char id matching firmware app convention (base36 timestamp + random). */
function generateTimerId(): string {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function cloneEntry(entry: TimerEntry): TimerEntry {
    return { ...entry };
}

function sameEntries(left: TimerEntry[], right: TimerEntry[]): boolean {
    return JSON.stringify(sortedEntries(left)) === JSON.stringify(sortedEntries(right));
}

function sortedEntries(entries: TimerEntry[]): TimerEntry[] {
    return [...entries].map(cloneEntry).sort((a, b) => a.id.localeCompare(b.id));
}
