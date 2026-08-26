import { ProtocolError } from '../../errors';
import type { MerossPayload } from '../message';

export const SYSTEM_TIME_NAMESPACE = 'Appliance.System.Time';
export const SYSTEM_CLOCK_NAMESPACE = 'Appliance.System.Clock';
export const SYSTEM_FIRMWARE_NAMESPACE = 'Appliance.System.Firmware';
export const SYSTEM_HARDWARE_NAMESPACE = 'Appliance.System.Hardware';
export const SYSTEM_DEBUG_NAMESPACE = 'Appliance.System.Debug';
export const SYSTEM_POSITION_NAMESPACE = 'Appliance.System.Position';

/**
 * One DST rule: `[switchTime, utcOffsetSeconds, isDst]`.
 * `isDst` is 0 (standard) or 1 (daylight).
 */
export type SystemTimeRule = [number, number, number];

export interface SystemTimeState {
    timestamp: number;
    timezone: string;
    timeRule: SystemTimeRule[];
}

export interface SystemTimeSetOptions {
    timezone: string;
    timeRule: SystemTimeRule[];
    /** When omitted, firmware keeps time from System.Clock / NTP. */
    timestamp?: number;
}

/**
 * Same object as `system.firmware` in System.All. meross_lan reads this dict
 * with `.get()` because boards omit fields the firmware table marks required.
 */
export interface SystemFirmwareState {
    version?: string;
    compileTime?: string;
    wifiMac?: string;
    innerIp?: string;
    server?: string;
    port?: number;
    userId?: number;
    homekitVersion?: string;
    encrypt?: number;
}

/**
 * Same object as `system.hardware` in System.All. `type` and `uuid` are the
 * enrollment identity; the rest is omitted when firmware leaves it out.
 */
export interface SystemHardwareState {
    type: string;
    subType?: string;
    version?: string;
    chipType?: string;
    uuid: string;
    macAddress?: string;
}

/**
 * Inner keys shift between builds (firmware Debug note). `homeKit` is optional
 * on the wire; meross_lan keeps the whole debug object.
 */
export interface SystemDebugState {
    system?: Record<string, unknown>;
    network?: Record<string, unknown>;
    cloud?: Record<string, unknown>;
    homeKit?: Record<string, unknown>;
}

export interface SystemPositionState {
    latitude: number;
    longitude: number;
}

export interface SystemClockState {
    timestamp: number;
}

/** GET is empty. */
export function encodeSystemTimeGet(): MerossPayload {
    return {};
}

/** SET `{ time: { timezone, timeRule, timestamp? } }`. */
export function encodeSystemTimeSet(options: SystemTimeSetOptions): MerossPayload {
    const time: Record<string, unknown> = {
        timezone: options.timezone,
        timeRule: options.timeRule
    };
    if (options.timestamp !== undefined) {
        time.timestamp = options.timestamp;
    }
    return { time };
}

export function decodeSystemTimeGetAck(payload: MerossPayload): SystemTimeState {
    return decodeSystemTime(payload);
}

export function decodeSystemTimePush(payload: MerossPayload): SystemTimeState {
    return decodeSystemTime(payload);
}

function decodeSystemTime(payload: MerossPayload): SystemTimeState {
    const raw = payload.time;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new ProtocolError('System.Time time must be an object');
    }
    const { timestamp, timezone, timeRule } = raw as Record<string, unknown>;
    if (typeof timestamp !== 'number') {
        throw new ProtocolError('System.Time timestamp is required');
    }
    if (typeof timezone !== 'string') {
        throw new ProtocolError('System.Time timezone is required');
    }
    if (!Array.isArray(timeRule)) {
        throw new ProtocolError('System.Time timeRule must be an array');
    }
    return {
        timestamp,
        timezone,
        timeRule: timeRule.map(decodeTimeRule)
    };
}

function decodeTimeRule(item: unknown): SystemTimeRule {
    if (!Array.isArray(item) || item.length < 3) {
        throw new ProtocolError('System.Time timeRule entry must be a 3-tuple');
    }
    const [switchTime, utcOffsetSeconds, isDst] = item;
    if (
        typeof switchTime !== 'number'
        || typeof utcOffsetSeconds !== 'number'
        || typeof isDst !== 'number'
    ) {
        throw new ProtocolError('System.Time timeRule entry must be numeric');
    }
    return [switchTime, utcOffsetSeconds, isDst];
}

/**
 * Device→broker clock sync; the SDK only observes these for skew reporting.
 */
export function decodeSystemClockPush(payload: MerossPayload): SystemClockState {
    const raw = payload.clock;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new ProtocolError('System.Clock clock must be an object');
    }
    const { timestamp } = raw as Record<string, unknown>;
    if (typeof timestamp !== 'number') {
        throw new ProtocolError('System.Clock timestamp is required');
    }
    return { timestamp };
}

