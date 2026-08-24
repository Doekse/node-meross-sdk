import { ProtocolError } from '../../errors';
import type { MerossPayload } from '../message';

export const THERMOSTAT_MODE_NAMESPACE = 'Appliance.Control.Thermostat.Mode';
export const THERMOSTAT_MODEB_NAMESPACE = 'Appliance.Control.Thermostat.ModeB';
export const THERMOSTAT_MODEC_NAMESPACE = 'Appliance.Control.Thermostat.ModeC';

export const HUB_MTS100_MODE_NAMESPACE = 'Appliance.Hub.Mts100.Mode';
export const HUB_MTS100_TEMPERATURE_NAMESPACE = 'Appliance.Hub.Mts100.Temperature';

export type ClimateMode = 'off' | 'heat' | 'cool' | 'auto' | 'eco' | 'manual' | 'custom';
export type ClimateWorkMode = 'manual' | 'schedule' | 'timer';
export type ClimateFanSpeed = 'auto' | 'low' | 'medium' | 'high';

export interface ThermostatState {
    channel: number;
    on: boolean;
    mode: ClimateMode;
    targetTemperature?: number;
    currentTemperature?: number;
    heatTemperature?: number;
    coolTemperature?: number;
    ecoTemperature?: number;
    manualTemperature?: number;
    workMode?: ClimateWorkMode;
    humidity?: number;
    fanSpeed?: ClimateFanSpeed;
    fanHoldMinutes?: number;
    heating?: boolean;
    minTemperature?: number;
    maxTemperature?: number;
}

export interface ThermostatGetOptions {
    channel: number;
}

export interface ThermostatModeSetOptions {
    channel: number;
    mode?: ClimateMode;
    targetTemperature?: number;
    heatTemperature?: number;
    coolTemperature?: number;
    ecoTemperature?: number;
    manualTemperature?: number;
    workMode?: ClimateWorkMode;
    fanSpeed?: ClimateFanSpeed;
    fanHoldMinutes?: number;
}

export interface ThermostatModeBSetOptions {
    channel: number;
    on?: boolean;
    working?: 'heat' | 'cool';
    workMode?: ClimateWorkMode;
    targetTemperature?: number;
}

export interface HubSubdeviceGetOptions {
    id: string;
}

export interface HubToggleXSetOptions {
    id: string;
    on: boolean;
}

export interface HubMts100ModeSetOptions {
    id: string;
    state: number;
}

export interface HubMts100TemperatureSetOptions {
    id: string;
    targetTemperature?: number;
    custom?: number;
    comfort?: number;
    economy?: number;
    away?: number;
    windowOpen?: boolean;
}

export function encodeThermostatModeGet(options: ThermostatGetOptions): MerossPayload {
    return { mode: [{ channel: options.channel }] };
}

/** SET array under `mode`. Temps ×10; onoff 0/1. */
export function encodeThermostatModeSet(options: ThermostatModeSetOptions): MerossPayload {
    const entry: Record<string, unknown> = { channel: options.channel };
    if (options.mode !== undefined) {
        // Mode wire values: 0=heat, 1=cool, 2=eco, 3=auto, 4=manual; off drives onoff=0
        entry.onoff = options.mode === 'off' ? 0 : 1;
        entry.mode = options.mode === 'off' ? 0
            : options.mode === 'cool' ? 1
                : options.mode === 'eco' ? 2
                    : options.mode === 'auto' ? 3
                        : options.mode === 'manual' ? 4
                            : 0;
    }
    if (options.targetTemperature !== undefined) {
        entry.targetTemp = Math.round(options.targetTemperature * 10);
    }
    if (options.heatTemperature !== undefined) {
        entry.heatTemp = Math.round(options.heatTemperature * 10);
    }
    if (options.coolTemperature !== undefined) {
        entry.coolTemp = Math.round(options.coolTemperature * 10);
    }
    if (options.ecoTemperature !== undefined) {
        entry.ecoTemp = Math.round(options.ecoTemperature * 10);
    }
    if (options.manualTemperature !== undefined) {
        entry.manualTemp = Math.round(options.manualTemperature * 10);
    }
    return { mode: [entry] };
}

export function decodeThermostatModeGetAck(payload: MerossPayload): ThermostatState[] {
    return decodeThermostatMode(payload);
}

export function decodeThermostatModePush(payload: MerossPayload): ThermostatState[] {
    return decodeThermostatMode(payload);
}

function decodeThermostatMode(payload: MerossPayload): ThermostatState[] {
    const raw = payload.mode;
    if (!Array.isArray(raw)) {
        throw new ProtocolError('Thermostat.Mode payload must contain a mode array');
    }
    return raw.map((item) => {
        if (typeof item !== 'object' || item === null) {
            throw new ProtocolError('Thermostat.Mode entry must be an object');
        }
        const {
            channel, onoff, mode, targetTemp, currentTemp, heatTemp, coolTemp, ecoTemp, manualTemp, state, min, max
        } = item as Record<string, unknown>;
        if (typeof channel !== 'number' || typeof onoff !== 'number' || typeof mode !== 'number') {
            throw new ProtocolError('Thermostat.Mode entry requires channel, onoff, mode');
        }
        const on = onoff === 1;
        const hostMode: ClimateMode = !on ? 'off'
            : mode === 1 ? 'cool'
                : mode === 2 ? 'eco'
                    : mode === 3 ? 'auto'
                        : mode === 4 ? 'manual'
                            : 'heat';
        return {
            channel,
            on,
            mode: hostMode,
            ...(typeof targetTemp === 'number' ? { targetTemperature: targetTemp / 10 } : {}),
            ...(typeof currentTemp === 'number' ? { currentTemperature: currentTemp / 10 } : {}),
            ...(typeof heatTemp === 'number' ? { heatTemperature: heatTemp / 10 } : {}),
            ...(typeof coolTemp === 'number' ? { coolTemperature: coolTemp / 10 } : {}),
            ...(typeof ecoTemp === 'number' ? { ecoTemperature: ecoTemp / 10 } : {}),
            ...(typeof manualTemp === 'number' ? { manualTemperature: manualTemp / 10 } : {}),
            ...(typeof state === 'number' ? { heating: state === 1 } : {}),
            ...(typeof min === 'number' ? { minTemperature: min / 10 } : {}),
            ...(typeof max === 'number' ? { maxTemperature: max / 10 } : {})
        };
    });
}

export function encodeThermostatModeBGet(options: ThermostatGetOptions): MerossPayload {
    return { modeB: [{ channel: options.channel }] };
}

