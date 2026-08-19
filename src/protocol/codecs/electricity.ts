import { ProtocolError } from '../../errors';
import type { MerossPayload } from '../message';

export const ELECTRICITY_NAMESPACE = 'Appliance.Control.Electricity';

export interface ElectricityConfig {
    voltageRatio: number;
    electricityRatio: number;
    maxElectricityCurrent: number;
}

/** Instantaneous metrics in host units (W, A, V, Wh). */
export interface ElectricitySample {
    channel: number;
    power: number;
    current: number;
    voltage: number;
    consume?: number;
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
    if (config && typeof config === 'object') {
        const c = config as Record<string, unknown>;
        if (
            typeof c.voltageRatio === 'number'
            && typeof c.electricityRatio === 'number'
            && typeof c.maxElectricityCurrent === 'number'
        ) {
            sample.config = {
                voltageRatio: c.voltageRatio,
                electricityRatio: c.electricityRatio,
                maxElectricityCurrent: c.maxElectricityCurrent
            };
        }
    }
    return sample;
}
