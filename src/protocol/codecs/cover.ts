import { ProtocolError } from '../../errors';
import type { MerossPayload } from '../message';

export const GARAGE_STATE_NAMESPACE = 'Appliance.GarageDoor.State';
export const SHUTTER_POSITION_NAMESPACE = 'Appliance.RollerShutter.Position';
export const SHUTTER_STATE_NAMESPACE = 'Appliance.RollerShutter.State';

export interface GarageChannelState {
    channel: number;
    open: boolean;
}

export interface GarageSetOptions {
    channel: number;
    open: boolean;
}

export interface GarageGetOptions {
    channel: number;
}

export interface ShutterPositionState {
    channel: number;
    /** Wire position 0–100, or -1 when stop was issued. */
    position: number;
}

export interface ShutterMoveState {
    channel: number;
    /** 0 = stopped, 1 = opening, 2 = closing. */
    state: number;
}

export interface ShutterPositionSetOptions {
    channel: number;
    position: number;
}

/** SET is a single-channel object. */
export function encodeGarageSet(options: GarageSetOptions): MerossPayload {
    return { state: { channel: options.channel, open: options.open ? 1 : 0 } };
}

/** GET `{ state: { channel } }`; `0xffff` returns every channel as an array. */
export function encodeGarageGet(options: GarageGetOptions): MerossPayload {
    return { state: { channel: options.channel } };
}

/**
 * GETACK and PUSH may be a single object or an array.
 */
export function decodeGarageGetAck(payload: MerossPayload): GarageChannelState[] {
    return decodeGarage(payload);
}

export function decodeGaragePush(payload: MerossPayload): GarageChannelState[] {
    return decodeGarage(payload);
}

function decodeGarage(payload: MerossPayload): GarageChannelState[] {
    const raw = payload.state;
    if (Array.isArray(raw)) {
        return raw.map(decodeGarageEntry);
    }
    if (typeof raw === 'object' && raw !== null) {
        return [decodeGarageEntry(raw)];
    }
    throw new ProtocolError('GarageDoor.State payload must contain a state object or array');
}

function decodeGarageEntry(item: unknown): GarageChannelState {
    if (typeof item !== 'object' || item === null) {
        throw new ProtocolError('GarageDoor.State entry must be an object');
    }
    const { channel, open } = item as Record<string, unknown>;
    if (typeof channel !== 'number') {
        throw new ProtocolError('GarageDoor.State channel is required');
    }
    return { channel, open: open === 1 };
}

/** SET is a single-channel object. Wire 0 = closed, 100 = open, -1 = stop. */
export function encodeShutterPositionSet(options: ShutterPositionSetOptions): MerossPayload {
    return { position: { channel: options.channel, position: options.position } };
}

/** Firmware GET for RollerShutter.Position uses an empty payload. */
export function encodeShutterPositionGet(): MerossPayload {
    return {};
}

export function decodeShutterPositionGetAck(payload: MerossPayload): ShutterPositionState[] {
    return decodeShutterPosition(payload);
}

export function decodeShutterPositionPush(payload: MerossPayload): ShutterPositionState[] {
    return decodeShutterPosition(payload);
}

function decodeShutterPosition(payload: MerossPayload): ShutterPositionState[] {
    const raw = payload.position;
    if (!Array.isArray(raw)) {
        throw new ProtocolError('RollerShutter.Position payload must contain an array');
    }
    return raw.map((item) => {
        if (typeof item !== 'object' || item === null) {
            throw new ProtocolError('RollerShutter.Position entry must be an object');
        }
        const { channel, position } = item as Record<string, unknown>;
        if (typeof channel !== 'number' || typeof position !== 'number') {
            throw new ProtocolError('RollerShutter.Position channel and position are required');
        }
        return { channel, position };
    });
}

export function decodeShutterStatePush(payload: MerossPayload): ShutterMoveState[] {
    const raw = payload.state;
    if (!Array.isArray(raw)) {
        throw new ProtocolError('RollerShutter.State payload must contain an array');
    }
    return raw.map((item) => {
        if (typeof item !== 'object' || item === null) {
            throw new ProtocolError('RollerShutter.State entry must be an object');
        }
        const { channel, state } = item as Record<string, unknown>;
        if (typeof channel !== 'number' || typeof state !== 'number') {
            throw new ProtocolError('RollerShutter.State channel and state are required');
        }
        return { channel, state };
    });
}
