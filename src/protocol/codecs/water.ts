import { ProtocolError } from '../../errors';
import type { MerossPayload } from '../message';

export const CONTROL_WATER_NAMESPACE = 'Appliance.Control.Water';
export const DEVICE_CFG_NAMESPACE = 'Appliance.Config.DeviceCfg';

export interface WaterControlState {
    subId: string;
    channel: number;
    on: boolean;
    /** Watering duration in seconds when the payload carries dura. */
    duration?: number;
}

export interface MstDeviceCfgState {
    subId: string;
    channel: number;
    /** Default watering duration in seconds from mstCfg.dura. */
    duration?: number;
}

export interface WaterGetOptions {
    subId: string;
}

export interface WaterSetOptions {
    subId: string;
    on: boolean;
}

export interface DeviceCfgGetOptions {
    subId: string;
}

export interface DeviceCfgSetOptions {
    subId: string;
    duration: number;
}

function encodeArray(key: string, entry: Record<string, unknown>): MerossPayload {
    return { [key]: [entry] };
}

function decodeArray(payload: MerossPayload, key: string, label: string): Record<string, unknown>[] {
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

function decodeWaterControl(payload: MerossPayload): WaterControlState[] {
    return decodeArray(payload, 'control', 'Control.Water').map((item) => {
        const { subId, channel, onoff, dura } = item;
        if (typeof subId !== 'string' || typeof channel !== 'number' || typeof onoff !== 'number') {
            throw new ProtocolError('Control.Water entry requires subId, channel, and onoff');
        }
        const result: WaterControlState = { subId, channel, on: onoff === 1 };
        if (typeof dura === 'number') {
            result.duration = dura;
        }
        return result;
    });
}

function decodeMstDeviceCfg(payload: MerossPayload): MstDeviceCfgState[] {
    return decodeArray(payload, 'config', 'Config.DeviceCfg').map((item) => {
        const { subId, channel, mstCfg } = item;
        if (typeof subId !== 'string' || typeof channel !== 'number') {
            throw new ProtocolError('Config.DeviceCfg entry requires subId and channel');
        }
        const result: MstDeviceCfgState = { subId, channel };
        if (typeof mstCfg === 'object' && mstCfg !== null) {
            const dura = (mstCfg as Record<string, unknown>).dura;
            if (typeof dura === 'number') {
                result.duration = dura;
            }
        }
        return result;
    });
}

export function encodeWaterGet(options: WaterGetOptions): MerossPayload {
    return encodeArray('control', { subId: options.subId, channel: 0 });
}

/** Firmware onoff is 1 = on, 2 = off (not ToggleX 0/1). */
export function encodeWaterSet(options: WaterSetOptions): MerossPayload {
    return encodeArray('control', {
        subId: options.subId,
        channel: 0,
        onoff: options.on ? 1 : 2
    });
}

export function decodeWaterGetAck(payload: MerossPayload): WaterControlState[] {
    return decodeWaterControl(payload);
}

export function decodeWaterPush(payload: MerossPayload): WaterControlState[] {
    return decodeWaterControl(payload);
}

export function encodeDeviceCfgGet(options: DeviceCfgGetOptions): MerossPayload {
    return encodeArray('config', { subId: options.subId, channel: 0 });
}

export function encodeDeviceCfgSet(options: DeviceCfgSetOptions): MerossPayload {
    return encodeArray('config', {
        subId: options.subId,
        channel: 0,
        mstCfg: { dura: options.duration }
    });
}

export function decodeDeviceCfgGetAck(payload: MerossPayload): MstDeviceCfgState[] {
    return decodeMstDeviceCfg(payload);
}

export function decodeDeviceCfgPush(payload: MerossPayload): MstDeviceCfgState[] {
    return decodeMstDeviceCfg(payload);
}
