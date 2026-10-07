import type { TraitAttachContext } from '../device/enroll-context';
import type { TriggerTraitBind } from '../device/bindings';
import { CommandError, MerossError } from '../errors';
import {
    CONTROL_TRIGGER_NAMESPACE,
    DIGEST_TRIGGERX_NAMESPACE,
    TRIGGERX_NAMESPACE,
    decodeControlTriggerGetAck,
    decodeControlTriggerPush,
    decodeDigestTriggerXGetAck,
    decodeTriggerXGetAck,
    decodeTriggerXPush,
    encodeControlTriggerGet,
    encodeControlTriggerSet,
    encodeTriggerXDelete,
    encodeTriggerXGet,
    encodeTriggerXSet,
    type TriggerXEntry,
    type TriggerXRule
} from '../protocol/codecs/triggerx';
import type { MerossMessage } from '../protocol/message';
import type { TraitDescriptor } from './descriptor';
import { TriggerCatalog } from './trigger.catalog';

export type TriggerEntry = TriggerXEntry;
export type TriggerRule = TriggerXRule;

/** TriggerX when advertised; classic Control.Trigger only when TriggerX is absent. */
export type TriggerGeneration = 'x' | 'legacy';

export interface TriggerValues {
    entries?: TriggerEntry[];
}

/**
 * Partial row for {@link TriggerTrait.set}. Missing required wire fields get defaults;
 * `id` is generated when omitted. `rule` is required so a countdown cannot silently
 * default to zero duration.
 */
export type TriggerSetInput = Partial<TriggerEntry> & {
    rule: TriggerRule;
};

/**
 * Per-channel countdowns via Appliance.Control.TriggerX (or legacy Trigger).
 * Digest.TriggerX is only an id index; poller GETACK triggers Control.TriggerX
 * GET-by-id in {@link handlePush} (ids are dynamic, not static jobs). Legacy
 * Control.Trigger has no Digest — GETACK/PUSH carry the full list.
 */
export class TriggerTrait {
    /** @internal */
    private readonly bind: TriggerTraitBind;
    /**
     * Unset until a GETACK, PUSH, or write-path GET. `[]` is a real empty
     * list from the device, which legacy SET must not invent.
     */
    private entries?: TriggerEntry[];
    /**
     * One in-flight legacy GET, shared by overlapping writes. Cleared when it
     * settles so a failure can be retried.
     */
    private legacyRead?: Promise<void>;

    /** @internal */
    constructor(bind: TriggerTraitBind) {
        this.bind = bind;
    }

    /**
     * Full cache, not the last diff. A subscriber that attaches after enroll
     * never saw the seeded fields, and an unchanged poll does not emit again.
     */
    values(): TriggerValues {
        const entries = this.list();
        // Same `[]` before the first resolve and after a real clear, so this
        // cannot claim the schedule is empty.
        if (entries.length === 0) {
            return {};
        }
        return { entries };
    }

    /** After digest resolve / set / PUSH. Empty until then. */
    list(): TriggerEntry[] {
        return this.cached().map(cloneEntry);
    }

    async set(input: TriggerSetInput): Promise<TriggerEntry> {
        const entry = normalizeSet(input, this.bind.channel);
        if (this.bind.generation === 'legacy') {
            await this.ensureLegacyList();
            const next = upsertLocal(this.cached(), entry);
            await this.bind.request({
                namespace: CONTROL_TRIGGER_NAMESPACE,
                method: 'SET',
                payload: encodeControlTriggerSet(next)
            });
            this.applyEntries(next);
            return cloneEntry(entry);
        }
        await this.bind.request({
            namespace: TRIGGERX_NAMESPACE,
            method: 'SET',
            payload: encodeTriggerXSet(entry)
        });
        this.upsert(entry);
        return cloneEntry(entry);
    }

    async setEnabled(id: string, enabled: boolean): Promise<TriggerEntry> {
        await this.ensureLegacyList();
        const existing = this.cached().find((entry) => entry.id === id);
        if (!existing) {
            throw new MerossError(`Unknown trigger id: ${id}`, 'TRIGGER_NOT_FOUND');
        }
        return this.set({ ...existing, enabled });
    }

