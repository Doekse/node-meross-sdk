import type { EnrollBoardExtraInput, TraitAttachContext } from '../device/enroll-context';
import { enrollBoardTimerTriggerExtra } from '../device/enroll-helpers';
import type { TraitName } from '../endpoint';
import { CommandError, MerossError } from '../errors';
import {
    CONTROL_TIMER_NAMESPACE,
    DIGEST_TIMERX_NAMESPACE,
    TIMERX_NAMESPACE,
    decodeControlTimerGetAck,
    decodeControlTimerPush,
    decodeDigestTimerXGetAck,
    decodeTimerXGetAck,
    decodeTimerXPush,
    encodeControlTimerGet,
    encodeControlTimerSet,
    encodeDigestTimerXGet,
    encodeTimerXDelete,
    encodeTimerXGet,
    encodeTimerXSet,
    type TimerXEntry
} from '../protocol/codecs/timerx';
import type { MerossMessage } from '../protocol/message';
import type { DeviceRequest } from '../request';
import type { TraitDescriptor } from './descriptor';
import { TimerCatalog } from './timer.catalog';

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
    channel: number;
    /** Chosen at enrollment from Ability: TimerX preferred over Control.Timer. */
    generation: TimerGeneration;
    /**
     * Ability keys advertised by the device. Digest.TimerX listing no-ops when absent.
     */
    namespaces?: ReadonlySet<string>;
    request: DeviceRequest;
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
    /**
     * Unset until a GETACK, PUSH, or write-path GET. `[]` is a real empty
     * list from the device, which legacy SET must not invent.
     */
    private entries?: TimerEntry[];
    /**
     * One in-flight legacy GET, shared by overlapping writes. Cleared when it
     * settles so a failure can be retried.
     */
    private legacyRead?: Promise<void>;

    constructor(bind: TimerTraitBind) {
        this.bind = bind;
    }

    /**
     * Full cache, not the last diff. A subscriber that attaches after enroll
     * never saw the seeded fields, and an unchanged poll does not emit again.
     */
    values(): TimerValues {
        const entries = this.list();
        // Same `[]` before the first resolve and after a real clear, so this
        // cannot claim the schedule is empty.
        if (entries.length === 0) {
            return {};
        }
        return { entries };
    }

    /** After digest resolve, poll, set, or PUSH. Empty until then. */
    list(): TimerEntry[] {
        return this.cached().map(cloneEntry);
    }

    /**
     * On-demand read of the schedule. TimerX GETs Digest.TimerX, then each id;
     * legacy GETs Control.Timer. Rejects with `CommandError` /
     * `TransportError` / `ProtocolError` like `set`. DevicePoller swallows the
     * same failures on its path.
     */
    async poll(): Promise<TimerValues> {
        if (this.bind.generation === 'legacy') {
            await this.fetchLegacyList();
        } else if (
            this.bind.namespaces === undefined
            || this.bind.namespaces.has(DIGEST_TIMERX_NAMESPACE)
        ) {
            const reply = await this.bind.request({
                namespace: DIGEST_TIMERX_NAMESPACE,
                method: 'GET',
                payload: encodeDigestTimerXGet()
            });
            await this.resolveFromDigest(reply);
        }
        return this.values();
    }

    /**
     * Only ToggleX-shaped extend is written; cover/climate/humidifier/speaker use other extend objects.
     */
    async set(input: TimerSetInput): Promise<TimerEntry> {
        const entry = normalizeSet(input, this.bind.channel);
        if (this.bind.generation === 'legacy') {
            await this.ensureLegacyList();
            const next = upsertLocal(this.cached(), entry);
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
        await this.ensureLegacyList();
        const existing = this.cached().find((entry) => entry.id === id);
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
            await this.ensureLegacyList();
            const next = this.cached().filter((entry) => entry.id !== id);
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
        this.applyEntries(this.cached().filter((entry) => entry.id !== id));
    }

    handlePush(message: MerossMessage): void {
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
            void this.resolveFromDigest(message).catch(() => {
                // Keep the previous list; the next digest PUSH reads again.
            });
            return;
        }
        if (message.header.namespace !== TIMERX_NAMESPACE) {
            return;
        }
        const next = this.cached().map(cloneEntry);
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

    /** A non-5050 per-id failure rejects so the previous list stays. */
    private async resolveFromDigest(message: MerossMessage): Promise<void> {
        const ids = decodeDigestTimerXGetAck(message.payload)
            .filter((row) => row.channel === this.bind.channel)
            .map((row) => row.id);
        const groups = await Promise.all(ids.map((id) => this.fetchById(id)));
        this.applyEntries(groups.flat());
    }

    private async fetchById(id: string): Promise<TimerEntry[]> {
        try {
            const reply = await this.bind.request({
                namespace: TIMERX_NAMESPACE,
                method: 'GET',
                payload: encodeTimerXGet({ id })
            });
            return decodeTimerXGetAck(reply.payload)
                .filter((entry) => entry.channel === this.bind.channel);
        } catch (error) {
            // 5050 means this Digest id is already gone, so omit it.
            if (error instanceof CommandError && error.deviceCode === 5050) {
                return [];
            }
            throw error;
        }
    }

    private ensureLegacyList(): Promise<void> {
        if (this.bind.generation !== 'legacy' || this.entries !== undefined) {
            return Promise.resolve();
        }
        if (this.legacyRead) {
            return this.legacyRead;
        }
        const reading = this.fetchLegacyList().finally(() => {
            this.legacyRead = undefined;
        });
        this.legacyRead = reading;
        return reading;
    }

    private async fetchLegacyList(): Promise<void> {
        const reply = await this.bind.request({
            namespace: CONTROL_TIMER_NAMESPACE,
            method: 'GET',
            payload: encodeControlTimerGet()
        });
        this.applyEntries(decodeControlTimerGetAck(reply.payload));
    }

    private cached(): TimerEntry[] {
        return this.entries ?? [];
    }

    private upsert(entry: TimerEntry): void {
        this.applyEntries(upsertLocal(this.cached(), entry));
    }

    private applyEntries(next: TimerEntry[]): void {
        if (this.entries !== undefined && sameEntries(this.entries, next)) {
            return;
        }
        const firstLoad = this.entries === undefined;
        this.entries = next.map(cloneEntry);
        // Unset and a real empty list both look like no rows in values().
        if (firstLoad && next.length === 0) {
            return;
        }
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

function hasTimer(ability: EnrollBoardExtraInput['ability']): boolean {
    return TIMERX_NAMESPACE in ability || CONTROL_TIMER_NAMESPACE in ability;
}

/**
 * Toggle-shaped Timer/TimerX only; cover/climate/humidifier/speaker use other
 * extend objects. Skip when media already claimed the endpoint.
 */
export function enrollBoardTimerExtra(input: EnrollBoardExtraInput): TraitName[] {
    return enrollBoardTimerTriggerExtra(input, hasTimer(input.ability), 'timer');
}

export const descriptor: TraitDescriptor<'timer', TimerTrait> = {
    ...TimerCatalog,
    attach(args: TraitAttachContext<'timer'>): TimerTrait {
        const generation: TimerGeneration = TIMERX_NAMESPACE in args.physical.ability
            ? 'x'
            : 'legacy';
        return new TimerTrait({
            channel: args.channel,
            generation,
            namespaces: args.namespaces,
            request: args.request,
            emitChange: args.emitChange
        });
    }
};