/** SET array under `modeB`. Temps ×100; onoff 1 = on, 2 = off. */
export function encodeThermostatModeBSet(options: ThermostatModeBSetOptions): MerossPayload {
    const entry: Record<string, unknown> = { channel: options.channel };
    if (options.on !== undefined) {
        entry.onoff = options.on ? 1 : 2;
    }
    if (options.working !== undefined) {
        entry.working = options.working === 'cool' ? 2 : 1;
    }
    if (options.workMode !== undefined) {
        entry.mode = options.workMode === 'schedule' ? 2 : options.workMode === 'timer' ? 3 : 1;
    }
    if (options.targetTemperature !== undefined) {
        // Firmware requires mode=1 (manual) to accept a targetTemp
        if (entry.mode === undefined) {
            entry.mode = 1;
        }
        entry.targetTemp = Math.round(options.targetTemperature * 100);
    }
    return { modeB: [entry] };
}

export function decodeThermostatModeBGetAck(payload: MerossPayload): ThermostatState[] {
    return decodeThermostatModeB(payload);
}

export function decodeThermostatModeBPush(payload: MerossPayload): ThermostatState[] {
    return decodeThermostatModeB(payload);
}

function decodeThermostatModeB(payload: MerossPayload): ThermostatState[] {
    const raw = payload.modeB;
    if (!Array.isArray(raw)) {
        throw new ProtocolError('Thermostat.ModeB payload must contain a modeB array');
    }
    return raw.map((item) => {
        if (typeof item !== 'object' || item === null) {
            throw new ProtocolError('Thermostat.ModeB entry must be an object');
        }
        const { channel, onoff, mode, targetTemp, currentTemp, working } = item as Record<string, unknown>;
        if (typeof channel !== 'number' || typeof onoff !== 'number' || typeof mode !== 'number') {
            throw new ProtocolError('Thermostat.ModeB entry requires channel, onoff, mode');
        }
        const on = onoff === 1;
        return {
            channel,
            on,
            mode: !on ? 'off' : working === 2 ? 'cool' : 'heat',
            workMode: mode === 2 ? 'schedule' : mode === 3 ? 'timer' : 'manual',
            ...(typeof targetTemp === 'number' ? { targetTemperature: targetTemp / 100 } : {}),
            ...(typeof currentTemp === 'number' ? { currentTemperature: currentTemp / 100 } : {})
        };
    });
}

export function encodeThermostatModeCGet(options: ThermostatGetOptions): MerossPayload {
    return { control: [{ channel: options.channel }] };
}

/** SET array under `control`. Temps ×100; `targetTemp` is `{ heat, cold }`. */
export function encodeThermostatModeCSet(options: ThermostatModeSetOptions): MerossPayload {
    const entry: Record<string, unknown> = { channel: options.channel };
    if (options.mode !== undefined) {
        // ModeC wire values: 0=off, 1=heat, 2=cool, 3=auto
        entry.mode = options.mode === 'off' ? 0 : options.mode === 'cool' ? 2 : options.mode === 'auto' ? 3 : 1;
    }
    if (options.workMode !== undefined) {
        entry.work = options.workMode === 'schedule' ? 2 : 1;
    }
    const targetTemp: Record<string, number> = {};
    if (options.heatTemperature !== undefined) {
        targetTemp.heat = Math.round(options.heatTemperature * 100);
    }
    if (options.coolTemperature !== undefined) {
        targetTemp.cold = Math.round(options.coolTemperature * 100);
    }
    if (options.targetTemperature !== undefined) {
        const wire = Math.round(options.targetTemperature * 100);
        if (options.mode === 'cool') {
            targetTemp.cold = wire;
        } else if (options.mode === 'heat') {
            targetTemp.heat = wire;
        } else {
            targetTemp.heat = targetTemp.heat ?? wire;
            targetTemp.cold = targetTemp.cold ?? wire;
        }
    }
    if (Object.keys(targetTemp).length > 0) {
        entry.targetTemp = targetTemp;
    }
    if (options.fanSpeed !== undefined || options.fanHoldMinutes !== undefined) {
        const speed = options.fanSpeed === 'low' ? 1 : options.fanSpeed === 'medium' ? 2 : options.fanSpeed === 'high' ? 3 : 0;
        entry.fan = {
            ...(options.fanSpeed !== undefined ? { speed, fMode: speed === 0 ? 0 : 1 } : {}),
            ...(options.fanHoldMinutes !== undefined ? { hTime: options.fanHoldMinutes } : {})
        };
    }
    return { control: [entry] };
}

export function decodeThermostatModeCGetAck(payload: MerossPayload): ThermostatState[] {
    return decodeThermostatModeC(payload);
}

export function decodeThermostatModeCPush(payload: MerossPayload): ThermostatState[] {
    return decodeThermostatModeC(payload);
}

function decodeThermostatModeC(payload: MerossPayload): ThermostatState[] {
    const raw = payload.control;
    if (!Array.isArray(raw)) {
        throw new ProtocolError('Thermostat.ModeC payload must contain a control array');
    }
    return raw.map((item) => {
        if (typeof item !== 'object' || item === null) {
            throw new ProtocolError('Thermostat.ModeC entry must be an object');
        }
        const { channel, mode, targetTemp, currentTemp, work, fan, more } = item as Record<string, unknown>;
        if (typeof channel !== 'number' || typeof mode !== 'number') {
            throw new ProtocolError('Thermostat.ModeC entry requires channel, mode');
        }
        const on = mode !== 0;
        const nested = typeof targetTemp === 'object' && targetTemp !== null
            ? targetTemp as Record<string, unknown>
            : {};
        const heatTemperature = typeof nested.heat === 'number' ? nested.heat / 100 : undefined;
        const coolTemperature = typeof nested.cold === 'number' ? nested.cold / 100 : undefined;
        const fanObj = typeof fan === 'object' && fan !== null ? fan as Record<string, unknown> : {};
        const moreObj = typeof more === 'object' && more !== null ? more as Record<string, unknown> : {};
        const fanSpeed: ClimateFanSpeed | undefined = typeof fanObj.speed !== 'number'
            ? undefined
            : fanObj.speed === 1 ? 'low' : fanObj.speed === 2 ? 'medium' : fanObj.speed === 3 ? 'high' : 'auto';
        const hostMode: ClimateMode = mode === 0 ? 'off' : mode === 2 ? 'cool' : mode === 3 ? 'auto' : 'heat';
        const targetTemperature = hostMode === 'cool' ? coolTemperature : heatTemperature;
        return {
            channel,
            on,
            mode: hostMode,
            ...(typeof work === 'number' ? { workMode: work === 2 ? 'schedule' : 'manual' } : {}),
            ...(heatTemperature !== undefined ? { heatTemperature } : {}),
            ...(coolTemperature !== undefined ? { coolTemperature } : {}),
            ...(targetTemperature !== undefined ? { targetTemperature } : {}),
            ...(typeof currentTemp === 'number' ? { currentTemperature: currentTemp / 100 } : {}),
            ...(typeof moreObj.humi === 'number' ? { humidity: moreObj.humi / 10 } : {}),
            ...(fanSpeed !== undefined ? { fanSpeed } : {}),
            ...(typeof fanObj.hTime === 'number' ? { fanHoldMinutes: fanObj.hTime } : {})
        };
    });
}

