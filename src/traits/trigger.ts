import { MerossError } from '../errors';
import {
    CONTROL_TRIGGER_NAMESPACE,
    DIGEST_TRIGGERX_NAMESPACE,
    TRIGGERX_NAMESPACE,
    decodeControlTriggerPush,
    decodeDigestTriggerXGetAck,
    decodeTriggerXGetAck,
    decodeTriggerXPush,
    encodeControlTriggerSet,
    encodeTriggerXDelete,
    encodeTriggerXGet,
    encodeTriggerXSet,
    type MerossMessage,
    type TriggerXEntry,
    type TriggerXRule
} from '../protocol';
import type { RoutedRequestOptions } from '../transport/router';

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
 * Transport + channel bind for one TriggerX / Control.Trigger endpoint. Session
 * supplies this; trait tests inject a fake request/emit pair.
 */
export interface TriggerTraitBind {
    uuid: string;
    channel: number;
    /** Chosen at enrollment from Ability: TriggerX preferred over Control.Trigger. */
    generation: TriggerGeneration;
    /**
     * Ability keys advertised by the device. Digest.TriggerX listing no-ops when absent.
     */
    namespaces?: ReadonlySet<string>;
    request: (options: Omit<RoutedRequestOptions, 'uuid' | 'ip' | 'encryptionKey'>) => Promise<MerossMessage>;
    emitChange: (values: TriggerValues) => void;
}

/**
 * Per-channel countdowns via Appliance.Control.TriggerX (or legacy Trigger).
 * Digest.TriggerX is only an id index; poller GETACK triggers Control.TriggerX
 * GET-by-id in {@link handlePush} (ids are dynamic, not static jobs). Legacy
 * Control.Trigger has no Digest — GETACK/PUSH carry the full list.
 */
export class TriggerTrait {
    private readonly bind: TriggerTraitBind;
    private entries: TriggerEntry[] = [];

    constructor(bind: TriggerTraitBind) {
        this.bind = bind;
    }

    /** After digest resolve / set / PUSH. Empty until then. */
    list(): TriggerEntry[] {
        return this.entries.map(cloneEntry);
    }

    async set(input: TriggerSetInput): Promise<TriggerEntry> {
        const entry = normalizeSet(input, this.bind.channel);
        if (this.bind.generation === 'legacy') {
            const next = upsertLocal(this.entries, entry);
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
        const existing = this.entries.find((entry) => entry.id === id);
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
            const next = this.entries.filter((entry) => entry.id !== id);
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
        this.applyEntries(this.entries.filter((entry) => entry.id !== id));
    }

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
            void this.resolveFromDigest(message);
            return;
        }
        if (message.header.namespace !== TRIGGERX_NAMESPACE) {
            return;
        }
        const next = this.entries.map(cloneEntry);
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

    private async resolveFromDigest(message: MerossMessage): Promise<void> {
        try {
            const ids = decodeDigestTriggerXGetAck(message.payload)
                .filter((row) => row.channel === this.bind.channel)
                .map((row) => row.id);
            const groups = await Promise.all(ids.map(async (id) => {
                try {
                    const reply = await this.bind.request({
                        namespace: TRIGGERX_NAMESPACE,
                        method: 'GET',
                        payload: encodeTriggerXGet({ id })
                    });
                    return decodeTriggerXGetAck(reply.payload)
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

    private upsert(entry: TriggerEntry): void {
        this.applyEntries(upsertLocal(this.entries, entry));
    }

    private applyEntries(next: TriggerEntry[]): void {
        if (sameEntries(this.entries, next)) {
            return;
        }
        this.entries = next.map(cloneEntry);
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
