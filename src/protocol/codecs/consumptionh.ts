import { ProtocolError } from '../../errors';
import type { MerossPayload } from '../message';

export const CONSUMPTIONH_NAMESPACE = 'Appliance.Control.ConsumptionH';

/** One hourly board-level consumption sample in watt-hours. */
export interface ConsumptionHHour {
    timestamp: number;
    value: number;
}

/** One channel from GETACK `consumptionH`. */
export interface ConsumptionHChannel {
    channel: number;
    hourly: ConsumptionHHour[];
}

/** Firmware GET targets one channel in a `consumptionH` array. */
export function encodeConsumptionHGet(channel: number): MerossPayload {
    return { consumptionH: [{ channel }] };
}

/**
 * GETACK `consumptionH` is an array of `{ channel, data }` records.
 * `data` is the hourly series; `total` is a cumulative Wh scalar and is ignored.
 */
export function decodeConsumptionHGetAck(payload: MerossPayload): ConsumptionHChannel[] {
    const raw = payload.consumptionH;
    if (!Array.isArray(raw)) {
        throw new ProtocolError('ConsumptionH GETACK consumptionH must be an array');
    }
    return raw.map((entry) => {
        if (typeof entry !== 'object' || entry === null) {
            throw new ProtocolError('ConsumptionH channel entry must be an object');
        }
        const { channel, data } = entry as Record<string, unknown>;
        if (typeof channel !== 'number' || !Array.isArray(data)) {
            throw new ProtocolError('ConsumptionH channel and data are required');
        }
        return {
            channel,
            hourly: data.map((point) => {
                if (typeof point !== 'object' || point === null) {
                    throw new ProtocolError('ConsumptionH data entry must be an object');
                }
                const { timestamp, value } = point as Record<string, unknown>;
                if (typeof timestamp !== 'number' || typeof value !== 'number') {
                    throw new ProtocolError('ConsumptionH timestamp and value are required');
                }
                return { timestamp, value };
            })
        };
    });
}
