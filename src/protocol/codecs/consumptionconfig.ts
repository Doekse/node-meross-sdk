import { ProtocolError } from '../../errors';
import type { MerossPayload } from '../message';
import { parseElectricityConfig, type ElectricityConfig } from './electricity';

export const CONSUMPTION_CONFIG_NAMESPACE = 'Appliance.Control.ConsumptionConfig';

/** Firmware GET is an empty payload. */
export function encodeConsumptionConfigGet(): MerossPayload {
    return {};
}

/** SET uses the GETACK `config` object. Firmware does not document SET. */
export function encodeConsumptionConfigSet(config: ElectricityConfig): MerossPayload {
    const body: Record<string, unknown> = {
        voltageRatio: config.voltageRatio,
        electricityRatio: config.electricityRatio
    };
    if (config.maxElectricityCurrent !== undefined) {
        body.maxElectricityCurrent = config.maxElectricityCurrent;
    }
    return { config: body };
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
