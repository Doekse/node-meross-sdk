import { ProtocolError } from '../../errors';
import type { MerossPayload } from '../message';

export const PRESENCE_CONFIG_NAMESPACE = 'Appliance.Control.Presence.Config';
export const PRESENCE_STUDY_NAMESPACE = 'Appliance.Control.Presence.Study';

/** Firmware mode block: workMode (0–2) and testMode (0–2). */
export interface PresenceMode {
    workMode: number;
    testMode: number;
}

/** Full config state for one channel. */
export interface PresenceConfig {
    channel: number;
    /** Nobody-timeout in seconds. */
    noBodyTime: number;
    /** Max detection distance in meters (firmware stores mm). */
    distance: number;
    /** Sensitivity level (0–2). */
    sensitivity: number;
    mode: PresenceMode;
}

export interface PresenceConfigSetOptions {
    channel: number;
    noBodyTime?: number;
    distance?: number;
    sensitivity?: number;
    mode?: Partial<PresenceMode>;
}

/** GET `{ config: [{ channel }] }` */
export function encodePresenceConfigGet(channel: number): MerossPayload {
    return { config: [{ channel }] };
}

/**
 * SET targets one channel; meross_lan writes one nested sub-key at a time.
 * `distance` is converted from meters to the wire unit (mm).
 */
export function encodePresenceConfigSet(options: PresenceConfigSetOptions): MerossPayload {
    const entry: Record<string, unknown> = { channel: options.channel };
    if (options.noBodyTime !== undefined) {
        entry.noBodyTime = { time: options.noBodyTime };
    }
    if (options.distance !== undefined) {
        entry.distance = { value: Math.round(options.distance * 1000) };
    }
    if (options.sensitivity !== undefined) {
        entry.sensitivity = { level: options.sensitivity };
    }
    if (options.mode !== undefined) {
        entry.mode = { ...options.mode };
    }
    return { config: [entry] };
}

/** GETACK / PUSH `{ config: [...] }` */
export function decodePresenceConfigGetAck(payload: MerossPayload): PresenceConfig[] {
    return decodePresenceConfigPayload(payload);
}

export function decodePresenceConfigPush(payload: MerossPayload): PresenceConfig[] {
    return decodePresenceConfigPayload(payload);
}

function decodePresenceConfigPayload(payload: MerossPayload): PresenceConfig[] {
    const raw = payload.config;
    if (!Array.isArray(raw)) {
        throw new ProtocolError('Presence.Config payload must contain a config array');
    }
    return raw.map(decodePresenceConfigEntry);
}

function decodePresenceConfigEntry(item: unknown): PresenceConfig {
    if (typeof item !== 'object' || item === null) {
        throw new ProtocolError('Presence.Config entry must be an object');
    }
    const { channel, noBodyTime, distance, sensitivity, mode } = item as Record<string, unknown>;
    if (typeof channel !== 'number') {
        throw new ProtocolError('Presence.Config channel is required');
    }
    if (typeof noBodyTime !== 'object' || noBodyTime === null) {
        throw new ProtocolError('Presence.Config noBodyTime is required');
    }
    if (typeof distance !== 'object' || distance === null) {
        throw new ProtocolError('Presence.Config distance is required');
    }
    if (typeof sensitivity !== 'object' || sensitivity === null) {
        throw new ProtocolError('Presence.Config sensitivity is required');
    }
    if (typeof mode !== 'object' || mode === null) {
        throw new ProtocolError('Presence.Config mode is required');
    }
    const { time } = noBodyTime as Record<string, unknown>;
    const { value: distanceValue } = distance as Record<string, unknown>;
    const { level } = sensitivity as Record<string, unknown>;
    const { workMode, testMode } = mode as Record<string, unknown>;
    if (typeof time !== 'number') {
        throw new ProtocolError('Presence.Config noBodyTime.time is required');
    }
    if (typeof distanceValue !== 'number') {
        throw new ProtocolError('Presence.Config distance.value is required');
    }
    if (typeof level !== 'number') {
        throw new ProtocolError('Presence.Config sensitivity.level is required');
    }
    if (typeof workMode !== 'number' || typeof testMode !== 'number') {
        throw new ProtocolError('Presence.Config mode workMode and testMode are required');
    }
    return {
        channel,
        noBodyTime: time,
        distance: distanceValue / 1000,
        sensitivity: level,
        mode: { workMode, testMode }
    };
}

/**
 * Study SET uses `study`, not `config`: live MS600 PUSH uses that key.
 * `status: 1` starts calibration.
 */
export function encodePresenceStudySet(channel: number): MerossPayload {
    return { study: [{ channel, status: 1 }] };
}
