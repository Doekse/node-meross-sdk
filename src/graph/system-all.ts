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

/**
 * One `digest.garageDoor` row. Firmware reports the door's current state here,
 * so hosts can show open/closed immediately after System.All instead of waiting
 * for the first PUSH or poll. `doorEnable` is 0 on channels of a multi-door
 * board that are not wired up (MSG200 ships three; most installs use one or two).
 */
export interface DigestGarageDoor {
    channel: number;
    open?: boolean;
    doorEnable?: boolean;
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
        garageDoor: DigestGarageDoor[];
        rollerShutter: number[];
        spray: number[];
        fan: number[];
        diffuser?: { light: number[]; spray: number[] };
        hub?: { subdevice: Array<{ id: string; status?: number; model?: string; on?: boolean }> };
        thermostat?: {
            mode?: number[];
            modeB?: number[];
            summerMode?: number[];
            windowOpened?: number[];
        };
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
            garageDoor: digestGarageDoor(d.garageDoor),
            rollerShutter: channelList(d.rollerShutter, 'rollerShutter'),
            spray: channelList(d.spray, 'spray'),
            fan: channelList(d.fan, 'fan'),
            diffuser: d.diffuser !== undefined ? decodeDiffuser(d.diffuser) : undefined,
            hub: d.hub !== undefined ? decodeHub(d.hub) : undefined,
            thermostat: d.thermostat !== undefined ? decodeThermostat(d.thermostat) : undefined
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

function digestGarageDoor(raw: unknown): DigestGarageDoor[] {
    if (raw === undefined) {
        return [];
    }
    if (!Array.isArray(raw)) {
        throw new ProtocolError('System.All digest.garageDoor must be an array');
    }
    return raw.map((item) => {
        const { channel, open, doorEnable } = (item ?? {}) as Record<string, unknown>;
        if (typeof channel !== 'number') {
            throw new ProtocolError('System.All digest.garageDoor channel is required');
        }
        const row: DigestGarageDoor = { channel };
        if (typeof open === 'number') {
            row.open = open === 1;
        }
        if (typeof doorEnable === 'number') {
            row.doorEnable = doorEnable === 1;
        }
        return row;
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

/**
 * Typed keys so enrollment can treat Mode/ModeB/SummerMode/WindowOpened as
 * digest jobs instead of polling them beside System.All.
 */
function decodeThermostat(raw: unknown): NonNullable<SystemAll['digest']['thermostat']> {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new ProtocolError('System.All digest.thermostat must be an object');
    }
    const entry = raw as Record<string, unknown>;
    const thermostat: NonNullable<SystemAll['digest']['thermostat']> = {};
    if (entry.mode !== undefined) {
        thermostat.mode = channelList(entry.mode, 'thermostat.mode');
    }
    if (entry.modeB !== undefined) {
        thermostat.modeB = channelList(entry.modeB, 'thermostat.modeB');
    }
    if (entry.summerMode !== undefined) {
        thermostat.summerMode = channelList(entry.summerMode, 'thermostat.summerMode');
    }
    if (entry.windowOpened !== undefined) {
        thermostat.windowOpened = channelList(entry.windowOpened, 'thermostat.windowOpened');
    }
    return thermostat;
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
