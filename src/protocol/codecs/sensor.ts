import { ProtocolError } from '../../errors';
import type { MerossPayload } from '../message';

export const HUB_SENSOR_TEMPHUM_NAMESPACE = 'Appliance.Hub.Sensor.TempHum';
export const HUB_SENSOR_DOORWINDOW_NAMESPACE = 'Appliance.Hub.Sensor.DoorWindow';
export const HUB_SENSOR_WATERLEAK_NAMESPACE = 'Appliance.Hub.Sensor.WaterLeak';
export const HUB_SENSOR_SMOKE_NAMESPACE = 'Appliance.Hub.Sensor.Smoke';
export const HUB_SENSOR_ADJUST_NAMESPACE = 'Appliance.Hub.Sensor.Adjust';
export const HUB_SENSOR_ALERT_NAMESPACE = 'Appliance.Hub.Sensor.Alert';
export const HUB_SENSOR_ALL_NAMESPACE = 'Appliance.Hub.Sensor.All';
export const HUB_BATTERY_NAMESPACE = 'Appliance.Hub.Battery';
export const SENSOR_LATESTX_NAMESPACE = 'Appliance.Control.Sensor.LatestX';
export const SENSOR_LATEST_NAMESPACE = 'Appliance.Control.Sensor.Latest';
export const SENSOR_HISTORY_NAMESPACE = 'Appliance.Control.Sensor.History';
export const SMOKE_CONFIG_NAMESPACE = 'Appliance.Control.Smoke.Config';

export interface SensorTempHumState {
    id: string;
    temperature?: number;
    humidity?: number;
}

export interface SensorDoorWindowState {
    id: string;
    open: boolean;
}

export interface SensorWaterLeakState {
    id: string;
    leak: boolean;
}

export interface SensorSmokeState {
    id: string;
    status: number;
    interConn?: number;
}

export interface SensorBatteryState {
    id: string;
    battery?: number;
}

export interface SensorAdjustState {
    id: string;
    temperature?: number;
    humidity?: number;
}

export interface SensorAlertBand {
    enabled: boolean;
    active: boolean;
    low: number;
    high: number;
}

export interface SensorAlertState {
    id: string;
    temperature?: SensorAlertBand[];
    humidity?: SensorAlertBand[];
}

export interface SensorAllState {
    id: string;
    temperature?: number;
    humidity?: number;
    leak?: boolean;
    open?: boolean;
    smoke?: SensorSmokeState;
}

export interface LatestXState {
    channel: number;
    subId?: string;
    temperature?: number;
    humidity?: number;
    light?: number;
    present?: boolean;
    /** Distance in meters. */
    distance?: number;
    times?: number;
}

export interface SmokeConfigState {
    channel: number;
    subId?: string;
    dndEnabled?: boolean;
    detectEnabled?: boolean;
}

export interface SensorAdjustSetOptions {
    id: string;
    temperature?: number;
    humidity?: number;
}

export interface SensorAlertSetOptions {
    id: string;
    temperature?: SensorAlertBand[];
    humidity?: SensorAlertBand[];
}

export interface SensorSmokeSetOptions {
    id: string;
    status: number;
}

export interface LatestXGetOptions {
    channel: number;
    subId?: string;
    keys: string[];
}

export interface SensorLatestState {
    channel: number;
    capacity?: number;
    timestamp?: number;
    temperature?: number;
    humidity?: number;
    light?: number;
}

export interface SensorHistorySample {
    timestamp?: number;
    temperature?: number;
    humidity?: number;
}

export interface SensorHistoryState {
    channel: number;
    capacity?: number;
    samples: SensorHistorySample[];
}

export interface SensorHistoryGetOptions {
    channel: number;
    capacity?: number;
}

export interface SmokeConfigGetOptions {
    channel: number;
    subId?: string;
}

export interface SmokeConfigSetOptions {
    channel: number;
    subId?: string;
    dndEnabled?: boolean;
    detectEnabled?: boolean;
}

function encodeArray(key: string, entry: Record<string, unknown>): MerossPayload {
    return { [key]: [entry] };
}

