import { ProtocolError } from '../../errors';
import type { MerossPayload } from '../message';

export const FAN_NAMESPACE = 'Appliance.Control.Fan';

export interface FanChannelState {
    channel: number;
    speed: number;
    maxSpeed?: number;
}

export interface FanGetOptions {
    channel: number;
}

export interface FanSetOptions {
    channel: number;
    speed: number;
}

/** GET `{ fan: [{ channel }] }`. */
export function encodeFanGet(options: FanGetOptions): MerossPayload {
    return { fan: [{ channel: options.channel }] };
}

/** SET is a one-entry list. */
export function encodeFanSet(options: FanSetOptions): MerossPayload {
    return { fan: [{ channel: options.channel, speed: options.speed }] };
}

/**
 * GETACK and PUSH may be a single object or an array.
 */
export function decodeFanGetAck(payload: MerossPayload): FanChannelState[] {
    return decodeFan(payload);
}

export function decodeFanPush(payload: MerossPayload): FanChannelState[] {
    return decodeFan(payload);
}

function decodeFan(payload: MerossPayload): FanChannelState[] {
    const raw = payload.fan;
    if (Array.isArray(raw)) {
        return raw.map(decodeFanEntry);
    }
    if (typeof raw === 'object' && raw !== null) {
        return [decodeFanEntry(raw)];
    }
    throw new ProtocolError('Control.Fan payload must contain a fan object or array');
}

function decodeFanEntry(item: unknown): FanChannelState {
    if (typeof item !== 'object' || item === null) {
        throw new ProtocolError('Control.Fan entry must be an object');
    }
    const { channel, speed, maxSpeed } = item as Record<string, unknown>;
    if (typeof channel !== 'number' || typeof speed !== 'number') {
        throw new ProtocolError('Control.Fan channel and speed are required');
    }
    const state: FanChannelState = { channel, speed };
    if (typeof maxSpeed === 'number') {
        state.maxSpeed = maxSpeed;
    }
    return state;
}
