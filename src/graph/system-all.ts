import { ProtocolError } from '../errors';
import {
    decodeSystemFirmwareGetAck,
    decodeSystemHardwareGetAck,
    decodeSystemTimeGetAck,
    type SystemFirmwareState,
    type SystemHardwareState,
    type SystemTimeState
} from '../protocol/codecs/system';
import type { MerossPayload } from '../protocol/message';

export const SYSTEM_ALL_NAMESPACE = 'Appliance.System.All';

/** One `digest.togglex` row. `on` is omitted when firmware leaves `onoff` out. */
export interface DigestToggle {
    channel: number;
    on?: boolean;
}

export interface SystemAll {
    hardware: SystemHardwareState;
    firmware: SystemFirmwareState;
    time?: SystemTimeState;
    online: {
        status: number;
    };
    digest: {
        togglex: DigestToggle[];
        light: number[];
        garageDoor: number[];
        rollerShutter: number[];
        spray: number[];
        fan: number[];
        diffuser?: { light: number[]; spray: number[] };
        hub?: { subdevice: Array<{ id: string; status?: number; model?: string; on?: boolean }> };
        thermostat?: unknown;
    };
}

/**
 * Firmware GETACK: `all.system` is shared; `all.digest` varies by product.
 */
export function decodeSystemAllGetAck(payload: MerossPayload): SystemAll {
    const all = payload.all;
    if (typeof all !== 'object' || all === null || Array.isArray(all)) {
        throw new ProtocolError('System.All GETACK all must be an object');
    }
    const { system, digest } = all as Record<string, unknown>;
    if (typeof system !== 'object' || system === null || Array.isArray(system)) {
        throw new ProtocolError('System.All GETACK system must be an object');
    }
    if (typeof digest !== 'object' || digest === null || Array.isArray(digest)) {
        throw new ProtocolError('System.All GETACK digest must be an object');
    }

    const { hardware, firmware, online, time } = system as Record<string, unknown>;
    if (typeof hardware !== 'object' || hardware === null || Array.isArray(hardware)) {
        throw new ProtocolError('System.All hardware must be an object');
    }
    if (typeof online !== 'object' || online === null) {
        throw new ProtocolError('System.All online must be an object');
    }
    const { status } = online as Record<string, unknown>;
    if (typeof status !== 'number') {
        throw new ProtocolError('System.All online.status is required');
    }

    const d = digest as Record<string, unknown>;
    return {
        hardware: decodeSystemHardwareGetAck({ hardware }),
        firmware: firmware && typeof firmware === 'object' && !Array.isArray(firmware)
            ? decodeSystemFirmwareGetAck({ firmware })
            : {},
        time: time !== undefined ? decodeSystemTimeGetAck({ time }) : undefined,
        online: { status },
        digest: {
            togglex: digestTogglex(d.togglex),
            light: channelList(d.light, 'light'),
            garageDoor: channelList(d.garageDoor, 'garageDoor'),
            rollerShutter: channelList(d.rollerShutter, 'rollerShutter'),
            spray: channelList(d.spray, 'spray'),
            fan: channelList(d.fan, 'fan'),
            diffuser: d.diffuser !== undefined ? decodeDiffuser(d.diffuser) : undefined,
            hub: d.hub !== undefined ? decodeHub(d.hub) : undefined,
            thermostat: d.thermostat && typeof d.thermostat === 'object' ? d.thermostat : undefined
        }
    };
}

function digestTogglex(raw: unknown): DigestToggle[] {
    if (raw === undefined) {
        return [];
    }
    if (!Array.isArray(raw)) {
        throw new ProtocolError('System.All digest.togglex must be an array');
    }
    return raw.map((item) => {
        const { channel, onoff } = item as Record<string, unknown>;
        if (typeof channel !== 'number') {
            throw new ProtocolError('System.All digest.togglex channel is required');
        }
        const entry: DigestToggle = { channel };
        if (typeof onoff === 'number') {
            entry.on = onoff === 1;
        }
        return entry;
    });
}

function channelList(raw: unknown, field: string): number[] {
    if (raw === undefined) {
        return [];
    }
    if (!Array.isArray(raw)) {
        throw new ProtocolError(`System.All digest.${field} must be an array`);
    }
    return raw.map((item) => {
        const channel = (item as { channel?: unknown })?.channel;
        if (typeof channel !== 'number') {
            throw new ProtocolError(`System.All digest.${field} channel is required`);
        }
        return channel;
    });
}

function decodeDiffuser(raw: unknown): { light: number[]; spray: number[] } {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new ProtocolError('System.All digest.diffuser must be an object');
    }
    const entry = raw as Record<string, unknown>;
    return {
        light: channelList(entry.light, 'diffuser.light'),
        spray: channelList(entry.spray, 'diffuser.spray')
    };
}

function decodeHub(raw: unknown): {
    subdevice: Array<{ id: string; status?: number; model?: string; on?: boolean }>;
} {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new ProtocolError('System.All digest.hub must be an object');
    }
    const { subdevice } = raw as { subdevice?: unknown };
    if (subdevice === undefined) {
        return { subdevice: [] };
    }
    if (!Array.isArray(subdevice)) {
        throw new ProtocolError('System.All digest.hub.subdevice must be an array');
    }
    return { subdevice: subdevice.map(decodeHubSubdevice) };
}

function decodeHubSubdevice(raw: unknown): { id: string; status?: number; model?: string; on?: boolean } {
    if (typeof raw !== 'object' || raw === null) {
        throw new ProtocolError('System.All hub subdevice must be an object');
    }
    const entry = raw as Record<string, unknown>;
    if (typeof entry.id !== 'string' || !entry.id) {
        throw new ProtocolError('System.All hub subdevice id is required');
    }
    const sub: { id: string; status?: number; model?: string; on?: boolean } = { id: entry.id };
    if (typeof entry.status === 'number') {
        sub.status = entry.status;
    }
    if (typeof entry.onoff === 'number') {
        sub.on = entry.onoff === 1;
    }
    if (typeof entry.type === 'string' && entry.type) {
        sub.model = entry.type;
    }
    for (const [key, value] of Object.entries(entry)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            sub.model = key;
            break;
        }
    }
    return sub;
}
