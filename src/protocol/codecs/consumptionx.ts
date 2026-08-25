import { ProtocolError } from '../../errors';
import type { MerossPayload } from '../message';

export const CONSUMPTIONX_NAMESPACE = 'Appliance.Control.ConsumptionX';

/** One day of board-level consumption in watt-hours. */
export interface ConsumptionXDay {
    date: string;
    value: number;
    time: number;
}

/** Firmware GET uses an empty payload. */
export function encodeConsumptionXGet(): MerossPayload {
    return {};
}

/** Firmware DELETE uses an empty payload. */
export function encodeConsumptionXDelete(): MerossPayload {
    return {};
}

/** GETACK `consumptionx` is an array of daily records. */
export function decodeConsumptionXGetAck(payload: MerossPayload): ConsumptionXDay[] {
    const raw = payload.consumptionx;
    if (!Array.isArray(raw)) {
        throw new ProtocolError('ConsumptionX GETACK consumptionx must be an array');
    }
    return raw.map((entry) => {
        if (typeof entry !== 'object' || entry === null) {
            throw new ProtocolError('ConsumptionX day entry must be an object');
        }
        const { date, value, time } = entry as Record<string, unknown>;
        if (typeof date !== 'string' || typeof value !== 'number' || typeof time !== 'number') {
            throw new ProtocolError('ConsumptionX date, value, and time are required');
        }
        return { date, value, time };
    });
}
