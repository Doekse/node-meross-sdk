import { ProtocolError } from '../../errors';
import type { MerossPayload } from '../message';

export const MULTIPLE_NAMESPACE = 'Appliance.Control.Multiple';
export const SYSTEM_ALL_NAMESPACE = 'Appliance.System.All';
export const HUB_TOGGLEX_NAMESPACE = 'Appliance.Hub.ToggleX';

export interface MultipleSubCommand {
    header: {
        namespace: string;
        method: string;
    };
    payload: MerossPayload;
}

/**
 * Firmware forbids nesting System.All / Control.Multiple, and Hub.ToggleX
 * has a valve bug that requires a standalone request sent first.
 */
export function canPackInMultiple(namespace: string): boolean {
    return namespace !== MULTIPLE_NAMESPACE
        && namespace !== SYSTEM_ALL_NAMESPACE
        && namespace !== HUB_TOGGLEX_NAMESPACE;
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
