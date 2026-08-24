import { ProtocolError } from '../../errors';
import type { MerossPayload } from '../message';

export const TRIGGERX_NAMESPACE = 'Appliance.Control.TriggerX';
export const DIGEST_TRIGGERX_NAMESPACE = 'Appliance.Digest.TriggerX';

/**
 * Countdown rule from firmware TriggerX. `duration` is seconds; `week` is the
 * bitmask. Kept as a nested object so hosts do not invent a condition DSL.
 */
export interface TriggerXRule {
    duration: number;
    week: number;
}

/**
 * Host-facing TriggerX row. Unlike TimerX there is no extend/toggle action —
 * the countdown itself is the schedule.
 */
export interface TriggerXEntry {
    id: string;
    channel: number;
    alias: string;
    enabled: boolean;
    type: number;
    createTime: number;
    rule: TriggerXRule;
}

export interface TriggerXGetOptions {
    id: string;
}

export interface TriggerXDeleteOptions {
    id: string;
}

export type TriggerXSetOptions = TriggerXEntry;

export interface DigestTriggerXRow {
    id: string;
    channel: number;
    count?: number;
}

/** Firmware GET is by id. Listing uses Digest.TriggerX, then GET each id. */
export function encodeTriggerXGet(options: TriggerXGetOptions): MerossPayload {
    return { triggerx: { id: options.id } };
}

/** SET is a single object (not an array). */
export function encodeTriggerXSet(entry: TriggerXSetOptions): MerossPayload {
    const triggerx: Record<string, unknown> = {
        id: entry.id,
        channel: entry.channel,
        type: entry.type,
        enable: entry.enabled ? 1 : 0,
        alias: entry.alias,
        createTime: entry.createTime,
        rule: {
            duration: entry.rule.duration,
            week: entry.rule.week
        }
    };
    return { triggerx };
}

/** DELETE by id. Firmware does not PUSH after DELETE. */
export function encodeTriggerXDelete(options: TriggerXDeleteOptions): MerossPayload {
    return { triggerx: { id: options.id } };
}

/** Digest.TriggerX GET payload is empty. */
export function encodeDigestTriggerXGet(): MerossPayload {
    return {};
}

export function decodeTriggerXGetAck(payload: MerossPayload): TriggerXEntry[] {
    return decodeTriggerX(payload);
}

export function decodeTriggerXPush(payload: MerossPayload): TriggerXEntry[] {
    return decodeTriggerX(payload);
}

export function decodeDigestTriggerXGetAck(payload: MerossPayload): DigestTriggerXRow[] {
    const raw = payload.digest;
    if (!Array.isArray(raw)) {
        throw new ProtocolError('Digest.TriggerX payload must contain a digest array');
    }
    return raw.map(decodeDigestRow);
}

/**
 * GETACK may be a single object; PUSH after SET is an array of modified rows.
 * Firmware GETACK samples also use an array — both shapes are accepted.
 */
function decodeTriggerX(payload: MerossPayload): TriggerXEntry[] {
    const raw = payload.triggerx;
    if (Array.isArray(raw)) {
        return raw.map(decodeEntry);
    }
    if (typeof raw === 'object' && raw !== null) {
        return [decodeEntry(raw)];
    }
    throw new ProtocolError('Control.TriggerX payload must contain a triggerx object or array');
}

function decodeEntry(item: unknown): TriggerXEntry {
    if (typeof item !== 'object' || item === null) {
        throw new ProtocolError('Control.TriggerX entry must be an object');
    }
    const record = item as Record<string, unknown>;
    if (typeof record.id !== 'string' || typeof record.channel !== 'number') {
        throw new ProtocolError('Control.TriggerX entry requires id and channel');
    }
    return {
        id: record.id,
        channel: record.channel,
        alias: typeof record.alias === 'string' ? record.alias : '',
        enabled: record.enable === 1,
        type: typeof record.type === 'number' ? record.type : 1,
        createTime: typeof record.createTime === 'number' ? record.createTime : 0,
        rule: decodeRule(record.rule)
    };
}

function decodeRule(rule: unknown): TriggerXRule {
    if (typeof rule !== 'object' || rule === null) {
        return { duration: 0, week: 0 };
    }
    const record = rule as Record<string, unknown>;
    return {
        duration: typeof record.duration === 'number' ? record.duration : 0,
        week: typeof record.week === 'number' ? record.week : 0
    };
}

function decodeDigestRow(item: unknown): DigestTriggerXRow {
    if (typeof item !== 'object' || item === null) {
        throw new ProtocolError('Digest.TriggerX row must be an object');
    }
    const record = item as Record<string, unknown>;
    if (typeof record.id !== 'string' || typeof record.channel !== 'number') {
        throw new ProtocolError('Digest.TriggerX row requires id and channel');
    }
    const row: DigestTriggerXRow = { id: record.id, channel: record.channel };
    if (typeof record.count === 'number') {
        row.count = record.count;
    }
    return row;
}
