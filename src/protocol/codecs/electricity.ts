import { ProtocolError } from '../../errors';
import type { MerossPayload } from '../message';

export const ELECTRICITY_NAMESPACE = 'Appliance.Control.Electricity';

/** Voltage/current coefficients. `maxElectricityCurrent` is milliamps when present. */
export interface ElectricityConfig {
    voltageRatio: number;
    electricityRatio: number;
    maxElectricityCurrent?: number;
}

export function parseElectricityConfig(raw: unknown): ElectricityConfig | undefined {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return undefined;
    }
    const { voltageRatio, electricityRatio, maxElectricityCurrent } = raw as Record<string, unknown>;
    if (typeof voltageRatio !== 'number' || typeof electricityRatio !== 'number') {
        return undefined;
    }
    const config: ElectricityConfig = { voltageRatio, electricityRatio };
    if (typeof maxElectricityCurrent === 'number') {
        config.maxElectricityCurrent = maxElectricityCurrent;
    }
    return config;
}

/** Instantaneous metrics in host units (W, A, V, Wh). */
export interface ElectricitySample {
    channel: number;
    power: number;
    current: number;
    voltage: number;
    consume?: number;
    powerFactor?: number;
    config?: ElectricityConfig;
}

export interface ElectricityGetOptions {
    channel: number;
}

/** GET is a single-channel object. */
export function encodeElectricityGet(options: ElectricityGetOptions): MerossPayload {
    return { electricity: { channel: options.channel } };
}

/** GETACK (and PUSH when present) carry one channel as an object. */
export function decodeElectricityGetAck(payload: MerossPayload): ElectricitySample {
    const raw = payload.electricity;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new ProtocolError('Electricity GETACK electricity must be an object');
    }
    const { channel, power, current, voltage, consume, config } = raw as Record<string, unknown>;
    if (
        typeof channel !== 'number'
        || typeof power !== 'number'
        || typeof current !== 'number'
        || typeof voltage !== 'number'
    ) {
        throw new ProtocolError('Electricity channel, power, current, and voltage are required');
    }
    const sample: ElectricitySample = {
        channel,
        power: power / 1000,
        current: current / 1000,
        voltage: voltage / 10
    };
    if (typeof consume === 'number') {
        sample.consume = consume;
    }
    const parsedConfig = parseElectricityConfig(config);
    if (parsedConfig) {
        sample.config = parsedConfig;
    }
    return sample;
}

export const ELECTRICITYX_NAMESPACE = 'Appliance.Control.ElectricityX';

/**
 * GET channel `0xffff` means every channel. An empty GET misses some devices.
 */
export const ELECTRICITYX_ALL_CHANNELS = 0xffff;

export function encodeElectricityXGet(): MerossPayload {
    return { electricity: { channel: ELECTRICITYX_ALL_CHANNELS } };
}

/**
 * Voltage is millivolts. `electricity` is an array (or a single object).
 */
export function decodeElectricityXGetAck(payload: MerossPayload): ElectricitySample[] {
    const raw = payload.electricity;
    const items = Array.isArray(raw)
        ? raw
        : (raw && typeof raw === 'object' ? [raw] : null);
    if (!items) {
        throw new ProtocolError('ElectricityX GETACK electricity must be an object or array');
    }
    return items.map((entry) => {
        if (typeof entry !== 'object' || entry === null) {
            throw new ProtocolError('ElectricityX channel entry must be an object');
        }
        const { channel, power, current, voltage, mConsume, factor } = entry as Record<string, unknown>;
        if (
            typeof channel !== 'number'
            || typeof power !== 'number'
            || typeof current !== 'number'
            || typeof voltage !== 'number'
        ) {
            throw new ProtocolError('ElectricityX channel, power, current, and voltage are required');
        }
        const sample: ElectricitySample = {
            channel,
            power: power / 1000,
            current: current / 1000,
            voltage: voltage / 1000
        };
        if (typeof mConsume === 'number') {
            sample.consume = mConsume;
        }
        if (typeof factor === 'number') {
            sample.powerFactor = factor / 100;
        }
        return sample;
    });
}
