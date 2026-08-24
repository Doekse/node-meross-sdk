import { ProtocolError } from '../../errors';
import type { MerossPayload } from '../message';

export const FAN_NAMESPACE = 'Appliance.Control.Fan';
export const FAN_CONFIG_NAMESPACE = 'Appliance.Control.Fan.Config';
export const FAN_BTN_CONFIG_NAMESPACE = 'Appliance.Control.Fan.BtnConfig';
export const FILTER_MAINTENANCE_NAMESPACE = 'Appliance.Control.FilterMaintenance';

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

export interface FanConfigState {
    channel: number;
    maxSpeed?: number;
}

export interface FanPowerBtn {
    type?: number;
}

export interface FanControlBtn {
    onoffType?: number;
    levelType?: number;
}

export interface FanButtonConfig {
    channel: number;
    powerBtn?: FanPowerBtn;
    controlBtn?: FanControlBtn;
}

export interface FanButtonConfigSetOptions {
    channel: number;
    powerBtn?: FanPowerBtn;
    controlBtn?: FanControlBtn;
}

export interface FilterMaintenanceState {
    channel: number;
    life: number;
    lmTime?: number;
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

/** GET `{ config: [{ channel }] }`. Traces use `config`, not `fan`. */
export function encodeFanConfigGet(options: { channel: number }): MerossPayload {
    return { config: [{ channel: options.channel }] };
}

export function decodeFanConfigGetAck(payload: MerossPayload): FanConfigState[] {
    return decodeKeyedList(payload, 'config', 'Fan.Config').map(decodeFanConfigEntry);
}

/**
 * PUSH-query body is `{}`. GET disconnects on MFC100.
 */
export function encodeFanBtnConfigPushQuery(): MerossPayload {
    return {};
}

/** SET `{ config: [{ channel, powerBtn? | controlBtn? }] }`. */
export function encodeFanBtnConfigSet(options: FanButtonConfigSetOptions): MerossPayload {
    const entry: Record<string, unknown> = { channel: options.channel };
    if (options.powerBtn !== undefined) {
        entry.powerBtn = options.powerBtn;
    }
    if (options.controlBtn !== undefined) {
        entry.controlBtn = options.controlBtn;
    }
    return { config: [entry] };
}

export function decodeFanBtnConfigPush(payload: MerossPayload): FanButtonConfig[] {
    return decodeKeyedList(payload, 'config', 'Fan.BtnConfig').map(decodeFanBtnConfigEntry);
}

/**
 * FilterMaintenance is push-query only. GET disconnects on MAP100.
 */
export function encodeFilterMaintenancePushQuery(): MerossPayload {
    return {};
}

export function decodeFilterMaintenancePush(payload: MerossPayload): FilterMaintenanceState[] {
    return decodeKeyedList(payload, 'filter', 'FilterMaintenance').map(decodeFilterMaintenanceEntry);
}

function decodeFan(payload: MerossPayload): FanChannelState[] {
    return decodeKeyedList(payload, 'fan', 'Control.Fan').map(decodeFanEntry);
}

function decodeKeyedList(payload: MerossPayload, key: string, label: string): unknown[] {
    const raw = payload[key];
    if (Array.isArray(raw)) {
        return raw;
    }
    if (typeof raw === 'object' && raw !== null) {
        return [raw];
    }
    throw new ProtocolError(`${label} payload must contain a ${key} object or array`);
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

function decodeFanConfigEntry(item: unknown): FanConfigState {
    if (typeof item !== 'object' || item === null) {
        throw new ProtocolError('Fan.Config entry must be an object');
    }
    const { channel, maxSpeed } = item as Record<string, unknown>;
    if (typeof channel !== 'number') {
        throw new ProtocolError('Fan.Config channel is required');
    }
    const state: FanConfigState = { channel };
    if (typeof maxSpeed === 'number') {
        state.maxSpeed = maxSpeed;
    }
    return state;
}

function decodeFanBtnConfigEntry(item: unknown): FanButtonConfig {
    if (typeof item !== 'object' || item === null) {
        throw new ProtocolError('Fan.BtnConfig entry must be an object');
    }
    const { channel, powerBtn, controlBtn } = item as Record<string, unknown>;
    if (typeof channel !== 'number') {
        throw new ProtocolError('Fan.BtnConfig channel is required');
    }
    const state: FanButtonConfig = { channel };
    if (typeof powerBtn === 'object' && powerBtn !== null) {
        const { type } = powerBtn as Record<string, unknown>;
        if (typeof type === 'number') {
            state.powerBtn = { type };
        }
    }
    if (typeof controlBtn === 'object' && controlBtn !== null) {
        const { onoffType, levelType } = controlBtn as Record<string, unknown>;
        state.controlBtn = {
            ...(typeof onoffType === 'number' ? { onoffType } : {}),
            ...(typeof levelType === 'number' ? { levelType } : {})
        };
    }
    return state;
}

function decodeFilterMaintenanceEntry(item: unknown): FilterMaintenanceState {
    if (typeof item !== 'object' || item === null) {
        throw new ProtocolError('FilterMaintenance entry must be an object');
    }
    const { channel, life, lmTime } = item as Record<string, unknown>;
    if (typeof channel !== 'number' || typeof life !== 'number') {
        throw new ProtocolError('FilterMaintenance channel and life are required');
    }
    return {
        channel,
        life,
        ...(typeof lmTime === 'number' ? { lmTime } : {})
    };
}
