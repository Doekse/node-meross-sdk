import { ProtocolError } from '../../errors';
import type { MerossPayload } from '../message';

export const DIFFUSER_LIGHT_NAMESPACE = 'Appliance.Control.Diffuser.Light';
export const DIFFUSER_SPRAY_NAMESPACE = 'Appliance.Control.Diffuser.Spray';
export const DIFFUSER_SENSOR_NAMESPACE = 'Appliance.Control.Diffuser.Sensor';

/** Wire 0 = rotating-colors, 1 = fixed-rgb, 2 = fixed-luminance. */
export type DiffuserLightMode = 'rotating-colors' | 'fixed-rgb' | 'fixed-luminance';

/** Wire 0 = light, 1 = strong, 2 = off. */
export type DiffuserSprayMode = 'light' | 'strong' | 'off';

export interface DiffuserLightState {
    channel: number;
    on?: boolean;
    mode?: DiffuserLightMode;
    luminance?: number;
    rgb?: number;
}

export interface DiffuserSprayState {
    channel: number;
    mode: DiffuserSprayMode;
}

export interface DiffuserSensorState {
    humidity?: number;
    /** Celsius; firmware value is tenths of a degree. */
    temperature?: number;
}

export interface DiffuserLightSetOptions {
    channel: number;
    on?: boolean;
    mode?: DiffuserLightMode;
    luminance?: number;
    rgb?: number;
}

export interface DiffuserSpraySetOptions {
    channel: number;
    mode: DiffuserSprayMode;
}

const LIGHT_MODE_FROM_WIRE: Record<number, DiffuserLightMode> = {
    0: 'rotating-colors',
    1: 'fixed-rgb',
    2: 'fixed-luminance'
};

const LIGHT_MODE_TO_WIRE: Record<DiffuserLightMode, number> = {
    'rotating-colors': 0,
    'fixed-rgb': 1,
    'fixed-luminance': 2
};

const SPRAY_MODE_FROM_WIRE: Record<number, DiffuserSprayMode> = {
    0: 'light',
    1: 'strong',
    2: 'off'
};

const SPRAY_MODE_TO_WIRE: Record<DiffuserSprayMode, number> = {
    light: 0,
    strong: 1,
    off: 2
};

/** Firmware GET for Diffuser.Light uses an empty payload. */
export function encodeDiffuserLightGet(): MerossPayload {
    return {};
}

/** SET is a one-entry list. */
export function encodeDiffuserLightSet(options: DiffuserLightSetOptions): MerossPayload {
    const light: Record<string, unknown> = { channel: options.channel };
    if (options.on !== undefined) {
        light.onoff = options.on ? 1 : 0;
    }
    if (options.mode !== undefined) {
        light.mode = LIGHT_MODE_TO_WIRE[options.mode];
    }
    if (options.luminance !== undefined) {
        light.luminance = options.luminance;
    }
    if (options.rgb !== undefined) {
        light.rgb = options.rgb;
    }
    return { light: [light] };
}

export function decodeDiffuserLightGetAck(payload: MerossPayload): DiffuserLightState[] {
    return decodeDiffuserLight(payload);
}

export function decodeDiffuserLightPush(payload: MerossPayload): DiffuserLightState[] {
    return decodeDiffuserLight(payload);
}

/** Firmware GET for Diffuser.Spray uses an empty payload. */
export function encodeDiffuserSprayGet(): MerossPayload {
    return {};
}

/** SET is a one-entry list. */
export function encodeDiffuserSpraySet(options: DiffuserSpraySetOptions): MerossPayload {
    return {
        spray: [{ channel: options.channel, mode: SPRAY_MODE_TO_WIRE[options.mode] }]
    };
}

export function decodeDiffuserSprayGetAck(payload: MerossPayload): DiffuserSprayState[] {
    return decodeDiffuserSpray(payload);
}

export function decodeDiffuserSprayPush(payload: MerossPayload): DiffuserSprayState[] {
    return decodeDiffuserSpray(payload);
}

/** Firmware GET for Diffuser.Sensor uses an empty payload. */
export function encodeDiffuserSensorGet(): MerossPayload {
    return {};
}

export function decodeDiffuserSensorGetAck(payload: MerossPayload): DiffuserSensorState {
    return decodeDiffuserSensor(payload);
}

export function decodeDiffuserSensorPush(payload: MerossPayload): DiffuserSensorState {
    return decodeDiffuserSensor(payload);
}

function decodeDiffuserLight(payload: MerossPayload): DiffuserLightState[] {
    return decodeKeyedList(payload, 'light', 'Diffuser.Light').map(decodeLightEntry);
}

function decodeDiffuserSpray(payload: MerossPayload): DiffuserSprayState[] {
    return decodeKeyedList(payload, 'spray', 'Diffuser.Spray').map(decodeSprayEntry);
}

function decodeDiffuserSensor(payload: MerossPayload): DiffuserSensorState {
    const state: DiffuserSensorState = {};
    const humidity = nestedNumber(payload.humidity, 'value');
    if (humidity !== undefined) {
        state.humidity = humidity;
    }
    const temperature = nestedNumber(payload.temperature, 'value');
    if (temperature !== undefined) {
        state.temperature = temperature / 10;
    }
    return state;
}

function decodeLightEntry(item: Record<string, unknown>): DiffuserLightState {
    const { channel, onoff, mode, luminance, rgb } = item;
    if (typeof channel !== 'number') {
        throw new ProtocolError('Diffuser.Light channel is required');
    }
    const state: DiffuserLightState = { channel };
    if (typeof onoff === 'number') {
        state.on = onoff === 1;
    }
    if (typeof mode === 'number') {
        const mapped = LIGHT_MODE_FROM_WIRE[mode];
        if (mapped === undefined) {
            throw new ProtocolError('Diffuser.Light mode is unknown');
        }
        state.mode = mapped;
    }
    if (typeof luminance === 'number') {
        state.luminance = luminance;
    }
    if (typeof rgb === 'number') {
        state.rgb = rgb;
    }
    return state;
}

function decodeSprayEntry(item: Record<string, unknown>): DiffuserSprayState {
    const { channel, mode } = item;
    if (typeof channel !== 'number' || typeof mode !== 'number') {
        throw new ProtocolError('Diffuser.Spray channel and mode are required');
    }
    const mapped = SPRAY_MODE_FROM_WIRE[mode];
    if (mapped === undefined) {
        throw new ProtocolError('Diffuser.Spray mode is unknown');
    }
    return { channel, mode: mapped };
}

function decodeKeyedList(
    payload: MerossPayload,
    key: string,
    label: string
): Record<string, unknown>[] {
    const raw = payload[key];
    if (!Array.isArray(raw)) {
        throw new ProtocolError(`${label} payload must contain a ${key} array`);
    }
    return raw.map((item) => {
        if (typeof item !== 'object' || item === null) {
            throw new ProtocolError(`${label} entry must be an object`);
        }
        return item as Record<string, unknown>;
    });
}

function nestedNumber(raw: unknown, field: string): number | undefined {
    if (typeof raw !== 'object' || raw === null) {
        return undefined;
    }
    const value = (raw as Record<string, unknown>)[field];
    return typeof value === 'number' ? value : undefined;
}
