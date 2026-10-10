import { ProtocolError } from '../../errors';
import type { MerossPayload } from '../message';
import {
    DIFFUSER_LIGHT_NAMESPACE,
    DIFFUSER_SPRAY_NAMESPACE,
    FAN_NAMESPACE,
    GARAGE_STATE_NAMESPACE,
    LIGHT_NAMESPACE,
    SPRAY_NAMESPACE,
    SUMMER_MODE_NAMESPACE,
    THERMOSTAT_MODE_NAMESPACE,
    THERMOSTAT_MODEB_NAMESPACE,
    TOGGLEX_NAMESPACE,
    WINDOW_OPENED_NAMESPACE
} from '../namespaces';
import {
    decodeSystemFirmwareGetAck,
    decodeSystemHardwareGetAck,
    decodeSystemTimeGetAck,
    type SystemFirmwareState,
    type SystemHardwareState,
    type SystemTimeState
} from './system';

export { SYSTEM_ALL_NAMESPACE } from '../namespaces';

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

/**
 * One `digest.light` row. Control.Light is not GETted beside All, so rgb /
 * luminance / temperature have to come from here or hosts wait for a PUSH.
 */
export interface DigestLight {
    channel: number;
    capacity?: number;
    rgb?: number;
    temperature?: number;
    luminance?: number;
    effect?: number;
    onoff?: boolean;
}

/** Wire `speed` / `maxSpeed`; FanTrait converts speed to host 0..1. */
export interface DigestFan {
    channel: number;
    speed?: number;
    maxSpeed?: number;
}

/** Wire `mode` 0/1/2; SprayTrait maps to off/continuous/intermittent. */
export interface DigestSpray {
    channel: number;
    mode?: number;
}

export interface DigestDiffuserLight {
    channel: number;
    onoff?: boolean;
    mode?: number;
    luminance?: number;
    rgb?: number;
}

export interface DigestDiffuserSpray {
    channel: number;
    mode?: number;
}

/**
 * One thermostat digest row. Field maps differ by Mode / ModeB / SummerMode /
 * WindowOpened; attach runs the matching climate decoder on the raw row.
 */
export interface DigestThermostatRow {
    channel: number;
    [key: string]: unknown;
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
        light: DigestLight[];
        garageDoor: DigestGarageDoor[];
        rollerShutter: number[];
        spray: DigestSpray[];
        fan: DigestFan[];
        diffuser?: { light: DigestDiffuserLight[]; spray: DigestDiffuserSpray[] };
        hub?: { subdevice: Array<{ id: string; status?: number; model?: string; on?: boolean }> };
        thermostat?: {
            mode?: DigestThermostatRow[];
            modeB?: DigestThermostatRow[];
            summerMode?: DigestThermostatRow[];
            windowOpened?: DigestThermostatRow[];
        };
    };
}

/**
 * Namespaces whose state is already in the System.All digest, so they GET
 * only when All is skipped, not beside it.
 *
 * Timer, trigger, hub, light.effect, and rollerShutter stay out: those digest
 * keys are empty, unused, or updated through RollerShutter.State instead.
 * Thermostat uses key presence, including empty lists. Other keys need at
 * least one row — an empty togglex list is not a poller.
 */
export function getDigestNamespaces(digest: SystemAll['digest']): Set<string> {
    const namespaces = new Set<string>();
    if (digest.togglex.length > 0) {
        namespaces.add(TOGGLEX_NAMESPACE);
    }
    if (digest.light.length > 0) {
        namespaces.add(LIGHT_NAMESPACE);
    }
    if (digest.garageDoor.length > 0) {
        namespaces.add(GARAGE_STATE_NAMESPACE);
    }
    if (digest.spray.length > 0) {
        namespaces.add(SPRAY_NAMESPACE);
    }
    if (digest.fan.length > 0) {
        namespaces.add(FAN_NAMESPACE);
    }
    if (digest.diffuser) {
        if (digest.diffuser.light.length > 0) {
            namespaces.add(DIFFUSER_LIGHT_NAMESPACE);
        }
        if (digest.diffuser.spray.length > 0) {
            namespaces.add(DIFFUSER_SPRAY_NAMESPACE);
        }
    }
    if (digest.thermostat) {
        if (digest.thermostat.mode !== undefined) {
            namespaces.add(THERMOSTAT_MODE_NAMESPACE);
        }
        if (digest.thermostat.modeB !== undefined) {
            namespaces.add(THERMOSTAT_MODEB_NAMESPACE);
        }
        if (digest.thermostat.summerMode !== undefined) {
            namespaces.add(SUMMER_MODE_NAMESPACE);
        }
        if (digest.thermostat.windowOpened !== undefined) {
            namespaces.add(WINDOW_OPENED_NAMESPACE);
        }
    }
    return namespaces;
}

/**
 * Successful projections only. Availability swallows a bad All; SystemTrait
 * must still throw that same payload into Endpoint `warning`. Keyed by
 * payload identity so Availability, SystemTrait, and a heartbeat
 * re-apply share one tree without keeping All on Runtime.
 */
const decodedAll = new WeakMap<MerossPayload, SystemAll>();

/**
 * Firmware GETACK: `all.system` is shared; `all.digest` varies by product.
 */
export function decodeSystemAllGetAck(payload: MerossPayload): SystemAll {
    const cached = decodedAll.get(payload);
    if (cached !== undefined) {
        return cached;
    }
    const projected = projectSystemAll(payload);
    decodedAll.set(payload, projected);
    return projected;
}