    /**
     * Firmware does not PUSH after DELETE (TriggerX) or after a full-list SET
     * (legacy), so the local list updates here.
     */
    async remove(id: string): Promise<void> {
        if (this.bind.generation === 'legacy') {
            await this.ensureLegacyList();
            const next = this.cached().filter((entry) => entry.id !== id);
            await this.bind.request({
                namespace: CONTROL_TRIGGER_NAMESPACE,
                method: 'SET',
                payload: encodeControlTriggerSet(next)
            });
            this.applyEntries(next);
            return;
        }
        await this.bind.request({
            namespace: TRIGGERX_NAMESPACE,
            method: 'DELETE',
            payload: encodeTriggerXDelete({ id })
        });
        this.applyEntries(this.cached().filter((entry) => entry.id !== id));
    }

    /**
     * PUSH/GETACK from DeviceRuntime. Hosts subscribe to Endpoint `change`.
     *
     * @internal
     * @package
     */
    handlePush(message: MerossMessage): void {
        if (message.header.namespace === CONTROL_TRIGGER_NAMESPACE && this.bind.generation === 'legacy') {
            // Classic Toggle only applies on channel 0; pre-X Trigger is the same device-wide list.
            if (this.bind.channel !== 0) {
                return;
            }
            this.applyEntries(decodeControlTriggerPush(message.payload));
            return;
        }
        if (this.bind.generation === 'legacy') {
            return;
        }
        if (message.header.namespace === DIGEST_TRIGGERX_NAMESPACE) {
            void this.resolveFromDigest(message).catch(() => {
                // Keep the previous list; the next digest PUSH reads again.
            });
            return;
        }
        if (message.header.namespace !== TRIGGERX_NAMESPACE) {
            return;
        }
        const next = this.cached().map(cloneEntry);
        for (const entry of decodeTriggerXPush(message.payload)) {
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
        const ids = decodeDigestTriggerXGetAck(message.payload)
            .filter((row) => row.channel === this.bind.channel)
            .map((row) => row.id);
        const groups = await Promise.all(ids.map((id) => this.fetchById(id)));
        this.applyEntries(groups.flat());
    }

    private async fetchById(id: string): Promise<TriggerEntry[]> {
        try {
            const reply = await this.bind.request({
                namespace: TRIGGERX_NAMESPACE,
                method: 'GET',
                payload: encodeTriggerXGet({ id })
            });
            return decodeTriggerXGetAck(reply.payload)
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
            namespace: CONTROL_TRIGGER_NAMESPACE,
            method: 'GET',
            payload: encodeControlTriggerGet()
        });
        this.applyEntries(decodeControlTriggerGetAck(reply.payload));
    }

    private cached(): TriggerEntry[] {
        return this.entries ?? [];
    }

    private upsert(entry: TriggerEntry): void {
        this.applyEntries(upsertLocal(this.cached(), entry));
    }

    private applyEntries(next: TriggerEntry[]): void {
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

function upsertLocal(entries: TriggerEntry[], entry: TriggerEntry): TriggerEntry[] {
    const next = entries.map(cloneEntry);
    const index = next.findIndex((item) => item.id === entry.id);
    if (index >= 0) {
        next[index] = cloneEntry(entry);
    } else {
        next.push(cloneEntry(entry));
    }
    return next;
}

function normalizeSet(input: TriggerSetInput, channel: number): TriggerEntry {
    return {
        id: input.id ?? generateTriggerId(),
        channel,
        alias: input.alias ?? '',
        enabled: input.enabled !== false,
        type: input.type ?? 1,
        createTime: input.createTime ?? Math.floor(Date.now() / 1000),
        rule: {
            duration: input.rule.duration,
            week: input.rule.week
        }
    };
}

/** 16-ish char id matching firmware app convention (base36 timestamp + random). */
function generateTriggerId(): string {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function cloneEntry(entry: TriggerEntry): TriggerEntry {
    return {
        ...entry,
        rule: { ...entry.rule }
    };
}

function sameEntries(left: TriggerEntry[], right: TriggerEntry[]): boolean {
    return JSON.stringify(sortedEntries(left)) === JSON.stringify(sortedEntries(right));
}

function sortedEntries(entries: TriggerEntry[]): TriggerEntry[] {
    return [...entries].map(cloneEntry).sort((a, b) => a.id.localeCompare(b.id));
}

export const descriptor: TraitDescriptor<'trigger', TriggerTrait> = {
    ...TriggerCatalog,
    attach(args: TraitAttachContext<'trigger'>): TriggerTrait {
        const generation: TriggerGeneration = TRIGGERX_NAMESPACE in args.physical.ability
            ? 'x'
            : 'legacy';
        return new TriggerTrait({
            channel: args.channel,
            generation,
            namespaces: args.namespaces,
            request: args.request,
            emitChange: args.emitChange
        });
    }
};