export function encodeHubToggleXSet(options: HubToggleXSetOptions): MerossPayload {
    return { togglex: [{ id: options.id, onoff: options.on ? 1 : 0 }] };
}

export function encodeHubToggleXGet(options: HubSubdeviceGetOptions): MerossPayload {
    return { togglex: [{ id: options.id }] };
}

export function decodeHubToggleXGetAck(payload: MerossPayload): Array<{ id: string; on: boolean }> {
    return decodeHubToggleX(payload);
}

export function decodeHubToggleXPush(payload: MerossPayload): Array<{ id: string; on: boolean }> {
    return decodeHubToggleX(payload);
}

function decodeHubToggleX(payload: MerossPayload): Array<{ id: string; on: boolean }> {
    const raw = payload.togglex;
    if (!Array.isArray(raw)) {
        throw new ProtocolError('Hub.ToggleX payload must contain a togglex array');
    }
    return raw.map((item) => {
        if (typeof item !== 'object' || item === null) {
            throw new ProtocolError('Hub.ToggleX entry must be an object');
        }
        const { id, onoff } = item as Record<string, unknown>;
        if (typeof id !== 'string' || typeof onoff !== 'number') {
            throw new ProtocolError('Hub.ToggleX entry requires id and onoff');
        }
        return { id, on: onoff === 1 };
    });
}

export function encodeHubMts100ModeSet(options: HubMts100ModeSetOptions): MerossPayload {
    return { mode: [{ id: options.id, state: options.state }] };
}

export function encodeHubMts100ModeGet(options: HubSubdeviceGetOptions): MerossPayload {
    return { mode: [{ id: options.id }] };
}

export function decodeHubMts100ModeGetAck(
    payload: MerossPayload
): Array<{ id: string; state: number }> {
    return decodeHubMts100Mode(payload);
}

export function decodeHubMts100ModePush(
    payload: MerossPayload
): Array<{ id: string; state: number }> {
    return decodeHubMts100Mode(payload);
}

function decodeHubMts100Mode(payload: MerossPayload): Array<{ id: string; state: number }> {
    const raw = payload.mode;
    if (!Array.isArray(raw)) {
        throw new ProtocolError('Hub.Mts100.Mode payload must contain a mode array');
    }
    return raw.map((item) => {
        if (typeof item !== 'object' || item === null) {
            throw new ProtocolError('Hub.Mts100.Mode entry must be an object');
        }
        const { id, state } = item as Record<string, unknown>;
        if (typeof id !== 'string' || typeof state !== 'number') {
            throw new ProtocolError('Hub.Mts100.Mode entry requires id and state');
        }
        return { id, state };
    });
}

export function encodeHubMts100TemperatureGet(options: HubSubdeviceGetOptions): MerossPayload {
    return { temperature: [{ id: options.id }] };
}

export function encodeHubMts100TemperatureSet(options: HubMts100TemperatureSetOptions): MerossPayload {
    return {
        temperature: [{
            id: options.id,
            ...(options.targetTemperature !== undefined ? { custom: Math.round(options.targetTemperature * 10) } : {}),
            ...(options.custom !== undefined ? { custom: Math.round(options.custom * 10) } : {}),
            ...(options.comfort !== undefined ? { comfort: Math.round(options.comfort * 10) } : {}),
            ...(options.economy !== undefined ? { economy: Math.round(options.economy * 10) } : {}),
            ...(options.away !== undefined ? { away: Math.round(options.away * 10) } : {}),
            ...(options.windowOpen === false ? { openWindow: 0 } : {})
        }]
    };
}

export interface HubMts100TemperatureState {
    id: string;
    currentTemperature?: number;
    targetTemperature?: number;
    custom?: number;
    comfort?: number;
    economy?: number;
    away?: number;
    windowOpen?: boolean;
    heating?: boolean;
}

export function decodeHubMts100TemperatureGetAck(payload: MerossPayload): HubMts100TemperatureState[] {
    return decodeHubMts100Temperature(payload);
}

export function decodeHubMts100TemperaturePush(payload: MerossPayload): HubMts100TemperatureState[] {
    return decodeHubMts100Temperature(payload);
}

function decodeHubMts100Temperature(payload: MerossPayload): HubMts100TemperatureState[] {
    const raw = payload.temperature;
    if (!Array.isArray(raw)) {
        throw new ProtocolError('Hub.Mts100.Temperature payload must contain a temperature array');
    }
    return raw.map((item) => {
        if (typeof item !== 'object' || item === null) {
            throw new ProtocolError('Hub.Mts100.Temperature entry must be an object');
        }
        const { id, room, currentSet, custom, comfort, economy, away, openWindow, heating } = item as Record<string, unknown>;
        if (typeof id !== 'string') {
            throw new ProtocolError('Hub.Mts100.Temperature entry requires id');
        }
        return {
            id,
            ...(typeof room === 'number' ? { currentTemperature: room / 10 } : {}),
            ...(typeof currentSet === 'number' ? { targetTemperature: currentSet / 10 } : {}),
            ...(typeof custom === 'number' ? { custom: custom / 10 } : {}),
            ...(typeof comfort === 'number' ? { comfort: comfort / 10 } : {}),
            ...(typeof economy === 'number' ? { economy: economy / 10 } : {}),
            ...(typeof away === 'number' ? { away: away / 10 } : {}),
            ...(typeof openWindow === 'number' ? { windowOpen: openWindow === 1 } : {}),
            ...(typeof heating === 'number' ? { heating: heating === 1 } : {})
        };
    });
}

