import { ProtocolError } from '../../errors';
import type { MerossPayload } from '../message';

export const CONTROL_ALARM_NAMESPACE = 'Appliance.Control.Alarm';

/** Wire `value`: 1 = execute (siren on), 2 = normal (off). */
const EXECUTE = 1;
const NORMAL = 2;

/** interConn.type: current device only (firmware table value 1). */
const INTERCONN_LOCAL = 1;

export interface AlarmGetOptions {
    channel: number;
    subId?: string;
}

export interface AlarmSetOptions {
    channel: number;
    subId?: string;
    on: boolean;
    /** Optional siren duration in seconds (`event.security.time` / `event.maSecurity.time`). */
    durationSeconds?: number;
    /**
     * MA151 hub-wide siren. SET uses `event.maSecurity` and omits subId;
     * other hubs use `event.security`.
     */
    maSecurity?: boolean;
}

export interface AlarmLinkedSetOptions {
    channel: number;
    subId?: string;
    on: boolean;
}

export interface AlarmChannelState {
    channel: number;
    subId?: string;
    /** True when `event.security` or `event.maSecurity` is execute. Undefined if both are absent. */
    on?: boolean;
    /** True when `on` came from `event.maSecurity` (MA151 hub-wide, no subId). */
    maSecurity?: boolean;
    /** True when `event.interConn.value` is execute. Undefined if interConn is absent. */
    linked?: boolean;
}

function encodeArray(key: string, entry: Record<string, unknown>): MerossPayload {
    return { [key]: [entry] };
}

function alarmRow(options: { channel: number; subId?: string }): Record<string, unknown> {
    const entry: Record<string, unknown> = { channel: options.channel };
    if (options.subId !== undefined) {
        entry.subId = options.subId;
    }
    return entry;
}

/** GET `{ alarm: [{ channel }] }` (optional subId for hub children). */
export function encodeAlarmGet(options: AlarmGetOptions): MerossPayload {
    return encodeArray('alarm', alarmRow(options));
}

/** SET security siren on/off (`event.security`, or `event.maSecurity` for MA151). */
export function encodeAlarmSet(options: AlarmSetOptions): MerossPayload {
    const action: Record<string, unknown> = {
        value: options.on ? EXECUTE : NORMAL
    };
    if (options.durationSeconds !== undefined) {
        action.time = options.durationSeconds;
    }
    return encodeArray('alarm', {
        ...(options.maSecurity ? { channel: options.channel } : alarmRow(options)),
        event: options.maSecurity ? { maSecurity: action } : { security: action }
    });
}

/** SET linkage alarm on/off (`event.interConn`, local scope). */
export function encodeAlarmLinkedSet(options: AlarmLinkedSetOptions): MerossPayload {
    return encodeArray('alarm', {
        ...alarmRow(options),
        event: {
            interConn: {
                value: options.on ? EXECUTE : NORMAL,
                type: INTERCONN_LOCAL
            }
        }
    });
}

export function decodeAlarmGetAck(payload: MerossPayload): AlarmChannelState[] {
    return decodeControlAlarm(payload);
}

export function decodeAlarmPush(payload: MerossPayload): AlarmChannelState[] {
    return decodeControlAlarm(payload);
}

/**
 * GETACK and PUSH may be a single object or an array.
 */
function decodeControlAlarm(payload: MerossPayload): AlarmChannelState[] {
    const raw = payload.alarm;
    if (Array.isArray(raw)) {
        return raw.map(decodeAlarmEntry);
    }
    if (typeof raw === 'object' && raw !== null) {
        return [decodeAlarmEntry(raw)];
    }
    throw new ProtocolError('Control.Alarm payload must contain an alarm object or array');
}

function decodeAlarmEntry(item: unknown): AlarmChannelState {
    if (typeof item !== 'object' || item === null) {
        throw new ProtocolError('Control.Alarm entry must be an object');
    }
    const record = item as Record<string, unknown>;
    if (typeof record.channel !== 'number') {
        throw new ProtocolError('Control.Alarm entry requires channel');
    }
    const state: AlarmChannelState = { channel: record.channel };
    if (typeof record.subId === 'string') {
        state.subId = record.subId;
    }
    const event = record.event;
    if (typeof event === 'object' && event !== null) {
        const fields = event as Record<string, unknown>;
        const security = decodeActionValue(fields.security);
        if (security !== undefined) {
            state.on = security;
        } else {
            const maSecurity = decodeActionValue(fields.maSecurity);
            if (maSecurity !== undefined) {
                state.on = maSecurity;
                state.maSecurity = true;
            }
        }
        const linked = decodeActionValue(fields.interConn);
        if (linked !== undefined) {
            state.linked = linked;
        }
    }
    return state;
}

function decodeActionValue(field: unknown): boolean | undefined {
    if (typeof field !== 'object' || field === null) {
        return undefined;
    }
    const value = (field as Record<string, unknown>).value;
    if (typeof value !== 'number' || (value !== EXECUTE && value !== NORMAL)) {
        return undefined;
    }
    return value === EXECUTE;
}
