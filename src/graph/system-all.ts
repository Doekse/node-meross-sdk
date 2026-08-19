import { ProtocolError } from '../errors';
import type { MerossPayload } from '../protocol/message';

export const SYSTEM_ALL_NAMESPACE = 'Appliance.System.All';

/** One `digest.togglex` row. `on` is omitted when firmware leaves `onoff` out. */
export interface DigestToggle {
    channel: number;
    on?: boolean;
}

export interface SystemAll {
    hardware: {
        type: string;
        uuid: string;
        macAddress?: string;
    };
    firmware: {
        innerIp?: string;
    };
    online: {
        status: number;
    };
    digest: {
        togglex: DigestToggle[];
        light: number[];
        garageDoor: number[];
        rollerShutter: number[];
        hub?: { subdevice: Array<{ id: string; status?: number; model?: string }> };
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

    const { hardware, firmware, online } = system as Record<string, unknown>;
    if (typeof hardware !== 'object' || hardware === null) {
        throw new ProtocolError('System.All hardware must be an object');
    }
    const { type, uuid, macAddress } = hardware as Record<string, unknown>;
    if (typeof type !== 'string' || typeof uuid !== 'string' || !uuid) {
        throw new ProtocolError('System.All hardware.type and hardware.uuid are required');
    }
    if (typeof online !== 'object' || online === null) {
        throw new ProtocolError('System.All online must be an object');
    }
    const { status } = online as Record<string, unknown>;
    if (typeof status !== 'number') {
        throw new ProtocolError('System.All online.status is required');
    }

    const innerIp = firmware && typeof firmware === 'object'
        ? (firmware as { innerIp?: unknown }).innerIp
        : undefined;
    const d = digest as Record<string, unknown>;
    return {
        hardware: {
            type,
            uuid,
            macAddress: typeof macAddress === 'string' ? macAddress : undefined
        },
        firmware: {
            innerIp: typeof innerIp === 'string' ? innerIp : undefined
        },
        online: { status },
        digest: {
            togglex: digestTogglex(d.togglex),
            light: channelList(d.light, 'light'),
            garageDoor: channelList(d.garageDoor, 'garageDoor'),
            rollerShutter: channelList(d.rollerShutter, 'rollerShutter'),
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

function decodeHub(raw: unknown): { subdevice: Array<{ id: string; status?: number; model?: string }> } {
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

function decodeHubSubdevice(raw: unknown): { id: string; status?: number; model?: string } {
    if (typeof raw !== 'object' || raw === null) {
        throw new ProtocolError('System.All hub subdevice must be an object');
    }
    const entry = raw as Record<string, unknown>;
    if (typeof entry.id !== 'string' || !entry.id) {
        throw new ProtocolError('System.All hub subdevice id is required');
    }
    const sub: { id: string; status?: number; model?: string } = { id: entry.id };
    if (typeof entry.status === 'number') {
        sub.status = entry.status;
    }
    for (const [key, value] of Object.entries(entry)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            sub.model = key;
            break;
        }
    }
    return sub;
}
