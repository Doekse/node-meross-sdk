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

/**
 * Instantaneous metrics in host units (W, A, V, Wh). Decode keeps whichever
 * of power/current/voltage are present; channel is omitted on board-level
 * Electricity.
 */
export interface ElectricitySample {
    channel?: number;
    power?: number;
    current?: number;
    voltage?: number;
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

function scaledField(value: unknown, scale: number): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return undefined;
    }
    return value / scale;
}

/**
 * Board Electricity omits channel and any of power/current/voltage; keep
 * whichever fields are present rather than rejecting the sample.
 */
function sampleFromFields(
    raw: Record<string, unknown>,
    scales: { power: number; current: number; voltage: number }
): ElectricitySample {
    const sample: ElectricitySample = {};
    if (typeof raw.channel === 'number') {
        sample.channel = raw.channel;
    }
    const power = scaledField(raw.power, scales.power);
    if (power !== undefined) {
        sample.power = power;
    }
    const current = scaledField(raw.current, scales.current);
    if (current !== undefined) {
        sample.current = current;
    }
    const voltage = scaledField(raw.voltage, scales.voltage);
    if (voltage !== undefined) {
        sample.voltage = voltage;
    }
    if (typeof raw.consume === 'number') {
        sample.consume = raw.consume;
    }
    if (typeof raw.mConsume === 'number') {
        sample.consume = raw.mConsume;
    }
    if (typeof raw.factor === 'number') {
        sample.powerFactor = raw.factor / 100;
    }
    const parsedConfig = parseElectricityConfig(raw.config);
    if (parsedConfig) {
        sample.config = parsedConfig;
    }
    return sample;
}

/** One object; missing power/current/voltage stay omitted rather than failing decode. */
export function decodeElectricityGetAck(payload: MerossPayload): ElectricitySample {
    const raw = payload.electricity;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new ProtocolError('Electricity GETACK electricity must be an object');
    }
    return sampleFromFields(raw as Record<string, unknown>, {
        power: 1000,
        current: 1000,
        voltage: 10
    });
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
    const samples: ElectricitySample[] = [];
    for (const entry of items) {
        if (typeof entry !== 'object' || entry === null) {
            continue;
        }
        const sample = sampleFromFields(entry as Record<string, unknown>, {
            power: 1000,
            current: 1000,
            voltage: 1000
        });
        // A row without a channel cannot be routed to an endpoint.
        if (sample.channel === undefined) {
            continue;
        }
        samples.push(sample);
    }
    return samples;
}