/** GET is empty. */
export function encodeSystemFirmwareGet(): MerossPayload {
    return {};
}

export function decodeSystemFirmwareGetAck(payload: MerossPayload): SystemFirmwareState {
    return decodeSystemFirmware(payload);
}

export function decodeSystemFirmwarePush(payload: MerossPayload): SystemFirmwareState {
    return decodeSystemFirmware(payload);
}

function decodeSystemFirmware(payload: MerossPayload): SystemFirmwareState {
    const raw = payload.firmware;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new ProtocolError('System.Firmware firmware must be an object');
    }
    return parseFirmware(raw as Record<string, unknown>);
}

/** Shared with System.All: same firmware object, missing keys stay absent. */
function parseFirmware(raw: Record<string, unknown>): SystemFirmwareState {
    const state: SystemFirmwareState = {};
    if (typeof raw.version === 'string') {
        state.version = raw.version;
    }
    if (typeof raw.compileTime === 'string') {
        state.compileTime = raw.compileTime;
    }
    if (typeof raw.wifiMac === 'string') {
        state.wifiMac = raw.wifiMac;
    }
    if (typeof raw.innerIp === 'string') {
        state.innerIp = raw.innerIp;
    }
    if (typeof raw.server === 'string') {
        state.server = raw.server;
    }
    if (typeof raw.port === 'number') {
        state.port = raw.port;
    }
    if (typeof raw.userId === 'number') {
        state.userId = raw.userId;
    }
    if (typeof raw.homekitVersion === 'string') {
        state.homekitVersion = raw.homekitVersion;
    }
    if (typeof raw.encrypt === 'number') {
        state.encrypt = raw.encrypt;
    }
    return state;
}

/** GET is empty. */
export function encodeSystemHardwareGet(): MerossPayload {
    return {};
}

export function decodeSystemHardwareGetAck(payload: MerossPayload): SystemHardwareState {
    const raw = payload.hardware;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new ProtocolError('System.Hardware hardware must be an object');
    }
    return parseHardware(raw as Record<string, unknown>);
}

/** Shared with System.All: same hardware object. */
function parseHardware(raw: Record<string, unknown>): SystemHardwareState {
    const { type, uuid, subType, version, chipType, macAddress } = raw;
    if (typeof type !== 'string' || !type) {
        throw new ProtocolError('System.Hardware type is required');
    }
    if (typeof uuid !== 'string' || !uuid) {
        throw new ProtocolError('System.Hardware uuid is required');
    }
    const state: SystemHardwareState = { type, uuid };
    if (typeof subType === 'string') {
        state.subType = subType;
    }
    if (typeof version === 'string') {
        state.version = version;
    }
    if (typeof chipType === 'string') {
        state.chipType = chipType;
    }
    if (typeof macAddress === 'string') {
        state.macAddress = macAddress;
    }
    return state;
}

/** GET is empty. */
export function encodeSystemDebugGet(): MerossPayload {
    return {};
}

/**
 * Keeps `system` / `network` / `cloud` / `homeKit` when present as objects.
 * Field names inside those subtrees shift between firmware builds.
 */
export function decodeSystemDebugGetAck(payload: MerossPayload): SystemDebugState {
    const raw = payload.debug;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new ProtocolError('System.Debug debug must be an object');
    }
    const entry = raw as Record<string, unknown>;
    const state: SystemDebugState = {};
    if (isPlainObject(entry.system)) {
        state.system = entry.system as Record<string, unknown>;
    }
    if (isPlainObject(entry.network)) {
        state.network = entry.network as Record<string, unknown>;
    }
    if (isPlainObject(entry.cloud)) {
        state.cloud = entry.cloud as Record<string, unknown>;
    }
    if (isPlainObject(entry.homeKit)) {
        state.homeKit = entry.homeKit as Record<string, unknown>;
    }
    return state;
}

/** GET is empty. */
export function encodeSystemPositionGet(): MerossPayload {
    return {};
}

/** SET `{ position: { latitude, longitude } }`. */
export function encodeSystemPositionSet(options: SystemPositionState): MerossPayload {
    return {
        position: {
            latitude: options.latitude,
            longitude: options.longitude
        }
    };
}

export function decodeSystemPositionGetAck(payload: MerossPayload): SystemPositionState {
    const raw = payload.position;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new ProtocolError('System.Position position must be an object');
    }
    const { latitude, longitude } = raw as Record<string, unknown>;
    if (typeof latitude !== 'number') {
        throw new ProtocolError('System.Position latitude is required');
    }
    if (typeof longitude !== 'number') {
        throw new ProtocolError('System.Position longitude is required');
    }
    return { latitude, longitude };
}

function isPlainObject(value: unknown): boolean {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
