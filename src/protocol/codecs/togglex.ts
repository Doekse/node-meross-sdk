import { ProtocolError } from '../../errors';
import type { MerossPayload } from '../message';

export const TOGGLEX_NAMESPACE = 'Appliance.Control.ToggleX';

/**
 * GET channel `0xffff` means every channel. Firmware wants decimal 65535,
 * not `0xffffffff`.
 */
export const TOGGLEX_ALL_CHANNELS = 0xffff;

export interface ToggleXChannel {
    channel: number;
    on: boolean;
    entity?: number;
    lmTime?: number;
}

export interface ToggleXGetOptions {
    channel?: number;
    entity?: number;
}

export interface ToggleXSetOptions {
    channel: number;
    on: boolean;
    entity?: number;
    /**
     * Firmware `touch: 1`: bump `lmTime` without actually switching.
     */
    touch?: boolean;
}

/**
 * SET is a single-channel object and must not carry `lmTime`.
 */
export function encodeToggleXSet(options: ToggleXSetOptions): MerossPayload {
    const togglex: Record<string, number> = {
        onoff: options.on ? 1 : 0,
        channel: options.channel
    };
    if (options.entity !== undefined) {
        togglex.entity = options.entity;
    }
    if (options.touch) {
        togglex.touch = 1;
    }
    return { togglex };
}

/**
 * GET is an object. Omit `channel` to query every channel via `0xffff`.
 */
export function encodeToggleXGet(options: ToggleXGetOptions = {}): MerossPayload {
    const togglex: Record<string, number> = {
        channel: options.channel ?? TOGGLEX_ALL_CHANNELS
    };
    if (options.entity !== undefined) {
        togglex.entity = options.entity;
    }
    return { togglex };
}

/**
 * Single-channel GETACK is an object; `0xffff` GETACK is an array.
 * Older firmware also PUSHed an object; current firmware PUSHes an array.
 */
export function decodeToggleXGetAck(payload: MerossPayload): ToggleXChannel[] {
    return decodeToggleX(payload);
}

export function decodeToggleXPush(payload: MerossPayload): ToggleXChannel[] {
    return decodeToggleX(payload);
}

function decodeToggleX(payload: MerossPayload): ToggleXChannel[] {
    const raw = payload.togglex;
    if (Array.isArray(raw)) {
        return raw.map(decodeChannel);
    }
    if (raw && typeof raw === 'object') {
        return [decodeChannel(raw)];
    }
    throw new ProtocolError('ToggleX togglex must be an object or array');
}

function decodeChannel(raw: unknown): ToggleXChannel {
    if (typeof raw !== 'object' || raw === null) {
        throw new ProtocolError('ToggleX channel entry must be an object');
    }
    const { channel, onoff, entity, lmTime } = raw as Record<string, unknown>;
    if (typeof channel !== 'number' || typeof onoff !== 'number') {
        throw new ProtocolError('ToggleX channel and onoff are required');
    }
    const state: ToggleXChannel = { channel, on: onoff === 1 };
    if (typeof entity === 'number') {
        state.entity = entity;
    }
    if (typeof lmTime === 'number') {
        state.lmTime = lmTime;
    }
    return state;
}
