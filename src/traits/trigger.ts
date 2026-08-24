import { MerossError } from '../errors';
import {
    DIGEST_TRIGGERX_NAMESPACE,
    TRIGGERX_NAMESPACE,
    decodeDigestTriggerXGetAck,
    decodeTriggerXGetAck,
    decodeTriggerXPush,
    encodeDigestTriggerXGet,
    encodeTriggerXDelete,
    encodeTriggerXGet,
    encodeTriggerXSet,
    type DigestTriggerXRow,
    type MerossMessage,
    type TriggerXEntry,
    type TriggerXRule
} from '../protocol';
import type { RoutedRequestOptions } from '../transport/router';

/**
 * Digest.TriggerX is board-wide. Share one in-flight GET across channels so a
 * strip does not query the same index once per outlet.
 */
const digestInflight = new Map<string, Promise<DigestTriggerXRow[]>>();

export type TriggerEntry = TriggerXEntry;
export type TriggerRule = TriggerXRule;

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
 * Transport + channel bind for one Control.TriggerX endpoint. Session supplies this;
 * trait tests inject a fake request/emit pair.
 */
export interface TriggerTraitBind {
    uuid: string;
    channel: number;
    /**
     * Ability keys advertised by the board. Digest.TriggerX listing no-ops when absent.
     */
    namespaces?: ReadonlySet<string>;
    request: (options: Omit<RoutedRequestOptions, 'uuid' | 'ip' | 'encryptionKey'>) => Promise<MerossMessage>;
    emitChange: (values: TriggerValues) => void;
}

/**
 * Per-channel countdowns via Appliance.Control.TriggerX.
 * Digest.TriggerX is only an id index for the initial GET-by-id poll.
 */
export class TriggerTrait {
    private readonly bind: TriggerTraitBind;
    private entries: TriggerEntry[] = [];

    constructor(bind: TriggerTraitBind) {
        this.bind = bind;
    }

    /** Fetches initial countdowns. Idempotent; Session calls this once and does not await it. */
    start(): void {
        void this.pollInitial();
    }

    /** Last known countdowns for this channel (after start / set / PUSH). */
    list(): TriggerEntry[] {
        return this.entries.map(cloneEntry);
    }

    /**
     * Creates or updates a countdown.
     */
    async set(input: TriggerSetInput): Promise<TriggerEntry> {
        const entry = normalizeSet(input, this.bind.channel);
        await this.bind.request({
            namespace: TRIGGERX_NAMESPACE,
            method: 'SET',
            payload: encodeTriggerXSet(entry)
        });
        this.upsert(entry);
        return cloneEntry(entry);
    }

    /**
     * Enables or disables an existing countdown by id.
     */
    async setEnabled(id: string, enabled: boolean): Promise<TriggerEntry> {
        const existing = this.entries.find((entry) => entry.id === id);
        if (!existing) {
            throw new MerossError(`Unknown trigger id: ${id}`, 'TRIGGER_NOT_FOUND');
        }
        return this.set({ ...existing, enabled });
    }

    /**
     * Deletes a countdown. Firmware does not PUSH after DELETE, so the local list updates here.
     */
    async remove(id: string): Promise<void> {
        await this.bind.request({
            namespace: TRIGGERX_NAMESPACE,
            method: 'DELETE',
            payload: encodeTriggerXDelete({ id })
        });
        this.applyEntries(this.entries.filter((entry) => entry.id !== id));
    }

    /**
     * Applies a firmware PUSH for this endpoint (modified rows only after SET).
     */
    handlePush(message: MerossMessage): void {
        const uuid = message.header.uuid
            ?? /^\/appliance\/([^/]+)\//.exec(message.header.from)?.[1];
        if (!uuid || uuid !== this.bind.uuid) {
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

    private has(namespace: string): boolean {
        return this.bind.namespaces?.has(namespace) ?? false;
    }

    private upsert(entry: TriggerEntry): void {
        const next = this.entries.map(cloneEntry);
        const index = next.findIndex((item) => item.id === entry.id);
        if (index >= 0) {
            next[index] = cloneEntry(entry);
        } else {
            next.push(cloneEntry(entry));
        }
        this.applyEntries(next);
    }

    private applyEntries(next: TriggerEntry[]): void {
        if (sameEntries(this.entries, next)) {
            return;
        }
        this.entries = next.map(cloneEntry);
        this.bind.emitChange({ entries: this.list() });
    }

    private async pollInitial(): Promise<void> {
        if (!this.has(DIGEST_TRIGGERX_NAMESPACE)) {
            return;
        }
        try {
            const ids = (await loadDigest(this.bind.uuid, this.bind.request))
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
}

function loadDigest(
    uuid: string,
    request: TriggerTraitBind['request']
): Promise<DigestTriggerXRow[]> {
    const existing = digestInflight.get(uuid);
    if (existing) {
        return existing;
    }
    const pending = request({
        namespace: DIGEST_TRIGGERX_NAMESPACE,
        method: 'GET',
        payload: encodeDigestTriggerXGet()
    })
        .then((reply) => decodeDigestTriggerXGetAck(reply.payload))
        .finally(() => {
            digestInflight.delete(uuid);
        });
    digestInflight.set(uuid, pending);
    return pending;
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
