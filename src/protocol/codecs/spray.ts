import { ProtocolError } from '../../errors';
import type { MerossPayload } from '../message';

export const SPRAY_NAMESPACE = 'Appliance.Control.Spray';

/** Wire 0 = off, 1 = continuous, 2 = intermittent. */
export type SprayMode = 'off' | 'continuous' | 'intermittent';

export interface SprayChannelState {
    channel: number;
    mode: SprayMode;
}

const SPRAY_MODE_FROM_WIRE: Record<number, SprayMode> = {
    0: 'off',
    1: 'continuous',
    2: 'intermittent'
};

const SPRAY_MODE_TO_WIRE: Record<SprayMode, number> = {
    off: 0,
    continuous: 1,
    intermittent: 2
};

/** GET is empty; firmware returns every channel. */
export function encodeSprayGet(): MerossPayload {
    return {};
}

/** SET is a single-channel object. */
export function encodeSpraySet(options: SprayChannelState): MerossPayload {
    return {
        spray: {
            channel: options.channel,
            mode: SPRAY_MODE_TO_WIRE[options.mode]
        }
    };
}

/**
 * GETACK and PUSH may be a single object or an array.
 */
export function decodeSprayGetAck(payload: MerossPayload): SprayChannelState[] {
    return decodeSpray(payload);
}

export function decodeSprayPush(payload: MerossPayload): SprayChannelState[] {
    return decodeSpray(payload);
}

function decodeSpray(payload: MerossPayload): SprayChannelState[] {
    const raw = payload.spray;
    if (Array.isArray(raw)) {
        return raw.map(decodeSprayEntry);
    }
    if (typeof raw === 'object' && raw !== null) {
        return [decodeSprayEntry(raw)];
    }
    throw new ProtocolError('Control.Spray payload must contain a spray object or array');
}

function decodeSprayEntry(item: unknown): SprayChannelState {
    if (typeof item !== 'object' || item === null) {
        throw new ProtocolError('Control.Spray entry must be an object');
    }
    const { channel, mode } = item as Record<string, unknown>;
    if (typeof channel !== 'number' || typeof mode !== 'number') {
        throw new ProtocolError('Control.Spray channel and mode are required');
    }
    const mapped = SPRAY_MODE_FROM_WIRE[mode];
    if (mapped === undefined) {
        throw new ProtocolError('Control.Spray mode is unknown');
    }
    return { channel, mode: mapped };
}
