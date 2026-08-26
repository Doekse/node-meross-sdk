import { ProtocolError } from '../../errors';
import type { MerossPayload } from '../message';

/** Live over-temperature signal (GET list / device SET). */
export const CONTROL_OVERTEMP_NAMESPACE = 'Appliance.Control.OverTemp';
/** Protection enable / type config (GET/SET dict). */
export const CONFIG_OVERTEMP_NAMESPACE = 'Appliance.Config.OverTemp';

export interface ConfigOverTempState {
    enabled: boolean;
    type?: number;
}

/**
 * Appliance.Control.OverTemp per-channel status. Device SET omits `channel`;
 * those payloads are channel 0.
 */
export interface ControlOverTempState {
    channel: number;
    active: boolean;
    timestamp?: number;
    type?: number;
}

/** Config GET uses an empty payload. */
export function encodeConfigOverTempGet(): MerossPayload {
    return {};
}

/** Config SET `{ overTemp: { enable, type? } }` with enable 1/2. */
export function encodeConfigOverTempSet(options: {
    enabled: boolean;
    type?: number;
}): MerossPayload {
    const overTemp: Record<string, unknown> = {
        enable: options.enabled ? 1 : 2
    };
    if (options.type !== undefined) {
        overTemp.type = options.type;
    }
    return { overTemp };
}

export function decodeConfigOverTempGetAck(payload: MerossPayload): ConfigOverTempState {
    return decodeConfigOverTemp(payload);
}

export function decodeConfigOverTempPush(payload: MerossPayload): ConfigOverTempState {
    return decodeConfigOverTemp(payload);
}

/** Control GET `{ overTemp: [{ channel }] }`. */
export function encodeControlOverTempGet(channel: number): MerossPayload {
    return { overTemp: [{ channel }] };
}

export function decodeControlOverTempGetAck(payload: MerossPayload): ControlOverTempState[] {
    return decodeControlOverTemp(payload);
}

export function decodeControlOverTempPush(payload: MerossPayload): ControlOverTempState[] {
    return decodeControlOverTemp(payload);
}

function decodeConfigOverTemp(payload: MerossPayload): ConfigOverTempState {
    const raw = payload.overTemp;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new ProtocolError('Config.OverTemp payload must contain an overTemp object');
    }
    const { enable, type } = raw as Record<string, unknown>;
    if (typeof enable !== 'number' || (enable !== 1 && enable !== 2)) {
        throw new ProtocolError('Config.OverTemp enable must be 1 or 2');
    }
    const state: ConfigOverTempState = { enabled: enable === 1 };
    if (typeof type === 'number') {
        state.type = type;
    }
    return state;
}

function decodeControlOverTemp(payload: MerossPayload): ControlOverTempState[] {
    const raw = payload.overTemp;
    if (Array.isArray(raw)) {
        return raw.map(decodeControlEntry);
    }
    if (typeof raw === 'object' && raw !== null) {
        return [decodeControlEntry(raw)];
    }
    throw new ProtocolError('Control.OverTemp payload must contain an overTemp object or array');
}

function decodeControlEntry(item: unknown): ControlOverTempState {
    if (typeof item !== 'object' || item === null) {
        throw new ProtocolError('Control.OverTemp entry must be an object');
    }
    const { channel, value, timestamp, type } = item as Record<string, unknown>;
    if (typeof value !== 'number' || (value !== 1 && value !== 2)) {
        throw new ProtocolError('Control.OverTemp value must be 1 or 2');
    }
    const state: ControlOverTempState = {
        channel: typeof channel === 'number' ? channel : 0,
        active: value === 1
    };
    if (typeof timestamp === 'number') {
        state.timestamp = timestamp;
    }
    if (typeof type === 'number') {
        state.type = type;
    }
    return state;
}