export const HOLD_ACTION_NAMESPACE = 'Appliance.Control.Thermostat.HoldAction';
export const WINDOW_OPENED_NAMESPACE = 'Appliance.Control.Thermostat.WindowOpened';
export const SENSOR_NAMESPACE = 'Appliance.Control.Thermostat.Sensor';
export const FROST_NAMESPACE = 'Appliance.Control.Thermostat.Frost';
export const CALIBRATION_NAMESPACE = 'Appliance.Control.Thermostat.Calibration';
export const OVERHEAT_NAMESPACE = 'Appliance.Control.Thermostat.Overheat';
export const DEAD_ZONE_NAMESPACE = 'Appliance.Control.Thermostat.DeadZone';
export const SUMMER_MODE_NAMESPACE = 'Appliance.Control.Thermostat.SummerMode';
export const COMPRESSOR_DELAY_NAMESPACE = 'Appliance.Control.Thermostat.CompressorDelay';
export const CTL_RANGE_NAMESPACE = 'Appliance.Control.Thermostat.CtlRange';
export const TIMER_NAMESPACE = 'Appliance.Control.Thermostat.Timer';
export const ALARM_NAMESPACE = 'Appliance.Control.Thermostat.Alarm';
export const ALARM_CONFIG_NAMESPACE = 'Appliance.Control.Thermostat.AlarmConfig';
export const SCHEDULE_NAMESPACE = 'Appliance.Control.Thermostat.Schedule';
export const SCHEDULEB_NAMESPACE = 'Appliance.Control.Thermostat.ScheduleB';
export const THERMOSTAT_SYSTEM_NAMESPACE = 'Appliance.Control.Thermostat.System';

/** Firmware `wire` terminals; keys and numbers are passed through as-is. */
export type ClimateSystemWire = Record<string, number>;

export interface ClimateSystem {
    fLevel?: number;
    hLevel?: number;
    cLevel?: number;
    sysType?: number;
    hdType?: number;
    compTempEnable?: boolean;
    compType?: number;
    compTemp?: number;
    OBType?: number;
    AUXType?: number;
    AUXWorkType?: number;
    dType?: number;
    wire?: ClimateSystemWire;
}

export interface ThermostatSystemState extends ClimateSystem {
    channel: number;
}

export interface ThermostatSystemSetOptions extends ClimateSystem {
    channel: number;
}

/** SET array under `control`. `compTemp` is °C ×100 (ModeC scale). */
export function encodeThermostatSystemSet(options: ThermostatSystemSetOptions): MerossPayload {
    const entry: Record<string, unknown> = { channel: options.channel };
    if (options.fLevel !== undefined) {
        entry.fLevel = options.fLevel;
    }
    if (options.hLevel !== undefined) {
        entry.hLevel = options.hLevel;
    }
    if (options.cLevel !== undefined) {
        entry.cLevel = options.cLevel;
    }
    if (options.sysType !== undefined) {
        entry.sysType = options.sysType;
    }
    if (options.hdType !== undefined) {
        entry.hdType = options.hdType;
    }
    if (options.compTempEnable !== undefined) {
        entry.compTempEnable = options.compTempEnable ? 1 : 0;
    }
    if (options.compType !== undefined) {
        entry.compType = options.compType;
    }
    if (options.compTemp !== undefined) {
        entry.compTemp = Math.round(options.compTemp * 100);
    }
    if (options.OBType !== undefined) {
        entry.OBType = options.OBType;
    }
    if (options.AUXType !== undefined) {
        entry.AUXType = options.AUXType;
    }
    if (options.AUXWorkType !== undefined) {
        entry.AUXWorkType = options.AUXWorkType;
    }
    if (options.dType !== undefined) {
        entry.dType = options.dType;
    }
    if (options.wire !== undefined) {
        entry.wire = options.wire;
    }
    return encodeArray('control', entry);
}

export function decodeThermostatSystemGetAck(payload: MerossPayload): ThermostatSystemState[] {
    return decodeThermostatSystem(payload);
}

export function decodeThermostatSystemPush(payload: MerossPayload): ThermostatSystemState[] {
    return decodeThermostatSystem(payload);
}

function decodeThermostatSystem(payload: MerossPayload): ThermostatSystemState[] {
    return decodeArray(payload, 'control', 'Thermostat.System').map((item) => {
        if (typeof item.channel !== 'number') {
            throw new ProtocolError('Thermostat.System entry requires channel');
        }
        const wireRaw = item.wire;
        const wire = typeof wireRaw === 'object' && wireRaw !== null
            ? decodeSystemWire(wireRaw as Record<string, unknown>)
            : undefined;
        return {
            channel: item.channel,
            ...(typeof item.fLevel === 'number' ? { fLevel: item.fLevel } : {}),
            ...(typeof item.hLevel === 'number' ? { hLevel: item.hLevel } : {}),
            ...(typeof item.cLevel === 'number' ? { cLevel: item.cLevel } : {}),
            ...(typeof item.sysType === 'number' ? { sysType: item.sysType } : {}),
            ...(typeof item.hdType === 'number' ? { hdType: item.hdType } : {}),
            ...(typeof item.compTempEnable === 'number' ? { compTempEnable: item.compTempEnable === 1 } : {}),
            ...(typeof item.compType === 'number' ? { compType: item.compType } : {}),
            ...(typeof item.compTemp === 'number' ? { compTemp: item.compTemp / 100 } : {}),
            ...(typeof item.OBType === 'number' ? { OBType: item.OBType } : {}),
            ...(typeof item.AUXType === 'number' ? { AUXType: item.AUXType } : {}),
            ...(typeof item.AUXWorkType === 'number' ? { AUXWorkType: item.AUXWorkType } : {}),
            ...(typeof item.dType === 'number' ? { dType: item.dType } : {}),
            ...(wire !== undefined ? { wire } : {})
        };
    });
}

function decodeSystemWire(raw: Record<string, unknown>): ClimateSystemWire {
    const wire: ClimateSystemWire = {};
    for (const [terminal, value] of Object.entries(raw)) {
        if (typeof value === 'number') {
            wire[terminal] = value;
        }
    }
    return wire;
}

export const HUB_MTS100_ALL_NAMESPACE = 'Appliance.Hub.Mts100.All';
export const HUB_MTS100_ADJUST_NAMESPACE = 'Appliance.Hub.Mts100.Adjust';
export const HUB_MTS100_CONFIG_NAMESPACE = 'Appliance.Hub.Mts100.Config';
export const HUB_MTS100_SUPERCTL_NAMESPACE = 'Appliance.Hub.Mts100.SuperCtl';
export const HUB_MTS100_SCHEDULE_NAMESPACE = 'Appliance.Hub.Mts100.Schedule';
export const HUB_MTS100_SCHEDULEB_NAMESPACE = 'Appliance.Hub.Mts100.ScheduleB';
export const HUB_MTS100_TIMESYNC_NAMESPACE = 'Appliance.Hub.Mts100.TimeSync';
export const TEMP_UNIT_NAMESPACE = 'Appliance.Control.TempUnit';
export const PHYSICAL_LOCK_NAMESPACE = 'Appliance.Control.PhysicalLock';
export const SCREEN_BRIGHTNESS_NAMESPACE = 'Appliance.Control.Screen.Brightness';

