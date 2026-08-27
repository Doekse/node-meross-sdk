import { ProtocolError } from '../../errors';
import type { MerossPayload } from '../message';

/** MSS305 standby cut-off (GET/SET/PUSH-query list). */
export const CONFIG_STANDBY_KILLER_NAMESPACE = 'Appliance.Config.StandbyKiller';

export interface StandbyKillerEntry {
    channel: number;
    /** Cut-off threshold in watts (firmware stores milliwatts). */
    power?: number;
    /** Seconds below threshold before cut-off. */
    time?: number;
    enabled?: boolean;
    alert?: boolean;
}

export interface StandbyKillerSetOptions {
    channel: number;
    power?: number;
    time?: number;
    enabled?: boolean;
    alert?: boolean;
}

/** GET `{ config: [{ channel }] }`. */
export function encodeStandbyKillerGet(channel: number): MerossPayload {
    return { config: [{ channel }] };
}

/**
 * SET `{ config: [{ channel, power?, time?, enable?, alert? }] }`.
 * `power` is converted from watts to the wire unit (milliwatts).
 */
export function encodeStandbyKillerSet(options: StandbyKillerSetOptions): MerossPayload {
    const entry: Record<string, unknown> = { channel: options.channel };
    if (options.power !== undefined) {
        entry.power = Math.round(options.power * 1000);
    }
    if (options.time !== undefined) {
        entry.time = options.time;
    }
    if (options.enabled !== undefined) {
        entry.enable = options.enabled ? 1 : 2;
    }
    if (options.alert !== undefined) {
        entry.alert = options.alert ? 1 : 2;
    }
    return { config: [entry] };
}

export function decodeStandbyKillerGetAck(payload: MerossPayload): StandbyKillerEntry[] {
    return decodeStandbyKiller(payload);
}

export function decodeStandbyKillerPush(payload: MerossPayload): StandbyKillerEntry[] {
    return decodeStandbyKiller(payload);
}

function decodeStandbyKiller(payload: MerossPayload): StandbyKillerEntry[] {
    const raw = payload.config;
    // MSS305 has been seen to GETACK an empty list before the channel query.
    if (raw === undefined) {
        return [];
    }
    if (!Array.isArray(raw)) {
        throw new ProtocolError('Config.StandbyKiller payload must contain a config array');
    }
    return raw.map((item) => {
        if (typeof item !== 'object' || item === null) {
            throw new ProtocolError('Config.StandbyKiller entry must be an object');
        }
        const { channel, power, time, enable, alert } = item as Record<string, unknown>;
        const entry: StandbyKillerEntry = {
            channel: typeof channel === 'number' ? channel : 0
        };
        if (typeof power === 'number') {
            entry.power = power / 1000;
        }
        if (typeof time === 'number') {
            entry.time = time;
        }
        if (enable !== undefined) {
            if (typeof enable !== 'number' || (enable !== 1 && enable !== 2)) {
                throw new ProtocolError('Config.StandbyKiller enable must be 1 or 2');
            }
            entry.enabled = enable === 1;
        }
        if (alert !== undefined) {
            if (typeof alert !== 'number' || (alert !== 1 && alert !== 2)) {
                throw new ProtocolError('Config.StandbyKiller alert must be 1 or 2');
            }
            entry.alert = alert === 1;
        }
        return entry;
    });
}
