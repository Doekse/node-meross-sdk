import { ProtocolError } from '../../errors';
import type { MerossPayload } from '../message';

export const DND_MODE_NAMESPACE = 'Appliance.System.DNDMode';

export interface DndState {
    on: boolean;
}

/** GET is empty. */
export function encodeDndGet(): MerossPayload {
    return {};
}

/** SET is `{ DNDMode: { mode: 0|1 } }`. */
export function encodeDndSet(options: { on: boolean }): MerossPayload {
    return {
        DNDMode: { mode: options.on ? 1 : 0 }
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
    return { on: mode === 1 };
}
