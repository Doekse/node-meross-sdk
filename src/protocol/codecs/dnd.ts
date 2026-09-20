import { ProtocolError } from '../../errors';
import { EMPTY_PAYLOAD, type MerossPayload } from '../message';

export { DND_MODE_NAMESPACE } from '../namespaces';

export interface DndState {
    /** Status LED on. Firmware DNDMode is the inverse (`mode` 1 = LED off). */
    on: boolean;
}

const DND_GET = Object.freeze({ DNDMode: EMPTY_PAYLOAD }) as MerossPayload;

/** GET `{ DNDMode: {} }` (meross_lan dict GET shape). */
export function encodeDndGet(): MerossPayload {
    return DND_GET;
}

/**
 * SET `{ DNDMode: { mode: 0|1 } }`. `on` is the status LED so hosts never
 * invert; firmware DND is `mode` 1 when the LED is off.
 */
export function encodeDndSet(options: { on: boolean }): MerossPayload {
    return {
        DNDMode: { mode: options.on ? 0 : 1 }
    };
}

export function decodeDndGetAck(payload: MerossPayload): DndState {
    return decodeDnd(payload);
}

export function decodeDndPush(payload: MerossPayload): DndState {
    return decodeDnd(payload);
}

function decodeDnd(payload: MerossPayload): DndState {
    const raw = payload.DNDMode;
    if (typeof raw !== 'object' || raw === null) {
        throw new ProtocolError('System.DNDMode payload must contain DNDMode');
    }
    const mode = (raw as Record<string, unknown>).mode;
    if (typeof mode !== 'number' || (mode !== 0 && mode !== 1)) {
        throw new ProtocolError('System.DNDMode mode must be 0 or 1');
    }
    return { on: mode === 0 };
}