/** Board ScheduleB sentinel for an off slot; send as-is, do not scale. */
export const SCHEDULEB_OFF = 43690;
/** Hub ScheduleB off slot is 0xFFFF; send as-is, do not scale. */
export const SCHEDULEB_HUB_OFF = 0xffff;

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type ClimateWeekday = (typeof DAYS)[number];

export type ClimateHoldMode = 'permanent' | 'untilSchedule' | 'until';
export type ClimateSensorMode = 'internalExternal' | 'external' | 'internal';
export type ClimateAlarmKind = 'high' | 'low' | 'probe';
export type ClimateTimerKind = 'countdown' | 'cycle';
export type ClimateTempUnit = 'celsius' | 'fahrenheit';

export interface ClimateSchedule {
    mon?: number[][];
    tue?: number[][];
    wed?: number[][];
    thu?: number[][];
    fri?: number[][];
    sat?: number[][];
    sun?: number[][];
}

export interface ClimateTimer {
    type: ClimateTimerKind;
    durationMinutes?: number;
    on?: boolean;
    onDurationMinutes?: number;
    offDurationMinutes?: number;
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

export function encodeThermostatChannelGet(key: string, channel: number): MerossPayload {
    return encodeArray(key, { channel });
}

export function encodeHubIdGet(key: string, id: string): MerossPayload {
    return encodeArray(key, { id });
}

export function encodeHoldActionSet(options: {
    channel: number;
    mode: ClimateHoldMode;
    minutes?: number;
}): MerossPayload {
    const mode = options.mode === 'untilSchedule' ? 1 : options.mode === 'until' ? 2 : 0;
    return encodeArray('holdAction', {
        channel: options.channel,
        mode,
        ...(options.minutes !== undefined ? { time: options.minutes } : {})
    });
}

export function decodeHoldAction(payload: MerossPayload): Array<{
    channel: number;
    holdMode: ClimateHoldMode;
    holdMinutes?: number;
    holdExpiresAt?: number;
}> {
    return decodeArray(payload, 'holdAction', 'Thermostat.HoldAction').map((item) => {
        if (typeof item.channel !== 'number' || typeof item.mode !== 'number') {
            throw new ProtocolError('Thermostat.HoldAction entry requires channel, mode');
        }
        return {
            channel: item.channel,
            holdMode: item.mode === 1 ? 'untilSchedule' : item.mode === 2 ? 'until' : 'permanent',
            ...(typeof item.time === 'number' ? { holdMinutes: item.time } : {}),
            ...(typeof item.expire === 'number' ? { holdExpiresAt: item.expire } : {})
        };
    });
}

export function encodeWindowOpenedSet(options: {
    channel: number;
    detect?: boolean;
    windowOpen?: boolean;
}): MerossPayload {
    return encodeArray('windowOpened', {
        channel: options.channel,
        ...(options.detect !== undefined ? { detect: options.detect ? 1 : 0 } : {}),
        ...(options.windowOpen !== undefined ? { status: options.windowOpen ? 1 : 0 } : {})
    });
}

export function decodeWindowOpened(payload: MerossPayload): Array<{
    channel: number;
    windowDetect?: boolean;
    windowOpen?: boolean;
}> {
    return decodeArray(payload, 'windowOpened', 'Thermostat.WindowOpened').map((item) => {
        if (typeof item.channel !== 'number') {
            throw new ProtocolError('Thermostat.WindowOpened entry requires channel');
        }
        return {
            channel: item.channel,
            ...(typeof item.detect === 'number' ? { windowDetect: item.detect === 1 } : {}),
            ...(typeof item.status === 'number' ? { windowOpen: item.status === 1 } : {})
        };
    });
}

export function encodeSensorModeSet(options: { channel: number; sensorMode: ClimateSensorMode }): MerossPayload {
    const mode = options.sensorMode === 'external' ? 1 : options.sensorMode === 'internal' ? 2 : 0;
    return encodeArray('sensor', { channel: options.channel, mode });
}

export function decodeSensorMode(payload: MerossPayload): Array<{ channel: number; sensorMode: ClimateSensorMode }> {
    return decodeArray(payload, 'sensor', 'Thermostat.Sensor').map((item) => {
        if (typeof item.channel !== 'number' || typeof item.mode !== 'number') {
            throw new ProtocolError('Thermostat.Sensor entry requires channel, mode');
        }
        return {
            channel: item.channel,
            sensorMode: item.mode === 1 ? 'external' : item.mode === 2 ? 'internal' : 'internalExternal'
        };
    });
}

export function encodeFrostSet(options: {
    channel: number;
    frost?: boolean;
    frostTemperature?: number;
    scale: number;
}): MerossPayload {
    return encodeArray('frost', {
        channel: options.channel,
        ...(options.frost !== undefined ? { onoff: options.frost ? 1 : 0 } : {}),
        ...(options.frostTemperature !== undefined ? { value: Math.round(options.frostTemperature * options.scale) } : {})
    });
}

export function decodeFrost(payload: MerossPayload, scale: number): Array<{
    channel: number;
    frost?: boolean;
    frostTemperature?: number;
}> {
    return decodeArray(payload, 'frost', 'Thermostat.Frost').map((item) => {
        if (typeof item.channel !== 'number') {
            throw new ProtocolError('Thermostat.Frost entry requires channel');
        }
        return {
            channel: item.channel,
            ...(typeof item.onoff === 'number' ? { frost: item.onoff === 1 } : {}),
            ...(typeof item.value === 'number' ? { frostTemperature: item.value / scale } : {})
        };
    });
}

export function encodeCalibrationSet(options: {
    channel: number;
    calibration: number;
    scale: number;
}): MerossPayload {
    return encodeArray('calibration', {
        channel: options.channel,
        value: Math.round(options.calibration * options.scale)
    });
}

export function decodeCalibration(payload: MerossPayload, scale: number): Array<{
    channel: number;
    calibration?: number;
}> {
    return decodeArray(payload, 'calibration', 'Thermostat.Calibration').map((item) => {
        if (typeof item.channel !== 'number') {
            throw new ProtocolError('Thermostat.Calibration entry requires channel');
        }
        return {
            channel: item.channel,
            ...(typeof item.value === 'number' ? { calibration: item.value / scale } : {})
        };
    });
}

export function encodeOverheatSet(options: {
    channel: number;
    overheat?: boolean;
    overheatTemperature?: number;
}): MerossPayload {
    return encodeArray('overheat', {
        channel: options.channel,
        ...(options.overheat !== undefined ? { onoff: options.overheat ? 1 : 0 } : {}),
        ...(options.overheatTemperature !== undefined ? { value: Math.round(options.overheatTemperature * 10) } : {})
    });
}

export function decodeOverheat(payload: MerossPayload): Array<{
    channel: number;
    overheat?: boolean;
    overheatTemperature?: number;
}> {
    return decodeArray(payload, 'overheat', 'Thermostat.Overheat').map((item) => {
        if (typeof item.channel !== 'number') {
            throw new ProtocolError('Thermostat.Overheat entry requires channel');
        }
        return {
            channel: item.channel,
            ...(typeof item.onoff === 'number' ? { overheat: item.onoff === 1 } : {}),
            ...(typeof item.value === 'number' ? { overheatTemperature: item.value / 10 } : {})
        };
    });
}

export function encodeDeadZoneSet(options: {
    channel: number;
    deadZone: number;
    scale: number;
}): MerossPayload {
    return encodeArray('deadZone', {
        channel: options.channel,
        value: Math.round(options.deadZone * options.scale)
    });
}

export function decodeDeadZone(payload: MerossPayload, scale: number): Array<{
    channel: number;
    deadZone?: number;
}> {
    return decodeArray(payload, 'deadZone', 'Thermostat.DeadZone').map((item) => {
        if (typeof item.channel !== 'number') {
            throw new ProtocolError('Thermostat.DeadZone entry requires channel');
        }
        return {
            channel: item.channel,
            ...(typeof item.value === 'number' ? { deadZone: item.value / scale } : {})
        };
    });
}

export function encodeSummerModeSet(options: { channel: number; summerMode: boolean }): MerossPayload {
    return encodeArray('summerMode', { channel: options.channel, mode: options.summerMode ? 2 : 1 });
}

export function decodeSummerMode(payload: MerossPayload): Array<{ channel: number; summerMode: boolean }> {
    return decodeArray(payload, 'summerMode', 'Thermostat.SummerMode').map((item) => {
        if (typeof item.channel !== 'number' || typeof item.mode !== 'number') {
            throw new ProtocolError('Thermostat.SummerMode entry requires channel, mode');
        }
        return { channel: item.channel, summerMode: item.mode === 2 };
    });
}

export function encodeCompressorDelaySet(options: {
    channel: number;
    compressorDelay?: boolean;
    compressorDelayMinutes?: number;
}): MerossPayload {
    return encodeArray('delay', {
        channel: options.channel,
        ...(options.compressorDelay !== undefined ? { enable: options.compressorDelay ? 1 : 2 } : {}),
        ...(options.compressorDelayMinutes !== undefined ? { value: options.compressorDelayMinutes } : {})
    });
}

export function decodeCompressorDelay(payload: MerossPayload): Array<{
    channel: number;
    compressorDelay?: boolean;
    compressorDelayMinutes?: number;
}> {
    return decodeArray(payload, 'delay', 'Thermostat.CompressorDelay').map((item) => {
        if (typeof item.channel !== 'number') {
            throw new ProtocolError('Thermostat.CompressorDelay entry requires channel');
        }
        return {
            channel: item.channel,
            ...(typeof item.enable === 'number' ? { compressorDelay: item.enable === 1 } : {}),
            ...(typeof item.value === 'number' ? { compressorDelayMinutes: item.value } : {})
        };
    });
}

export function encodeCtlRangeSet(options: {
    channel: number;
    minTemperature: number;
    maxTemperature: number;
}): MerossPayload {
    return encodeArray('ctlRange', {
        channel: options.channel,
        ctlMin: Math.round(options.minTemperature * 100),
        ctlMax: Math.round(options.maxTemperature * 100)
    });
}

export function decodeCtlRange(payload: MerossPayload): Array<{
    channel: number;
    minTemperature?: number;
    maxTemperature?: number;
}> {
    return decodeArray(payload, 'ctlRange', 'Thermostat.CtlRange').map((item) => {
        if (typeof item.channel !== 'number') {
            throw new ProtocolError('Thermostat.CtlRange entry requires channel');
        }
        return {
            channel: item.channel,
            ...(typeof item.ctlMin === 'number' ? { minTemperature: item.ctlMin / 100 } : {}),
            ...(typeof item.ctlMax === 'number' ? { maxTemperature: item.ctlMax / 100 } : {})
        };
    });
}

export function encodeTimerSet(options: { channel: number; timer: ClimateTimer }): MerossPayload {
    if (options.timer.type === 'countdown') {
        return encodeArray('timer', {
            channel: options.channel,
            type: 1,
            down: {
                duration: options.timer.durationMinutes ?? 0,
                onoff: options.timer.on === false ? 2 : 1
            }
        });
    }
    return encodeArray('timer', {
        channel: options.channel,
        type: 2,
        cycle: {
            onDuration: options.timer.onDurationMinutes ?? 0,
            offDuration: options.timer.offDurationMinutes ?? 0
        }
    });
}

export function decodeTimer(payload: MerossPayload): Array<{ channel: number; timer: ClimateTimer }> {
    return decodeArray(payload, 'timer', 'Thermostat.Timer').map((item) => {
        if (typeof item.channel !== 'number' || typeof item.type !== 'number') {
            throw new ProtocolError('Thermostat.Timer entry requires channel, type');
        }
        if (item.type === 2 && typeof item.cycle === 'object' && item.cycle !== null) {
            const cycle = item.cycle as Record<string, unknown>;
            return {
                channel: item.channel,
                timer: {
                    type: 'cycle',
                    ...(typeof cycle.onDuration === 'number' ? { onDurationMinutes: cycle.onDuration } : {}),
                    ...(typeof cycle.offDuration === 'number' ? { offDurationMinutes: cycle.offDuration } : {})
                }
            };
        }
        const down = typeof item.down === 'object' && item.down !== null
            ? item.down as Record<string, unknown>
            : {};
        return {
            channel: item.channel,
            timer: {
                type: 'countdown',
                ...(typeof down.duration === 'number' ? { durationMinutes: down.duration } : {}),
                ...(typeof down.onoff === 'number' ? { on: down.onoff === 1 } : {})
            }
        };
    });
}

export function decodeAlarm(payload: MerossPayload): Array<{
    channel: number;
    alarm: ClimateAlarmKind;
    alarmTemperature?: number;
}> {
    return decodeArray(payload, 'alarm', 'Thermostat.Alarm').map((item) => {
        if (typeof item.channel !== 'number' || typeof item.type !== 'number') {
            throw new ProtocolError('Thermostat.Alarm entry requires channel, type');
        }
        return {
            channel: item.channel,
            alarm: item.type === 2 ? 'low' : item.type === 3 ? 'probe' : 'high',
            ...(typeof item.temp === 'number' ? { alarmTemperature: item.temp / 100 } : {})
        };
    });
}

export function encodeAlarmConfigSet(options: {
    channel: number;
    highAlarm?: boolean;
    highAlarmTemperature?: number;
    lowAlarm?: boolean;
    lowAlarmTemperature?: number;
}): MerossPayload {
    return encodeArray('alarmConfig', {
        channel: options.channel,
        ...(options.highAlarm !== undefined ? { highEnable: options.highAlarm ? 1 : 2 } : {}),
        ...(options.highAlarmTemperature !== undefined ? { highTemp: Math.round(options.highAlarmTemperature * 100) } : {}),
        ...(options.lowAlarm !== undefined ? { lowEnable: options.lowAlarm ? 1 : 2 } : {}),
        ...(options.lowAlarmTemperature !== undefined ? { lowTemp: Math.round(options.lowAlarmTemperature * 100) } : {})
    });
}

export function decodeAlarmConfig(payload: MerossPayload): Array<{
    channel: number;
    highAlarm?: boolean;
    highAlarmTemperature?: number;
    lowAlarm?: boolean;
    lowAlarmTemperature?: number;
}> {
    return decodeArray(payload, 'alarmConfig', 'Thermostat.AlarmConfig').map((item) => {
        if (typeof item.channel !== 'number') {
            throw new ProtocolError('Thermostat.AlarmConfig entry requires channel');
        }
        return {
            channel: item.channel,
            ...(typeof item.highEnable === 'number' ? { highAlarm: item.highEnable === 1 } : {}),
            ...(typeof item.highTemp === 'number' ? { highAlarmTemperature: item.highTemp / 100 } : {}),
            ...(typeof item.lowEnable === 'number' ? { lowAlarm: item.lowEnable === 1 } : {}),
            ...(typeof item.lowTemp === 'number' ? { lowAlarmTemperature: item.lowTemp / 100 } : {})
        };
    });
}

function scaleSchedule(days: ClimateSchedule, scale: number, toWire: boolean): ClimateSchedule {
    const out: ClimateSchedule = {};
    for (const day of DAYS) {
        const slots = days[day];
        if (!slots) {
            continue;
        }
        out[day] = slots.map((slot) => slot.map((value, index) => {
            if (index === 0) {
                return value;
            }
            if (value === SCHEDULEB_OFF || value === SCHEDULEB_HUB_OFF) {
                return value;
            }
            return toWire ? Math.round(value * scale) : value / scale;
        }));
    }
    return out;
}

export function encodeScheduleSet(options: {
    channel: number;
    schedule: ClimateSchedule;
    scale: number;
    key?: 'schedule' | 'scheduleB';
}): MerossPayload {
    const key = options.key ?? 'schedule';
    return encodeArray(key, {
        channel: options.channel,
        ...scaleSchedule(options.schedule, options.scale, true)
    });
}

export function decodeSchedule(
    payload: MerossPayload,
    scale: number,
    key: 'schedule' | 'scheduleB' = 'schedule'
): Array<{ channel: number; schedule: ClimateSchedule }> {
    return decodeArray(payload, key, 'Thermostat.Schedule').map((item) => {
        if (typeof item.channel !== 'number') {
            throw new ProtocolError('Thermostat.Schedule entry requires channel');
        }
        const days: ClimateSchedule = {};
        for (const day of DAYS) {
            if (Array.isArray(item[day])) {
                days[day] = item[day] as number[][];
            }
        }
        return { channel: item.channel, schedule: scaleSchedule(days, scale, false) };
    });
}

export function encodeHubAdjustSet(options: { id: string; calibration: number }): MerossPayload {
    return encodeArray('adjust', { id: options.id, temperature: Math.round(options.calibration * 100) });
}

export function decodeHubAdjust(payload: MerossPayload): Array<{ id: string; calibration?: number }> {
    return decodeArray(payload, 'adjust', 'Hub.Mts100.Adjust').map((item) => {
        if (typeof item.id !== 'string') {
            throw new ProtocolError('Hub.Mts100.Adjust entry requires id');
        }
        return {
            id: item.id,
            ...(typeof item.temperature === 'number' ? { calibration: item.temperature / 100 } : {})
        };
    });
}

export function encodeHubConfigSet(options: {
    id: string;
    pid: { grade: number; p: number; i: number; d?: number };
}): MerossPayload {
    return encodeArray('config', { id: options.id, pid: options.pid });
}

export function decodeHubConfig(payload: MerossPayload): Array<{
    id: string;
    pid?: { grade: number; p: number; i: number; d?: number };
}> {
    return decodeArray(payload, 'config', 'Hub.Mts100.Config').map((item) => {
        if (typeof item.id !== 'string') {
            throw new ProtocolError('Hub.Mts100.Config entry requires id');
        }
        const pid = item.pid;
        if (typeof pid !== 'object' || pid === null) {
            return { id: item.id };
        }
        const { grade, p, i, d } = pid as Record<string, unknown>;
        if (typeof grade !== 'number' || typeof p !== 'number' || typeof i !== 'number') {
            return { id: item.id };
        }
        return { id: item.id, pid: { grade, p, i, ...(typeof d === 'number' ? { d } : {}) } };
    });
}

export function encodeHubSuperCtlSet(options: {
    id: string;
    superCtl: boolean;
    superCtlLevel?: number;
}): MerossPayload {
    return encodeArray('superCtl', {
        id: options.id,
        enable: options.superCtl ? 2 : 1,
        level: options.superCtlLevel ?? 1,
        alert: 1
    });
}

export function decodeHubSuperCtl(payload: MerossPayload): Array<{
    id: string;
    superCtl?: boolean;
    superCtlLevel?: number;
}> {
    return decodeArray(payload, 'superCtl', 'Hub.Mts100.SuperCtl').map((item) => {
        if (typeof item.id !== 'string') {
            throw new ProtocolError('Hub.Mts100.SuperCtl entry requires id');
        }
        return {
            id: item.id,
            ...(typeof item.enable === 'number' ? { superCtl: item.enable === 2 } : {}),
            ...(typeof item.level === 'number' ? { superCtlLevel: item.level } : {})
        };
    });
}

export function encodeHubScheduleSet(options: {
    id: string;
    schedule: ClimateSchedule;
    scale: number;
}): MerossPayload {
    return encodeArray('schedule', { id: options.id, ...scaleSchedule(options.schedule, options.scale, true) });
}

export function decodeHubSchedule(
    payload: MerossPayload,
    scale: number
): Array<{ id: string; schedule: ClimateSchedule }> {
    return decodeArray(payload, 'schedule', 'Hub.Mts100.Schedule').map((item) => {
        if (typeof item.id !== 'string') {
            throw new ProtocolError('Hub.Mts100.Schedule entry requires id');
        }
        const days: ClimateSchedule = {};
        for (const day of DAYS) {
            if (Array.isArray(item[day])) {
                days[day] = item[day] as number[][];
            }
        }
        return { id: item.id, schedule: scaleSchedule(days, scale, false) };
    });
}

export function decodeHubTimeSync(payload: MerossPayload): Array<{ id: string; timeSync?: boolean }> {
    return decodeArray(payload, 'timeSync', 'Hub.Mts100.TimeSync').map((item) => {
        if (typeof item.id !== 'string') {
            throw new ProtocolError('Hub.Mts100.TimeSync entry requires id');
        }
        return {
            id: item.id,
            ...(typeof item.state === 'number' ? { timeSync: item.state === 1 } : {})
        };
    });
}

export function decodeHubMts100All(payload: MerossPayload): Array<{
    id: string;
    on?: boolean;
    modeRaw?: number;
    currentTemperature?: number;
    targetTemperature?: number;
    custom?: number;
    comfort?: number;
    economy?: number;
    away?: number;
    windowOpen?: boolean;
    heating?: boolean;
    timeSync?: boolean;
}> {
    return decodeArray(payload, 'all', 'Hub.Mts100.All').map((item) => {
        if (typeof item.id !== 'string') {
            throw new ProtocolError('Hub.Mts100.All entry requires id');
        }
        const togglex = item.togglex as Record<string, unknown> | undefined;
        const mode = item.mode as Record<string, unknown> | undefined;
        const temperature = item.temperature as Record<string, unknown> | undefined;
        const timeSync = item.timeSync as Record<string, unknown> | undefined;
        return {
            id: item.id,
            ...(typeof togglex?.onoff === 'number' ? { on: togglex.onoff === 1 } : {}),
            ...(typeof mode?.state === 'number' ? { modeRaw: mode.state } : {}),
            ...(typeof temperature?.room === 'number' ? { currentTemperature: temperature.room / 10 } : {}),
            ...(typeof temperature?.currentSet === 'number' ? { targetTemperature: temperature.currentSet / 10 } : {}),
            ...(typeof temperature?.custom === 'number' ? { custom: temperature.custom / 10 } : {}),
            ...(typeof temperature?.comfort === 'number' ? { comfort: temperature.comfort / 10 } : {}),
            ...(typeof temperature?.economy === 'number' ? { economy: temperature.economy / 10 } : {}),
            ...(typeof temperature?.away === 'number' ? { away: temperature.away / 10 } : {}),
            ...(typeof temperature?.openWindow === 'number' ? { windowOpen: temperature.openWindow === 1 } : {}),
            ...(typeof temperature?.heating === 'number' ? { heating: temperature.heating === 1 } : {}),
            ...(typeof timeSync?.state === 'number' ? { timeSync: timeSync.state === 1 } : {})
        };
    });
}

const TEMP_UNIT_FROM_WIRE: Record<number, ClimateTempUnit> = {
    1: 'celsius',
    2: 'fahrenheit'
};
const TEMP_UNIT_TO_WIRE: Record<ClimateTempUnit, number> = {
    celsius: 1,
    fahrenheit: 2
};

export function encodeTempUnitSet(options: { channel: number; tempUnit: ClimateTempUnit }): MerossPayload {
    return encodeArray('tempUnit', {
        channel: options.channel,
        tempUnit: TEMP_UNIT_TO_WIRE[options.tempUnit]
    });
}

export function decodeTempUnit(payload: MerossPayload): Array<{ channel: number; tempUnit?: ClimateTempUnit }> {
    return decodeArray(payload, 'tempUnit', 'Control.TempUnit').map((item) => {
        if (typeof item.channel !== 'number') {
            throw new ProtocolError('Control.TempUnit entry requires channel');
        }
        return {
            channel: item.channel,
            ...(typeof item.tempUnit === 'number' && TEMP_UNIT_FROM_WIRE[item.tempUnit]
                ? { tempUnit: TEMP_UNIT_FROM_WIRE[item.tempUnit] }
                : {})
        };
    });
}

export function encodePhysicalLockGet(options: { channel: number; subId?: string }): MerossPayload {
    return encodeArray('lock', {
        channel: options.channel,
        ...(options.subId !== undefined ? { subId: options.subId } : {})
    });
}

export function encodePhysicalLockSet(options: {
    channel: number;
    locked: boolean;
    subId?: string;
}): MerossPayload {
    return encodeArray('lock', {
        channel: options.channel,
        onoff: options.locked ? 1 : 0,
        ...(options.subId !== undefined ? { subId: options.subId } : {})
    });
}

export function decodePhysicalLock(payload: MerossPayload): Array<{
    channel: number;
    id?: string;
    childLock?: boolean;
}> {
    return decodeArray(payload, 'lock', 'Control.PhysicalLock').map((item) => {
        if (typeof item.channel !== 'number') {
            throw new ProtocolError('Control.PhysicalLock entry requires channel');
        }
        return {
            channel: item.channel,
            ...(typeof item.subId === 'string' ? { id: item.subId } : {}),
            ...(typeof item.onoff === 'number' ? { childLock: item.onoff === 1 } : {})
        };
    });
}

export function encodeScreenBrightnessSet(options: {
    channel: number;
    standby?: number;
    operation?: number;
    standbyView?: boolean;
    subId?: string;
}): MerossPayload {
    return encodeArray('brightness', {
        channel: options.channel,
        ...(options.subId !== undefined ? { subId: options.subId } : {}),
        ...(options.standby !== undefined ? { standby: options.standby * 100 } : {}),
        ...(options.operation !== undefined ? { operation: options.operation * 100 } : {}),
        ...(options.standbyView !== undefined ? { standbyView: options.standbyView ? 1 : 2 } : {})
    });
}

export function decodeScreenBrightness(payload: MerossPayload): Array<{
    channel: number;
    screenStandbyBrightness?: number;
    screenOperationBrightness?: number;
    screenStandbyView?: boolean;
}> {
    return decodeArray(payload, 'brightness', 'Control.Screen.Brightness').map((item) => {
        if (typeof item.channel !== 'number') {
            throw new ProtocolError('Control.Screen.Brightness entry requires channel');
        }
        return {
            channel: item.channel,
            ...(typeof item.standby === 'number' ? { screenStandbyBrightness: item.standby / 100 } : {}),
            ...(typeof item.operation === 'number' ? { screenOperationBrightness: item.operation / 100 } : {}),
            ...(typeof item.standbyView === 'number' ? { screenStandbyView: item.standbyView === 1 } : {})
        };
    });
}
