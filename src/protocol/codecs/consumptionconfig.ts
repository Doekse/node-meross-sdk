import { ProtocolError } from '../../errors';
import type { MerossPayload } from '../message';
import { parseElectricityConfig, type ElectricityConfig } from './electricity';

export const CONSUMPTION_CONFIG_NAMESPACE = 'Appliance.Control.ConsumptionConfig';

/** Firmware GET uses an empty payload. */
export function encodeConsumptionConfigGet(): MerossPayload {
    return {};
}

export function decodeConsumptionConfigGetAck(payload: MerossPayload): ElectricityConfig {
    return decodeConsumptionConfig(payload);
}

export function decodeConsumptionConfigPush(payload: MerossPayload): ElectricityConfig {
    return decodeConsumptionConfig(payload);
}

function decodeConsumptionConfig(payload: MerossPayload): ElectricityConfig {
    const raw = payload.config;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new ProtocolError('ConsumptionConfig payload must contain config object');
    }
    const config = parseElectricityConfig(raw);
    if (!config) {
        throw new ProtocolError('ConsumptionConfig voltageRatio and electricityRatio are required');
    }
    return config;
}
