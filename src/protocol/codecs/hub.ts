/**
 * Shared hub wire codecs used by switch, climate, sensor, and sprinkler.
 * Kept out of climate/sensor so a plug enroll does not load those modules.
 */
import { ProtocolError } from '../../errors';
import type { MerossPayload } from '../message';
import {
    HUB_EXCEPTION_NAMESPACE,
    HUB_SUBDEVICE_VERSION_NAMESPACE,
    HUB_TOGGLEX_NAMESPACE
} from '../namespaces';
import { decodeArray, encodeArray } from './payload';

export {
    HUB_EXCEPTION_NAMESPACE,
    HUB_SUBDEVICE_VERSION_NAMESPACE,
    HUB_TOGGLEX_NAMESPACE
};

export interface HubSubdeviceGetOptions {
    id: string;
}

export interface HubToggleXSetOptions {
    id: string;
    on: boolean;
}

export interface HubExceptionState {
    id: string;
    code: number;
}

export interface HubSubDeviceVersionState {
    id: string;
    firmware?: string;
    hardware?: string;
}

export function encodeHubToggleXSet(options: HubToggleXSetOptions): MerossPayload {
    return encodeArray('togglex', { id: options.id, onoff: options.on ? 1 : 0 });
}

export function encodeHubToggleXGet(options: HubSubdeviceGetOptions): MerossPayload {
    return encodeArray('togglex', { id: options.id });
}

export function decodeHubToggleXGetAck(payload: MerossPayload): Array<{ id: string; on: boolean }> {
    return decodeHubToggleX(payload);
}

export function decodeHubToggleXPush(payload: MerossPayload): Array<{ id: string; on: boolean }> {
    return decodeHubToggleX(payload);
}

function decodeHubToggleX(payload: MerossPayload): Array<{ id: string; on: boolean }> {
    return decodeArray(payload, 'togglex', 'Hub.ToggleX').map((item) => {
        if (typeof item.id !== 'string' || typeof item.onoff !== 'number') {
            throw new ProtocolError('Hub.ToggleX entry requires id and onoff');
        }
        return { id: item.id, on: item.onoff === 1 };
    });
}

/**
 * Hub.Exception is PUSH-only. Rows without a numeric `code` are omitted the
 * same way Hub.Online omits unknown-id rows that lack `status`.
 */
export function decodeHubExceptionPush(payload: MerossPayload): HubExceptionState[] {
    const entries: HubExceptionState[] = [];
    for (const item of decodeArray(payload, 'exception', 'Hub.Exception')) {
        const id = requireId(item.id, 'Hub.Exception');
        if (typeof item.code === 'number') {
            entries.push({ id, code: item.code });
        }
    }
    return entries;
}

export function encodeHubSubDeviceVersionGet(id: string): MerossPayload {
    return encodeArray('version', { id });
}

export function decodeHubSubDeviceVersionGetAck(payload: MerossPayload): HubSubDeviceVersionState[] {
    return decodeHubSubDeviceVersion(payload);
}

export function decodeHubSubDeviceVersionPush(payload: MerossPayload): HubSubDeviceVersionState[] {
    return decodeHubSubDeviceVersion(payload);
}

/**
 * GETACK can include a row with `exception.code` 5062 and no firmware when the
 * id is unknown to the hub. Those rows are omitted so they are not treated as
 * empty versions, matching Hub.Online.
 */
function decodeHubSubDeviceVersion(payload: MerossPayload): HubSubDeviceVersionState[] {
    const entries: HubSubDeviceVersionState[] = [];
    for (const item of decodeArray(payload, 'version', 'Hub.SubDevice.Version')) {
        const id = requireId(item.id, 'Hub.SubDevice.Version');
        const result: HubSubDeviceVersionState = { id };
        if (typeof item.firmware === 'string') {
            result.firmware = item.firmware;
        }
        if (typeof item.hardware === 'string') {
            result.hardware = item.hardware;
        }
        if (result.firmware !== undefined || result.hardware !== undefined) {
            entries.push(result);
        }
    }
    return entries;
}

function requireId(id: unknown, label: string): string {
    if (typeof id !== 'string') {
        throw new ProtocolError(`${label} id is required`);
    }
    return id;
}