function decodeArray(payload: MerossPayload, key: string, label: string): Record<string, unknown>[] {
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

function encodeIdGet(key: string, id: string): MerossPayload {
    return encodeArray(key, { id });
}

function requireId(id: unknown, label: string): string {
    if (typeof id !== 'string') {
        throw new ProtocolError(`${label} id is required`);
    }
    return id;
}

/**
 * Hub temps are ×10 (MS100) or ×100 (MS130 / LatestX). Readings above 100 °C
 * in ×10 units do not occur, so values over 1000 are ×100.
 */
function scaleHubTemperature(raw: number): number {
    return raw > 1000 ? raw / 100 : raw / 10;
}

export function encodeSensorTempHumGet(id: string): MerossPayload {
    return encodeIdGet('tempHum', id);
}

export function decodeSensorTempHumGetAck(payload: MerossPayload): SensorTempHumState[] {
    return decodeTempHum(payload);
}

export function decodeSensorTempHumPush(payload: MerossPayload): SensorTempHumState[] {
    return decodeTempHum(payload);
}

function decodeTempHum(payload: MerossPayload): SensorTempHumState[] {
    return decodeArray(payload, 'tempHum', 'Hub.Sensor.TempHum').map((item) => {
        const result: SensorTempHumState = { id: requireId(item.id, 'Hub.Sensor.TempHum') };
        if (typeof item.latestTemperature === 'number') {
            result.temperature = scaleHubTemperature(item.latestTemperature);
        }
        if (typeof item.latestHumidity === 'number') {
            result.humidity = item.latestHumidity / 10;
        }
        return result;
    });
}

export function encodeSensorDoorWindowGet(id: string): MerossPayload {
    return encodeIdGet('doorWindow', id);
}

export function decodeSensorDoorWindowGetAck(payload: MerossPayload): SensorDoorWindowState[] {
    return decodeDoorWindow(payload);
}

export function decodeSensorDoorWindowPush(payload: MerossPayload): SensorDoorWindowState[] {
    return decodeDoorWindow(payload);
}

function decodeDoorWindow(payload: MerossPayload): SensorDoorWindowState[] {
    return decodeArray(payload, 'doorWindow', 'Hub.Sensor.DoorWindow').map((item) => {
        const id = requireId(item.id, 'Hub.Sensor.DoorWindow');
        if (typeof item.status !== 'number') {
            throw new ProtocolError('Hub.Sensor.DoorWindow status is required');
        }
        return { id, open: item.status === 1 };
    });
}

export function encodeSensorWaterLeakGet(id: string): MerossPayload {
    return encodeIdGet('waterLeak', id);
}

export function decodeSensorWaterLeakGetAck(payload: MerossPayload): SensorWaterLeakState[] {
    return decodeWaterLeak(payload);
}

export function decodeSensorWaterLeakPush(payload: MerossPayload): SensorWaterLeakState[] {
    return decodeWaterLeak(payload);
}

function decodeWaterLeak(payload: MerossPayload): SensorWaterLeakState[] {
    return decodeArray(payload, 'waterLeak', 'Hub.Sensor.WaterLeak').map((item) => {
        const id = requireId(item.id, 'Hub.Sensor.WaterLeak');
        if (typeof item.latestWaterLeak !== 'number') {
            throw new ProtocolError('Hub.Sensor.WaterLeak latestWaterLeak is required');
        }
        return { id, leak: item.latestWaterLeak !== 0 };
    });
}

export function encodeSensorSmokeGet(id: string): MerossPayload {
    return encodeIdGet('smokeAlarm', id);
}

export function encodeSensorSmokeSet(options: SensorSmokeSetOptions): MerossPayload {
    return encodeArray('smokeAlarm', { id: options.id, status: options.status });
}

export function decodeSensorSmokeGetAck(payload: MerossPayload): SensorSmokeState[] {
    return decodeSmoke(payload);
}

export function decodeSensorSmokePush(payload: MerossPayload): SensorSmokeState[] {
    return decodeSmoke(payload);
}

function decodeSmoke(payload: MerossPayload): SensorSmokeState[] {
    return decodeArray(payload, 'smokeAlarm', 'Hub.Sensor.Smoke').map(decodeSmokeEntry);
}

function decodeSmokeEntry(item: Record<string, unknown>): SensorSmokeState {
    const id = requireId(item.id, 'Hub.Sensor.Smoke');
    if (typeof item.status !== 'number') {
        throw new ProtocolError('Hub.Sensor.Smoke status is required');
    }
    const result: SensorSmokeState = { id, status: item.status };
    if (typeof item.interConn === 'number') {
        result.interConn = item.interConn;
    }
    return result;
}

export function encodeBatteryGet(id: string): MerossPayload {
    return encodeIdGet('battery', id);
}

export function decodeBatteryGetAck(payload: MerossPayload): SensorBatteryState[] {
    return decodeBattery(payload);
}

export function decodeBatteryPush(payload: MerossPayload): SensorBatteryState[] {
    return decodeBattery(payload);
}

function decodeBattery(payload: MerossPayload): SensorBatteryState[] {
    return decodeArray(payload, 'battery', 'Hub.Battery').map((item) => {
        const result: SensorBatteryState = { id: requireId(item.id, 'Hub.Battery') };
        if (typeof item.value === 'number' && item.value !== 0xFFFFFFFF) {
            result.battery = item.value;
        }
        return result;
    });
}

export function encodeSensorAdjustGet(id: string): MerossPayload {
    return encodeIdGet('adjust', id);
}

export function encodeSensorAdjustSet(options: SensorAdjustSetOptions): MerossPayload {
    const entry: Record<string, unknown> = { id: options.id };
    if (options.temperature !== undefined) {
        entry.temperature = Math.round(options.temperature * 10);
    }
    if (options.humidity !== undefined) {
        entry.humidity = Math.round(options.humidity * 10);
    }
    return encodeArray('adjust', entry);
}

export function decodeSensorAdjustGetAck(payload: MerossPayload): SensorAdjustState[] {
    return decodeAdjust(payload);
}

export function decodeSensorAdjustPush(payload: MerossPayload): SensorAdjustState[] {
    return decodeAdjust(payload);
}

function decodeAdjust(payload: MerossPayload): SensorAdjustState[] {
    return decodeArray(payload, 'adjust', 'Hub.Sensor.Adjust').map((item) => {
        const result: SensorAdjustState = { id: requireId(item.id, 'Hub.Sensor.Adjust') };
        if (typeof item.temperature === 'number') {
            result.temperature = item.temperature / 10;
        }
        if (typeof item.humidity === 'number') {
            result.humidity = item.humidity / 10;
        }
        return result;
    });
}

export function encodeSensorAlertGet(id: string): MerossPayload {
    return encodeIdGet('alert', id);
}

export function encodeSensorAlertSet(options: SensorAlertSetOptions): MerossPayload {
    const entry: Record<string, unknown> = { id: options.id };
    if (options.temperature) {
        entry.temperature = options.temperature.map(encodeAlertBand);
    }
    if (options.humidity) {
        entry.humidity = options.humidity.map(encodeAlertBand);
    }
    return encodeArray('alert', entry);
}

export function decodeSensorAlertGetAck(payload: MerossPayload): SensorAlertState[] {
    return decodeAlert(payload);
}

export function decodeSensorAlertPush(payload: MerossPayload): SensorAlertState[] {
    return decodeAlert(payload);
}

function decodeAlert(payload: MerossPayload): SensorAlertState[] {
    return decodeArray(payload, 'alert', 'Hub.Sensor.Alert').map((item) => {
        const result: SensorAlertState = { id: requireId(item.id, 'Hub.Sensor.Alert') };
        const temperature = decodeAlertBands(item.temperature);
        const humidity = decodeAlertBands(item.humidity);
        if (temperature) result.temperature = temperature;
        if (humidity) result.humidity = humidity;
        return result;
    });
}

function encodeAlertBand(band: SensorAlertBand): [number, number, number] {
    return [band.enabled ? 1 : 0, Math.round(band.low * 10), Math.round(band.high * 10)];
}

function decodeAlertBands(raw: unknown): SensorAlertBand[] | undefined {
    if (!Array.isArray(raw)) {
        return undefined;
    }
    return raw.map((row) => {
        if (!Array.isArray(row) || typeof row[0] !== 'number' || typeof row[1] !== 'number' || typeof row[2] !== 'number') {
            throw new ProtocolError('Hub.Sensor.Alert band must be [status, low, high]');
        }
        return {
            enabled: row[0] !== 0,
            active: row[0] === 2,
            low: row[1] / 10,
            high: row[2] / 10
        };
    });
}

export function encodeSensorAllGet(id: string): MerossPayload {
    return encodeIdGet('all', id);
}

export function decodeSensorAllGetAck(payload: MerossPayload): SensorAllState[] {
    return decodeSensorAll(payload);
}

export function decodeSensorAllPush(payload: MerossPayload): SensorAllState[] {
    return decodeSensorAll(payload);
}

function decodeSensorAll(payload: MerossPayload): SensorAllState[] {
    return decodeArray(payload, 'all', 'Hub.Sensor.All').map((item) => {
        const result: SensorAllState = { id: requireId(item.id, 'Hub.Sensor.All') };
        const temperature = nestedNumber(item.temperature, 'latest');
        const humidity = nestedNumber(item.humidity, 'latest');
        if (temperature !== undefined) result.temperature = scaleHubTemperature(temperature);
        if (humidity !== undefined) result.humidity = humidity / 10;
        const leak = nestedNumber(item.waterLeak, 'latestWaterLeak');
        if (leak !== undefined) result.leak = leak !== 0;
        const door = nestedNumber(item.doorWindow, 'status');
        if (door !== undefined) result.open = door === 1;
        if (typeof item.smokeAlarm === 'object' && item.smokeAlarm !== null) {
            const smoke = item.smokeAlarm as Record<string, unknown>;
            result.smoke = decodeSmokeEntry({ ...smoke, id: item.id });
        }
        return result;
    });
}

function nestedNumber(raw: unknown, key: string): number | undefined {
    if (typeof raw !== 'object' || raw === null) {
        return undefined;
    }
    const value = (raw as Record<string, unknown>)[key];
    return typeof value === 'number' ? value : undefined;
}

export function encodeLatestXGet(options: LatestXGetOptions): MerossPayload {
    const entry: Record<string, unknown> = { channel: options.channel, data: options.keys };
    if (options.subId) {
        entry.subId = options.subId;
    }
    return encodeArray('latest', entry);
}

export function decodeLatestXGetAck(payload: MerossPayload): LatestXState[] {
    return decodeLatestX(payload);
}

export function decodeLatestXPush(payload: MerossPayload): LatestXState[] {
    return decodeLatestX(payload);
}

function decodeLatestX(payload: MerossPayload): LatestXState[] {
    return decodeArray(payload, 'latest', 'Control.Sensor.LatestX').map((item) => {
        const channel = typeof item.channel === 'number' ? item.channel : 0;
        const result: LatestXState = { channel };
        if (typeof item.subId === 'string') {
            result.subId = item.subId;
        }
        const data = item.data;
        if (typeof data !== 'object' || data === null || Array.isArray(data)) {
            return result;
        }
        const block = data as Record<string, unknown>;
        const temperature = latestValue(block.temp);
        const humidity = latestValue(block.humi);
        const light = latestValue(block.light);
        if (temperature !== undefined) result.temperature = scaleHubTemperature(temperature);
        if (humidity !== undefined) result.humidity = humidity / 10;
        if (light !== undefined) result.light = light;
        const presence = latestObject(block.presence);
        if (presence) {
            if (typeof presence.value === 'number') {
                result.present = presence.value === 2;
            }
            if (typeof presence.distance === 'number') {
                result.distance = presence.distance / 1000;
            }
            if (typeof presence.times === 'number') {
                result.times = presence.times;
            }
        }
        return result;
    });
}

function latestValue(raw: unknown): number | undefined {
    const entry = latestObject(raw);
    return entry && typeof entry.value === 'number' ? entry.value : undefined;
}

function latestObject(raw: unknown): Record<string, unknown> | undefined {
    if (!Array.isArray(raw) || raw.length === 0 || typeof raw[0] !== 'object' || raw[0] === null) {
        return undefined;
    }
    return raw[0] as Record<string, unknown>;
}

function decodeSensorSampleFields(
    obj: Record<string, unknown>,
    tempScale: number
): SensorHistorySample & { light?: number } {
    const sample: SensorHistorySample & { light?: number } = {};
    if (typeof obj.timestamp === 'number') {
        sample.timestamp = obj.timestamp;
    }
    if (typeof obj.temp === 'number') {
        sample.temperature = obj.temp / tempScale;
    }
    if (typeof obj.humi === 'number') {
        sample.humidity = obj.humi / 10;
    }
    if (typeof obj.light === 'number') {
        sample.light = obj.light;
    }
    return sample;
}

export function encodeSensorLatestGet(channel: number): MerossPayload {
    return encodeArray('latest', { channel });
}

export function decodeSensorLatestGetAck(payload: MerossPayload, tempScale: number): SensorLatestState[] {
    return decodeSensorLatest(payload, tempScale);
}

export function decodeSensorLatestPush(payload: MerossPayload, tempScale: number): SensorLatestState[] {
    return decodeSensorLatest(payload, tempScale);
}

function decodeSensorLatest(payload: MerossPayload, tempScale: number): SensorLatestState[] {
    return decodeArray(payload, 'latest', 'Control.Sensor.Latest').map((item) => {
        const channel = typeof item.channel === 'number' ? item.channel : 0;
        const result: SensorLatestState = { channel };
        if (typeof item.capacity === 'number') {
            result.capacity = item.capacity;
        }
        const values = item.value;
        if (!Array.isArray(values)) {
            return result;
        }
        for (const raw of values) {
            if (typeof raw !== 'object' || raw === null) {
                continue;
            }
            const sample = decodeSensorSampleFields(raw as Record<string, unknown>, tempScale);
            if (sample.timestamp !== undefined) {
                result.timestamp = sample.timestamp;
            }
            if (sample.temperature !== undefined) {
                result.temperature = sample.temperature;
            }
            if (sample.humidity !== undefined) {
                result.humidity = sample.humidity;
            }
            if (sample.light !== undefined) {
                result.light = sample.light;
            }
        }
        return result;
    });
}

export function encodeSensorHistoryGet(options: SensorHistoryGetOptions): MerossPayload {
    const entry: Record<string, unknown> = { channel: options.channel };
    if (options.capacity !== undefined) {
        entry.capacity = options.capacity;
    }
    return encodeArray('history', entry);
}

export function decodeSensorHistoryGetAck(payload: MerossPayload, tempScale: number): SensorHistoryState[] {
    return decodeSensorHistory(payload, tempScale);
}

export function decodeSensorHistoryPush(payload: MerossPayload, tempScale: number): SensorHistoryState[] {
    return decodeSensorHistory(payload, tempScale);
}

function decodeSensorHistory(payload: MerossPayload, tempScale: number): SensorHistoryState[] {
    return decodeArray(payload, 'history', 'Control.Sensor.History').map((item) => {
        const channel = typeof item.channel === 'number' ? item.channel : 0;
        const result: SensorHistoryState = { channel, samples: [] };
        if (typeof item.capacity === 'number') {
            result.capacity = item.capacity;
        }
        const values = item.value;
        if (!Array.isArray(values)) {
            return result;
        }
        for (const raw of values) {
            if (typeof raw !== 'object' || raw === null) {
                continue;
            }
            result.samples.push(decodeSensorSampleFields(raw as Record<string, unknown>, tempScale));
        }
        return result;
    });
}

export function encodeSmokeConfigGet(options: SmokeConfigGetOptions): MerossPayload {
    const entry: Record<string, unknown> = { channel: options.channel };
    if (options.subId) {
        entry.subId = options.subId;
    }
    return encodeArray('config', entry);
}

export function encodeSmokeConfigSet(options: SmokeConfigSetOptions): MerossPayload {
    const entry: Record<string, unknown> = { channel: options.channel };
    if (options.subId) {
        entry.subId = options.subId;
    }
    if (options.dndEnabled !== undefined) {
        entry.dnd = { enable: options.dndEnabled ? 1 : 2 };
    }
    if (options.detectEnabled !== undefined) {
        entry.detect = { enable: options.detectEnabled ? 1 : 2 };
    }
    return encodeArray('config', entry);
}

export function decodeSmokeConfigGetAck(payload: MerossPayload): SmokeConfigState[] {
    return decodeSmokeConfig(payload);
}

export function decodeSmokeConfigPush(payload: MerossPayload): SmokeConfigState[] {
    return decodeSmokeConfig(payload);
}

function decodeSmokeConfig(payload: MerossPayload): SmokeConfigState[] {
    return decodeArray(payload, 'config', 'Control.Smoke.Config').map((item) => {
        if (typeof item.channel !== 'number') {
            throw new ProtocolError('Control.Smoke.Config channel is required');
        }
        const result: SmokeConfigState = { channel: item.channel };
        if (typeof item.subId === 'string') {
            result.subId = item.subId;
        }
        const dnd = nestedNumber(item.dnd, 'enable');
        if (dnd !== undefined) {
            result.dndEnabled = dnd === 1;
        }
        const detect = nestedNumber(item.detect, 'enable');
        if (detect !== undefined) {
            result.detectEnabled = detect === 1;
        }
        return result;
    });
}
