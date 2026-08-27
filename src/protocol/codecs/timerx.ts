import { ProtocolError } from '../../errors';
import type { MerossPayload } from '../message';

export const TIMERX_NAMESPACE = 'Appliance.Control.TimerX';
export const DIGEST_TIMERX_NAMESPACE = 'Appliance.Digest.TimerX';
/** Pre-X firmware; no Digest. Listing is a GET of the full `timer` list. */
export const CONTROL_TIMER_NAMESPACE = 'Appliance.Control.Timer';

/**
 * Host-facing TimerX row. `time` is minutes from midnight; `week` is the
 * firmware bitmask. Only ToggleX-shaped `extend.toggle` is decoded/encoded.
 * Legacy Control.Timer uses the same host shape (channel 0, sunOffset 0).
 */
export interface TimerXEntry {
    id: string;
    channel: number;
    alias: string;
    enabled: boolean;
    type: number;
    time: number;
    week: number;
    duration: number;
    sunOffset: number;
    createTime: number;
    /** Toggle action when the timer fires. Undefined when extend has no toggle. */
    on?: boolean;
}

export interface TimerXGetOptions {
    id: string;
}

export interface TimerXDeleteOptions {
    id: string;
}

export type TimerXSetOptions = TimerXEntry;

export interface DigestTimerXRow {
    id: string;
    channel: number;
    count?: number;
}

/** Firmware GET is by id. Listing uses Digest.TimerX, then GET each id. */
export function encodeTimerXGet(options: TimerXGetOptions): MerossPayload {
    return { timerx: { id: options.id } };
}

/** SET is a single object (not an array). */
export function encodeTimerXSet(entry: TimerXSetOptions): MerossPayload {
    return {
        timerx: {
            id: entry.id,
            channel: entry.channel,
            type: entry.type,
            time: entry.time,
            week: entry.week,
            duration: entry.duration,
            sunOffset: entry.sunOffset,
            enable: entry.enabled ? 1 : 0,
            alias: entry.alias,
            createTime: entry.createTime,
            extend: encodeToggleExtend(entry.on)
        }
    };
}

/** DELETE by id. Firmware does not PUSH after DELETE. */
export function encodeTimerXDelete(options: TimerXDeleteOptions): MerossPayload {
    return { timerx: { id: options.id } };
}

/** Digest.TimerX GET payload is empty. */
export function encodeDigestTimerXGet(): MerossPayload {
    return {};
}

export function decodeTimerXGetAck(payload: MerossPayload): TimerXEntry[] {
    return decodeTimerX(payload);
}

export function decodeTimerXPush(payload: MerossPayload): TimerXEntry[] {
    return decodeTimerX(payload);
}

export function decodeDigestTimerXGetAck(payload: MerossPayload): DigestTimerXRow[] {
    const raw = payload.digest;
    if (!Array.isArray(raw)) {
        throw new ProtocolError('Digest.TimerX payload must contain a digest array');
    }
    return raw.map(decodeDigestRow);
}

/**
 * GETACK may be a single object; PUSH after SET is an array of modified rows.
 */
function decodeTimerX(payload: MerossPayload): TimerXEntry[] {
    const raw = payload.timerx;
    if (Array.isArray(raw)) {
        return raw.map((item) => decodeEntry(item, true));
    }
    if (typeof raw === 'object' && raw !== null) {
        return [decodeEntry(raw, true)];
    }
    throw new ProtocolError('Control.TimerX payload must contain a timerx object or array');
}

function decodeDigestRow(item: unknown): DigestTimerXRow {
    if (typeof item !== 'object' || item === null) {
        throw new ProtocolError('Digest.TimerX row must be an object');
    }
    const record = item as Record<string, unknown>;
    if (typeof record.id !== 'string' || typeof record.channel !== 'number') {
        throw new ProtocolError('Digest.TimerX row requires id and channel');
    }
    const row: DigestTimerXRow = { id: record.id, channel: record.channel };
    if (typeof record.count === 'number') {
        row.count = record.count;
    }
    return row;
}

/** GET `{ timer: [] }` returns every schedule on the board. */
export function encodeControlTimerGet(): MerossPayload {
    return { timer: [] };
}

/**
 * SET replaces the board's full timer list (no DELETE on this namespace).
 * Channel / sunOffset are omitted — pre-X boards are single-outlet.
 */
export function encodeControlTimerSet(entries: TimerXEntry[]): MerossPayload {
    return {
        timer: entries.map((entry) => ({
            id: entry.id,
            type: entry.type,
            time: entry.time,
            week: entry.week,
            duration: entry.duration,
            enable: entry.enabled ? 1 : 0,
            alias: entry.alias,
            createTime: entry.createTime,
            extend: encodeToggleExtend(entry.on)
        }))
    };
}

export function decodeControlTimerGetAck(payload: MerossPayload): TimerXEntry[] {
    return decodeControlTimer(payload);
}

export function decodeControlTimerPush(payload: MerossPayload): TimerXEntry[] {
    return decodeControlTimer(payload);
}

function decodeControlTimer(payload: MerossPayload): TimerXEntry[] {
    const raw = payload.timer;
    if (!Array.isArray(raw)) {
        throw new ProtocolError('Control.Timer payload must contain a timer array');
    }
    return raw.map((item) => decodeEntry(item, false));
}

function decodeEntry(item: unknown, requireChannel: boolean): TimerXEntry {
    const label = requireChannel ? 'Control.TimerX' : 'Control.Timer';
    if (typeof item !== 'object' || item === null) {
        throw new ProtocolError(`${label} entry must be an object`);
    }
    const record = item as Record<string, unknown>;
    if (typeof record.id !== 'string') {
        throw new ProtocolError(`${label} entry requires id`);
    }
    if (requireChannel && typeof record.channel !== 'number') {
        throw new ProtocolError('Control.TimerX entry requires id and channel');
    }
    const entry: TimerXEntry = {
        id: record.id,
        channel: typeof record.channel === 'number' ? record.channel : 0,
        alias: typeof record.alias === 'string' ? record.alias : '',
        enabled: record.enable === 1,
        type: typeof record.type === 'number' ? record.type : 1,
        time: typeof record.time === 'number' ? record.time : 0,
        week: typeof record.week === 'number' ? record.week : 0,
        duration: typeof record.duration === 'number' ? record.duration : 0,
        sunOffset: typeof record.sunOffset === 'number' ? record.sunOffset : 0,
        createTime: typeof record.createTime === 'number' ? record.createTime : 0
    };
    const on = decodeToggleOn(record.extend);
    if (on !== undefined) {
        entry.on = on;
    }
    return entry;
}

function encodeToggleExtend(on: boolean | undefined): Record<string, unknown> {
    return {
        toggle: {
            onoff: on === false ? 0 : 1,
            lmTime: 0
        }
    };
}

/**
 * v1 plugs use ToggleX-shaped extend only; hp110a / mrs100 / notify variants stay opaque.
 */
function decodeToggleOn(extend: unknown): boolean | undefined {
    if (typeof extend !== 'object' || extend === null) {
        return undefined;
    }
    const toggle = (extend as Record<string, unknown>).toggle;
    if (typeof toggle !== 'object' || toggle === null) {
        return undefined;
    }
    const onoff = (toggle as Record<string, unknown>).onoff;
    if (typeof onoff !== 'number') {
        return undefined;
    }
    return onoff === 1;
}