function projectSystemAll(payload: MerossPayload): SystemAll {
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
            light: digestLight(d.light),
            garageDoor: digestGarageDoor(d.garageDoor),
            rollerShutter: channelList(d.rollerShutter, 'rollerShutter'),
            spray: digestSpray(d.spray),
            fan: digestFan(d.fan),
            diffuser: d.diffuser !== undefined ? decodeDiffuser(d.diffuser) : undefined,
            hub: d.hub !== undefined ? decodeHub(d.hub) : undefined,
            thermostat: d.thermostat !== undefined ? decodeThermostat(d.thermostat) : undefined
        }
    };
}

type ChannelRecord = Record<string, unknown> & { channel: number };

/**
 * Firmware digest channel lists are one object (MSL430 light) or an array.
 * Channel is required on every row so enroll can claim it.
 */
function channelRows(raw: unknown, field: string): ChannelRecord[] {
    if (raw === undefined) {
        return [];
    }
    let items: unknown[];
    if (Array.isArray(raw)) {
        items = raw;
    } else if (typeof raw === 'object' && raw !== null) {
        items = [raw];
    } else {
        throw new ProtocolError(`System.All digest.${field} must be an object or array`);
    }
    return items.map((item) => channelRecord(item, field));
}

/**
 * Same error for a non-object and a missing channel: enroll cannot claim the row.
 */
function channelRecord(item: unknown, field: string): ChannelRecord {
    if (typeof item !== 'object' || item === null) {
        throw new ProtocolError(`System.All digest.${field} channel is required`);
    }
    const record = item as Record<string, unknown>;
    if (typeof record.channel !== 'number') {
        throw new ProtocolError(`System.All digest.${field} channel is required`);
    }
    return record as ChannelRecord;
}

function channelList(raw: unknown, field: string): number[] {
    return channelRows(raw, field).map((item) => item.channel);
}

function digestTogglex(raw: unknown): DigestToggle[] {
    return channelRows(raw, 'togglex').map((item) => {
        const entry: DigestToggle = { channel: item.channel };
        if (typeof item.onoff === 'number') {
            entry.on = item.onoff === 1;
        }
        return entry;
    });
}

function digestLight(raw: unknown): DigestLight[] {
    return channelRows(raw, 'light').map((item) => {
        const row: DigestLight = { channel: item.channel };
        if (typeof item.capacity === 'number') {
            row.capacity = item.capacity;
        }
        if (typeof item.rgb === 'number' && item.rgb !== -1) {
            row.rgb = item.rgb;
        }
        if (typeof item.temperature === 'number' && item.temperature !== -1) {
            row.temperature = item.temperature;
        }
        if (typeof item.luminance === 'number' && item.luminance !== -1) {
            row.luminance = item.luminance;
        }
        if (typeof item.effect === 'number' && item.effect !== -1) {
            row.effect = item.effect;
        }
        if (typeof item.onoff === 'number' && item.onoff !== -1) {
            row.onoff = item.onoff === 1;
        }
        return row;
    });
}

function digestGarageDoor(raw: unknown): DigestGarageDoor[] {
    return channelRows(raw, 'garageDoor').map((item) => {
        const row: DigestGarageDoor = { channel: item.channel };
        if (typeof item.open === 'number') {
            row.open = item.open === 1;
        }
        if (typeof item.doorEnable === 'number') {
            row.doorEnable = item.doorEnable === 1;
        }
        return row;
    });
}

function digestFan(raw: unknown): DigestFan[] {
    return channelRows(raw, 'fan').map((item) => {
        const row: DigestFan = { channel: item.channel };
        if (typeof item.speed === 'number') {
            row.speed = item.speed;
        }
        if (typeof item.maxSpeed === 'number') {
            row.maxSpeed = item.maxSpeed;
        }
        return row;
    });
}

function digestSpray(raw: unknown): DigestSpray[] {
    return channelRows(raw, 'spray').map((item) => {
        const row: DigestSpray = { channel: item.channel };
        if (typeof item.mode === 'number') {
            row.mode = item.mode;
        }
        return row;
    });
}

function digestDiffuserLight(raw: unknown): DigestDiffuserLight[] {
    return channelRows(raw, 'diffuser.light').map((item) => {
        const row: DigestDiffuserLight = { channel: item.channel };
        if (typeof item.onoff === 'number') {
            row.onoff = item.onoff === 1;
        }
        if (typeof item.mode === 'number') {
            row.mode = item.mode;
        }
        if (typeof item.luminance === 'number') {
            row.luminance = item.luminance;
        }
        if (typeof item.rgb === 'number') {
            row.rgb = item.rgb;
        }
        return row;
    });
}

function digestDiffuserSpray(raw: unknown): DigestDiffuserSpray[] {
    return channelRows(raw, 'diffuser.spray').map((item) => {
        const row: DigestDiffuserSpray = { channel: item.channel };
        if (typeof item.mode === 'number') {
            row.mode = item.mode;
        }
        return row;
    });
}

function decodeDiffuser(raw: unknown): { light: DigestDiffuserLight[]; spray: DigestDiffuserSpray[] } {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new ProtocolError('System.All digest.diffuser must be an object');
    }
    const entry = raw as Record<string, unknown>;
    return {
        light: digestDiffuserLight(entry.light),
        spray: digestDiffuserSpray(entry.spray)
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
        thermostat.mode = channelRows(entry.mode, 'thermostat.mode');
    }
    if (entry.modeB !== undefined) {
        thermostat.modeB = channelRows(entry.modeB, 'thermostat.modeB');
    }
    if (entry.summerMode !== undefined) {
        thermostat.summerMode = channelRows(entry.summerMode, 'thermostat.summerMode');
    }
    if (entry.windowOpened !== undefined) {
        thermostat.windowOpened = channelRows(entry.windowOpened, 'thermostat.windowOpened');
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
