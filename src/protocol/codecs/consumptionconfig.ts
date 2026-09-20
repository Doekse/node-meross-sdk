import { ProtocolError } from '../../errors';
import { EMPTY_PAYLOAD, type MerossPayload } from '../message';
import { parseElectricityConfig, type ElectricityConfig } from './electricity';

export { CONSUMPTION_CONFIG_NAMESPACE } from '../namespaces';

/** Firmware GET uses an empty payload. */
export function encodeConsumptionConfigGet(): MerossPayload {
    return EMPTY_PAYLOAD;
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
