/**
 * One-entry list wrap shared by thermostat, hub sensor, sprinkler, alarm SET,
 * and diffuser GETACK. Firmware names the list key per namespace; callers still
 * own the entry field maps.
 */
import { ProtocolError } from '../../errors';
import type { MerossPayload } from '../message';

/**
 * GET/SET for these namespaces is `{ [key]: [entry] }`. Extra root keys
 * (diffuser `type`) and multi-row SETs stay at the call site.
 */
export function encodeArray(key: string, entry: Record<string, unknown>): MerossPayload {
    return { [key]: [entry] };
}

/**
 * GETACK/PUSH for these namespaces is a required array of objects. Fail closed
 * with ProtocolError so traits never see a non-list or a non-object row.
 */
export function decodeArray(
    payload: MerossPayload,
    key: string,
    label: string
): Record<string, unknown>[] {
    const raw = payload[key];
    if (!Array.isArray(raw)) {
        throw new ProtocolError(`${label} payload must contain a ${key} array`);
    }
    return raw.map((item) => {
        if (typeof item !== 'object' || item === null) {
            throw new ProtocolError(`${label} entry must be an object`);
        }
        return item as Record<string, unknown>;
    });
}
