import { ProtocolError } from '../../errors';
import type { MerossPayload } from '../message';

/**
 * Light bulb / lamp control for one channel.
 *
 * Notes:
 * - `capacity` is a firmware bitmask:
 *   - 0x1 RGB
 *   - 0x2 temperature
 *   - 0x4 luminance (brightness)
 *   - 0x8 effect
 */
export const LIGHT_NAMESPACE = 'Appliance.Control.Light';
export const LIGHT_EFFECT_NAMESPACE = 'Appliance.Control.Light.Effect';

export const LIGHT_CAPACITY_RGB = 0x1;
export const LIGHT_CAPACITY_TEMPERATURE = 0x2;
export const LIGHT_CAPACITY_LUMINANCE = 0x4;
export const LIGHT_CAPACITY_EFFECT = 0x8;

export interface LightChannelWireState {
    channel: number;
    capacity: number;
    rgb?: number;
    temperature?: number;
    luminance?: number;
    effect?: number;
    /**
     * Light "on/off" (1 = on, 0 = off). This is not the same as Toggle/ToggleX
     * device-level on/off.
     */
    onoff?: boolean;
}

export interface LightSetOptions {
    channel: number;
    /**
     * Bitmask declaring which value fields in this command are valid.
     * Typically you pass the device's reported capacity.
     */
    capacity: number;
    rgb?: number;
    temperature?: number;
    luminance?: number;
    effect?: number;
    onoff?: boolean;
}

/**
 * One Light.Effect catalog row. SET repeats the GETACK object with `enable`
 * flipped; extra firmware keys stay on the object.
 */
export interface LightEffectEntry {
    Id: string;
    effectName: string;
    enable?: number;
}

/**
 * Firmware GET for Control.Light uses an empty payload.
 */
export function encodeLightGet(): MerossPayload {
    return {};
}

/**
 * SET payload for Control.Light is always a single-channel object.
 */
export function encodeLightSet(options: LightSetOptions): MerossPayload {
    const light: Record<string, unknown> = {
        channel: options.channel,
        capacity: options.capacity
    };

    if (options.rgb !== undefined) {
        light.rgb = options.rgb;
    }
    if (options.temperature !== undefined) {
        light.temperature = options.temperature;
    }
    if (options.luminance !== undefined) {
        light.luminance = options.luminance;
    }
    if (options.effect !== undefined) {
        light.effect = options.effect;
    }
    if (options.onoff !== undefined) {
        light.onoff = options.onoff ? 1 : 0;
    }

    return { light };
}

/**
 * Decodes a firmware light object from GETACK/SETACK/PUSH payloads.
 */
export function decodeLightGetAck(payload: MerossPayload): LightChannelWireState {
    return decodeLight(payload);
}

/**
 * Decodes a firmware light object from PUSH payloads.
 */
export function decodeLightPush(payload: MerossPayload): LightChannelWireState {
    return decodeLight(payload);
}

/** Empty `effect` list returns the full catalog. */
export function encodeLightEffectGet(): MerossPayload {
    return { effect: [] };
}

export function encodeLightEffectSet(entries: LightEffectEntry[]): MerossPayload {
    return { effect: entries };
}

export function decodeLightEffectGetAck(payload: MerossPayload): LightEffectEntry[] {
    return decodeLightEffect(payload);
}

export function decodeLightEffectPush(payload: MerossPayload): LightEffectEntry[] {
    return decodeLightEffect(payload);
}

function decodeLight(payload: MerossPayload): LightChannelWireState {
    const raw = payload.light;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new ProtocolError('Control.Light light payload must be an object');
    }

    const { channel, capacity, rgb, temperature, luminance, effect, onoff } = raw as Record<string, unknown>;
    if (typeof channel !== 'number' || typeof capacity !== 'number') {
        throw new ProtocolError('Control.Light channel and capacity are required');
    }

    const state: LightChannelWireState = { channel, capacity };

    if (typeof rgb === 'number' && rgb !== -1) {
        state.rgb = rgb;
    }
    if (typeof temperature === 'number' && temperature !== -1) {
        state.temperature = temperature;
    }
    if (typeof luminance === 'number' && luminance !== -1) {
        state.luminance = luminance;
    }
    if (typeof effect === 'number' && effect !== -1) {
        state.effect = effect;
    }
    if (typeof onoff === 'number' && onoff !== -1) {
        state.onoff = onoff === 1;
    }

    return state;
}

function decodeLightEffect(payload: MerossPayload): LightEffectEntry[] {
    const raw = payload.effect;
    if (!Array.isArray(raw)) {
        throw new ProtocolError('Light.Effect payload must contain an effect array');
    }
    return raw.map(decodeLightEffectEntry);
}

function decodeLightEffectEntry(item: unknown): LightEffectEntry {
    if (typeof item !== 'object' || item === null) {
        throw new ProtocolError('Light.Effect entry must be an object');
    }
    const { Id, effectName } = item as Record<string, unknown>;
    if (typeof Id !== 'string' || typeof effectName !== 'string') {
        throw new ProtocolError('Light.Effect Id and effectName are required');
    }
    return item as LightEffectEntry;
}
