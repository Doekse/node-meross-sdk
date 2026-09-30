import { ProtocolError } from '../../errors';
import type { MerossPayload } from '../message';

export { CONSUMPTIONH_NAMESPACE } from '../namespaces';

/** One hourly board-level consumption sample in watt-hours. */
export interface ConsumptionHHour {
    timestamp: number;
    value: number;
}

/**
 * One channel from GETACK `consumptionH`.
 * `hourly` is absent when firmware omits `data`, so a later poll cannot
 * wipe a series that was never replaced. `total` is the watt-hour reading
 * meross_lan shows for this namespace.
 */
export interface ConsumptionHChannel {
    channel: number;
    hourly?: ConsumptionHHour[];
    total?: number;
}

/** Firmware GET targets one channel in a `consumptionH` array. */
export function encodeConsumptionHGet(channel: number): MerossPayload {
    return { consumptionH: [{ channel }] };
}

/**
 * GETACK `consumptionH` is an array of channel rows. meross_lan routes on
 * `channel` and reads `total`; `data` is an optional hourly series.
 * A row that cannot be routed is dropped so one channel cannot fail the rest.
 */
export function decodeConsumptionHGetAck(payload: MerossPayload): ConsumptionHChannel[] {
    const raw = payload.consumptionH;
    if (!Array.isArray(raw)) {
        throw new ProtocolError('ConsumptionH GETACK consumptionH must be an array');
    }
    const channels: ConsumptionHChannel[] = [];
    for (const entry of raw) {
        if (typeof entry !== 'object' || entry === null) {
            continue;
        }
        const { channel, total, data } = entry as Record<string, unknown>;
        // A row without a channel cannot be routed to an endpoint.
        if (typeof channel !== 'number') {
            continue;
        }
        const decoded: ConsumptionHChannel = { channel };
        if (typeof total === 'number') {
            decoded.total = total;
        }
        if (Array.isArray(data)) {
            decoded.hourly = decodeConsumptionHHours(data);
        }
        // A row with neither carries nothing meross_lan would display.
        if (decoded.total === undefined && decoded.hourly === undefined) {
            continue;
        }
        channels.push(decoded);
    }
    return channels;
}

/** A bad hour is dropped so the rest of the channel, including `total`, still applies. */
function decodeConsumptionHHours(data: readonly unknown[]): ConsumptionHHour[] {
    const hourly: ConsumptionHHour[] = [];
    for (const point of data) {
        if (typeof point !== 'object' || point === null) {
            continue;
        }
        const { timestamp, value } = point as Record<string, unknown>;
        if (typeof timestamp !== 'number' || typeof value !== 'number') {
            continue;
        }
        hourly.push({ timestamp, value });
    }
    return hourly;
}
