import { ProtocolError } from '../../errors';
import type { MerossPayload } from '../message';

export const MULTIPLE_NAMESPACE = 'Appliance.Control.Multiple';

export interface MultipleSubCommand {
    header: {
        namespace: string;
        method: string;
    };
    payload: MerossPayload;
}

/**
 * Nested Control.Multiple is invalid. System.All and Hub.ToggleX pack like
 * any other GET: excluding either spends a whole cloud-MQTT publish on that
 * namespace alone, which can starve a same-tick smart poll of its cycle budget.
 */
export function canPackInMultiple(namespace: string): boolean {
    return namespace !== MULTIPLE_NAMESPACE;
}

/**
 * SET payload: `multiple` is an array of `{ header: { namespace, method }, payload }`.
 */
export function encodeMultipleSet(commands: MultipleSubCommand[]): MerossPayload {
    return {
        multiple: commands.map((command) => ({
            header: {
                method: command.header.method,
                namespace: command.header.namespace
            },
            payload: command.payload
        }))
    };
}

/**
 * SETACK `multiple` is parallel to the SET array: GETACK/SETACK/DELACK/ERROR
 * in the same order and count.
 */
export function decodeMultipleAck(payload: MerossPayload): MultipleSubCommand[] {
    const raw = payload.multiple;
    if (!Array.isArray(raw)) {
        throw new ProtocolError('Control.Multiple ACK multiple must be an array');
    }
    return raw.map((item) => {
        if (typeof item !== 'object' || item === null) {
            throw new ProtocolError('Control.Multiple sub-command must be an object');
        }
        const { header, payload: subPayload } = item as { header?: unknown; payload?: unknown };
        if (typeof header !== 'object' || header === null || typeof subPayload !== 'object' || subPayload === null) {
            throw new ProtocolError('Control.Multiple sub-command requires header and payload objects');
        }
        const { namespace, method } = header as Record<string, unknown>;
        if (typeof namespace !== 'string' || typeof method !== 'string') {
            throw new ProtocolError('Control.Multiple sub-command header requires namespace and method');
        }
        return {
            header: { namespace, method },
            payload: subPayload as MerossPayload
        };
    });
}
