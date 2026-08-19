import {
    ALARM_CONFIG_NAMESPACE,
    ALARM_NAMESPACE,
    CALIBRATION_NAMESPACE,
    COMPRESSOR_DELAY_NAMESPACE,
    CTL_RANGE_NAMESPACE,
    DEAD_ZONE_NAMESPACE,
    FROST_NAMESPACE,
    HOLD_ACTION_NAMESPACE,
    HUB_MTS100_ADJUST_NAMESPACE,
    HUB_MTS100_ALL_NAMESPACE,
    HUB_MTS100_CONFIG_NAMESPACE,
    HUB_MTS100_MODE_NAMESPACE,
    HUB_MTS100_SCHEDULEB_NAMESPACE,
    HUB_MTS100_SCHEDULE_NAMESPACE,
    HUB_MTS100_SUPERCTL_NAMESPACE,
    HUB_MTS100_TEMPERATURE_NAMESPACE,
    HUB_MTS100_TIMESYNC_NAMESPACE,
    HUB_TOGGLEX_NAMESPACE,
    OVERHEAT_NAMESPACE,
    SCHEDULEB_NAMESPACE,
    SCHEDULE_NAMESPACE,
    SENSOR_NAMESPACE,
    SUMMER_MODE_NAMESPACE,
    THERMOSTAT_MODEB_NAMESPACE,
    THERMOSTAT_MODEC_NAMESPACE,
    THERMOSTAT_MODE_NAMESPACE,
    TIMER_NAMESPACE,
    WINDOW_OPENED_NAMESPACE,
    TEMP_UNIT_NAMESPACE,
    PHYSICAL_LOCK_NAMESPACE,
    SCREEN_BRIGHTNESS_NAMESPACE,
    decodeAlarm,
    decodeAlarmConfig,
    decodeCalibration,
    decodeCompressorDelay,
    decodeCtlRange,
    decodeDeadZone,
    decodeFrost,
    decodeHoldAction,
    decodeHubAdjust,
    decodeHubConfig,
    decodeHubMts100All,
    decodeHubMts100ModeGetAck,
    decodeHubMts100ModePush,
    decodeHubMts100TemperatureGetAck,
    decodeHubMts100TemperaturePush,
    decodeHubSchedule,
    decodeHubSuperCtl,
    decodeHubTimeSync,
    decodeHubToggleXGetAck,
    decodeHubToggleXPush,
    decodeOverheat,
    decodeSchedule,
    decodeSensorMode,
    decodeSummerMode,
    decodeTempUnit,
    decodePhysicalLock,
    decodeScreenBrightness,
    decodeThermostatModeBGetAck,
    decodeThermostatModeBPush,
    decodeThermostatModeCGetAck,
    decodeThermostatModeCPush,
    decodeThermostatModeGetAck,
    decodeThermostatModePush,
    decodeTimer,
    decodeWindowOpened,
    encodeAlarmConfigSet,
    encodeCalibrationSet,
    encodeCompressorDelaySet,
    encodeCtlRangeSet,
    encodeDeadZoneSet,
    encodeFrostSet,
    encodeHoldActionSet,
    encodeHubAdjustSet,
    encodeHubConfigSet,
    encodeHubIdGet,
    encodeHubMts100ModeGet,
    encodeHubMts100ModeSet,
    encodeHubMts100TemperatureGet,
    encodeHubMts100TemperatureSet,
    encodeHubScheduleSet,
    encodeHubSuperCtlSet,
    encodeHubToggleXGet,
    encodeHubToggleXSet,
    encodeOverheatSet,
    encodePhysicalLockGet,
    encodePhysicalLockSet,
    encodeScheduleSet,
    encodeScreenBrightnessSet,
    encodeSensorModeSet,
    encodeSummerModeSet,
    encodeTempUnitSet,
    encodeThermostatChannelGet,
    encodeThermostatModeBGet,
    encodeThermostatModeBSet,
    encodeThermostatModeCGet,
    encodeThermostatModeCSet,
    encodeThermostatModeGet,
    encodeThermostatModeSet,
    encodeTimerSet,
    encodeWindowOpenedSet,
    type ClimateAlarmKind,
    type ClimateFanSpeed,
    type ClimateHoldMode,
    type ClimateMode,
    type ClimateSchedule,
    type ClimateSensorMode,
    type ClimateTempUnit,
    type ClimateTimer,
    type ClimateWorkMode,
    type MerossMessage,
    type MerossPayload,
    SENSOR_LATEST_NAMESPACE,
    SENSOR_HISTORY_NAMESPACE,
    decodeSensorLatestGetAck,
    decodeSensorLatestPush,
    encodeSensorHistoryGet,
    decodeSensorHistoryGetAck,
    type SensorHistorySample,
    type SensorLatestState
} from '../protocol';
import type { RoutedRequestOptions } from '../transport/router';

export interface ClimatePid {
    grade: number;
    p: number;
    i: number;
    d?: number;
}

export interface ClimateValues {
    on?: boolean;
    mode?: ClimateMode;
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
    windowDetect?: boolean;
    windowOpen?: boolean;
    holdMode?: ClimateHoldMode;
    holdMinutes?: number;
    holdExpiresAt?: number;
    sensorMode?: ClimateSensorMode;
    frost?: boolean;
    frostTemperature?: number;
    calibration?: number;
    overheat?: boolean;
    overheatTemperature?: number;
    deadZone?: number;
    summerMode?: boolean;
    compressorDelay?: boolean;
    compressorDelayMinutes?: number;
    timer?: ClimateTimer;
    alarm?: ClimateAlarmKind;
    alarmTemperature?: number;
    highAlarm?: boolean;
    highAlarmTemperature?: number;
    lowAlarm?: boolean;
    lowAlarmTemperature?: number;
    schedule?: ClimateSchedule;
    custom?: number;
    comfort?: number;
    economy?: number;
    away?: number;
    pid?: ClimatePid;
    superCtl?: boolean;
    superCtlLevel?: number;
    timeSync?: boolean;
    tempUnit?: ClimateTempUnit;
    childLock?: boolean;
    screenStandbyBrightness?: number;
    screenOperationBrightness?: number;
    screenStandbyView?: boolean;
}

type ClimatePatch = ClimateValues & { channel?: number; id?: string };

/** Board thermostat generation; determines which Mode* codec is used. */
export type ThermostatGeneration = 'mode' | 'modeB' | 'modeC';

/**
 * Transport + channel bind for a board thermostat. Session supplies this;
 * trait tests inject a fake request/emit pair.
 */
export interface ClimateTraitBoardBind {
    kind: 'board';
    uuid: string;
    channel: number;
    generation: ThermostatGeneration;
    /** Ability keys; extra methods no-op when the namespace is absent. */
    namespaces?: ReadonlySet<string>;
    request: (options: Omit<RoutedRequestOptions, 'uuid' | 'ip' | 'encryptionKey'>) => Promise<MerossMessage>;
    emitChange: (values: ClimateValues) => void;
}

/**
 * Transport + sub-device bind for a hub MTS100/MTS150 valve child. Session
 * supplies this; trait tests inject a fake request/emit pair.
 */
export interface ClimateTraitHubBind {
    kind: 'hub';
    uuid: string;
    subDeviceId: string;
    /** Ability keys; extra methods no-op when the namespace is absent. */
    namespaces?: ReadonlySet<string>;
    request: (options: Omit<RoutedRequestOptions, 'uuid' | 'ip' | 'encryptionKey'>) => Promise<MerossMessage>;
    emitChange: (values: ClimateValues) => void;
}

export type ClimateTraitBind = ClimateTraitBoardBind | ClimateTraitHubBind;

// MTS100: 0=custom, 1=heat/comfort, 2=cool/economy, 3=auto/schedule, 4=eco/away
const HUB_MODE_FROM_WIRE: Record<number, ClimateMode> = {
    0: 'custom',
    1: 'heat',
    2: 'cool',
    3: 'auto',
    4: 'eco'
};
const HUB_MODE_TO_WIRE: Record<ClimateMode, number> = {
    off: 0,
    custom: 0,
    heat: 1,
    cool: 2,
    auto: 3,
    eco: 4,
    manual: 0
};

const MODEC_MODES = new Set<ClimateMode>(['off', 'heat', 'cool', 'auto']);
const MODE_MODES = new Set<ClimateMode>(['off', 'heat', 'cool', 'auto', 'eco', 'manual']);
const HUB_MODES = new Set<ClimateMode>(['off', 'custom', 'heat', 'cool', 'auto', 'eco', 'manual']);

/**
 * Climate control for one enrolled thermostat or hub valve. Board generation
 * and hub wiring stay in the bind; the host API is the same for both.
 */
export class ClimateTrait {
    private readonly bind: ClimateTraitBind;
    private readonly namespaces: ReadonlySet<string>;
    private last: ClimateValues = {};

    constructor(bind: ClimateTraitBind) {
        this.bind = bind;
        this.namespaces = bind.namespaces ?? new Set();
    }

    /** Fetches initial state. Idempotent; Session calls this once and does not await it. */
    start(): void {
        void this.pollInitial();
    }

    /** Last known on/off. Undefined until initial GET or PUSH fills it. */
    isOn(): boolean | undefined {
        return this.last.on;
    }

    /**
     * Turns the thermostat on or off. Hub valves use Hub.ToggleX.
     */
    async setOn(on: boolean): Promise<{ on: boolean }> {
        if (this.bind.kind === 'hub') {
            await this.bind.request({
                namespace: HUB_TOGGLEX_NAMESPACE,
                method: 'SET',
                payload: encodeHubToggleXSet({ id: this.bind.subDeviceId, on })
            });
        } else if (this.bind.generation === 'modeB') {
            await this.bind.request({
                namespace: THERMOSTAT_MODEB_NAMESPACE,
                method: 'SET',
                payload: encodeThermostatModeBSet({ channel: this.bind.channel, on })
            });
        } else if (this.bind.generation === 'modeC') {
            await this.bind.request({
                namespace: THERMOSTAT_MODEC_NAMESPACE,
                method: 'SET',
                payload: encodeThermostatModeCSet({
                    channel: this.bind.channel,
                    mode: on ? (this.last.mode === 'off' || this.last.mode === undefined ? 'heat' : this.last.mode) : 'off'
                })
            });
        } else {
            await this.bind.request({
                namespace: THERMOSTAT_MODE_NAMESPACE,
                method: 'SET',
                payload: encodeThermostatModeSet({
                    channel: this.bind.channel,
                    mode: on ? (this.last.mode === 'off' || this.last.mode === undefined ? 'heat' : this.last.mode) : 'off'
                })
            });
        }
        this.applyChange(on ? { on } : { on, mode: 'off' });
        return { on };
    }

    /**
     * Sets the thermostat mode. Unsupported modes for this generation are a no-op.
     */
    async setMode(mode: ClimateMode): Promise<{ mode: ClimateMode }> {
        if (this.bind.kind === 'hub') {
            if (!HUB_MODES.has(mode)) {
                return { mode };
            }
            if (mode === 'off') {
                await this.bind.request({
                    namespace: HUB_TOGGLEX_NAMESPACE,
                    method: 'SET',
                    payload: encodeHubToggleXSet({ id: this.bind.subDeviceId, on: false })
                });
                this.applyChange({ mode, on: false });
                return { mode };
            }
            await this.bind.request({
                namespace: HUB_MTS100_MODE_NAMESPACE,
                method: 'SET',
                payload: encodeHubMts100ModeSet({ id: this.bind.subDeviceId, state: HUB_MODE_TO_WIRE[mode] })
            });
            this.applyChange({ mode });
            return { mode };
        }
        if (this.bind.generation === 'modeB') {
            if (mode !== 'off' && mode !== 'heat' && mode !== 'cool') {
                return { mode };
            }
            await this.bind.request({
                namespace: THERMOSTAT_MODEB_NAMESPACE,
                method: 'SET',
                payload: encodeThermostatModeBSet({
                    channel: this.bind.channel,
                    on: mode !== 'off',
                    ...(mode === 'heat' || mode === 'cool' ? { working: mode } : {})
                })
            });
        } else if (this.bind.generation === 'modeC') {
            if (!MODEC_MODES.has(mode)) {
                return { mode };
            }
            await this.bind.request({
                namespace: THERMOSTAT_MODEC_NAMESPACE,
                method: 'SET',
                payload: encodeThermostatModeCSet({ channel: this.bind.channel, mode })
            });
        } else {
            if (!MODE_MODES.has(mode)) {
                return { mode };
            }
            await this.bind.request({
                namespace: THERMOSTAT_MODE_NAMESPACE,
                method: 'SET',
                payload: encodeThermostatModeSet({ channel: this.bind.channel, mode })
            });
        }
        this.applyChange({ mode, on: mode !== 'off' });
        return { mode };
    }

    /**
     * Sets the target temperature in °C. Hub valves use Hub.Mts100.Temperature (custom slot).
     */
    async setTargetTemperature(celsius: number): Promise<{ targetTemperature: number }> {
        if (this.bind.kind === 'hub') {
            await this.bind.request({
                namespace: HUB_MTS100_TEMPERATURE_NAMESPACE,
                method: 'SET',
                payload: encodeHubMts100TemperatureSet({ id: this.bind.subDeviceId, targetTemperature: celsius })
            });
        } else if (this.bind.generation === 'modeC') {
            await this.bind.request({
                namespace: THERMOSTAT_MODEC_NAMESPACE,
                method: 'SET',
                payload: encodeThermostatModeCSet({
                    channel: this.bind.channel,
                    targetTemperature: celsius,
                    mode: this.last.mode
                })
            });
        } else if (this.bind.generation === 'modeB') {
            await this.bind.request({
                namespace: THERMOSTAT_MODEB_NAMESPACE,
                method: 'SET',
                payload: encodeThermostatModeBSet({ channel: this.bind.channel, targetTemperature: celsius })
            });
        } else {
            await this.bind.request({
                namespace: THERMOSTAT_MODE_NAMESPACE,
                method: 'SET',
                payload: encodeThermostatModeSet({ channel: this.bind.channel, targetTemperature: celsius })
            });
        }
        this.applyChange({ targetTemperature: celsius });
        return { targetTemperature: celsius };
    }

    /**
     * Sets ModeB/ModeC work mode. No-op on Mode generation and hub valves.
     */
    async setWorkMode(workMode: ClimateWorkMode): Promise<{ workMode: ClimateWorkMode }> {
        if (this.bind.kind !== 'board') {
            return { workMode };
        }
        if (this.bind.generation === 'modeB') {
            await this.bind.request({
                namespace: THERMOSTAT_MODEB_NAMESPACE,
                method: 'SET',
                payload: encodeThermostatModeBSet({ channel: this.bind.channel, workMode })
            });
        } else if (this.bind.generation === 'modeC') {
            if (workMode === 'timer') {
                return { workMode };
            }
            await this.bind.request({
                namespace: THERMOSTAT_MODEC_NAMESPACE,
                method: 'SET',
                payload: encodeThermostatModeCSet({ channel: this.bind.channel, workMode })
            });
        } else {
            return { workMode };
        }
        this.applyChange({ workMode });
        return { workMode };
    }

    /**
     * Sets the heat setpoint. Hub valves write the comfort slot.
     */
    async setHeatTemperature(celsius: number): Promise<{ heatTemperature: number }> {
        if (this.bind.kind === 'hub') {
            await this.bind.request({
                namespace: HUB_MTS100_TEMPERATURE_NAMESPACE,
                method: 'SET',
                payload: encodeHubMts100TemperatureSet({ id: this.bind.subDeviceId, comfort: celsius })
            });
            this.applyChange({ heatTemperature: celsius, comfort: celsius });
            return { heatTemperature: celsius };
        }
        if (this.bind.generation === 'modeC') {
            await this.bind.request({
                namespace: THERMOSTAT_MODEC_NAMESPACE,
                method: 'SET',
                payload: encodeThermostatModeCSet({ channel: this.bind.channel, heatTemperature: celsius })
            });
        } else if (this.bind.generation === 'modeB') {
            await this.bind.request({
                namespace: THERMOSTAT_MODEB_NAMESPACE,
                method: 'SET',
                payload: encodeThermostatModeBSet({ channel: this.bind.channel, targetTemperature: celsius })
            });
            this.applyChange({ heatTemperature: celsius, targetTemperature: celsius });
            return { heatTemperature: celsius };
        } else {
            await this.bind.request({
                namespace: THERMOSTAT_MODE_NAMESPACE,
                method: 'SET',
                payload: encodeThermostatModeSet({ channel: this.bind.channel, heatTemperature: celsius })
            });
        }
        this.applyChange({ heatTemperature: celsius });
        return { heatTemperature: celsius };
    }

    /**S
     * Sets the cool setpoint. Hub valves write the economy slot.
     */
    async setCoolTemperature(celsius: number): Promise<{ coolTemperature: number }> {
        if (this.bind.kind === 'hub') {
            await this.bind.request({
                namespace: HUB_MTS100_TEMPERATURE_NAMESPACE,
                method: 'SET',
                payload: encodeHubMts100TemperatureSet({ id: this.bind.subDeviceId, economy: celsius })
            });
            this.applyChange({ coolTemperature: celsius, economy: celsius });
            return { coolTemperature: celsius };
        }
        if (this.bind.generation === 'modeC') {
            await this.bind.request({
                namespace: THERMOSTAT_MODEC_NAMESPACE,
                method: 'SET',
                payload: encodeThermostatModeCSet({ channel: this.bind.channel, coolTemperature: celsius })
            });
        } else if (this.bind.generation === 'modeB') {
            await this.bind.request({
                namespace: THERMOSTAT_MODEB_NAMESPACE,
                method: 'SET',
                payload: encodeThermostatModeBSet({ channel: this.bind.channel, targetTemperature: celsius })
            });
            this.applyChange({ coolTemperature: celsius, targetTemperature: celsius });
            return { coolTemperature: celsius };
        } else {
            await this.bind.request({
                namespace: THERMOSTAT_MODE_NAMESPACE,
                method: 'SET',
                payload: encodeThermostatModeSet({ channel: this.bind.channel, coolTemperature: celsius })
            });
        }
        this.applyChange({ coolTemperature: celsius });
        return { coolTemperature: celsius };
    }

    /**
     * Sets the eco setpoint. Hub valves write the away slot.
     */
    async setEcoTemperature(celsius: number): Promise<{ ecoTemperature: number }> {
        if (this.bind.kind === 'hub') {
            await this.bind.request({
                namespace: HUB_MTS100_TEMPERATURE_NAMESPACE,
                method: 'SET',
                payload: encodeHubMts100TemperatureSet({ id: this.bind.subDeviceId, away: celsius })
            });
            this.applyChange({ ecoTemperature: celsius, away: celsius });
            return { ecoTemperature: celsius };
        }
        if (this.bind.kind === 'board' && this.bind.generation === 'mode') {
            await this.bind.request({
                namespace: THERMOSTAT_MODE_NAMESPACE,
                method: 'SET',
                payload: encodeThermostatModeSet({ channel: this.bind.channel, ecoTemperature: celsius })
            });
            this.applyChange({ ecoTemperature: celsius });
        }
        return { ecoTemperature: celsius };
    }

    /**
     * Sets the manual setpoint. Mode generation only.
     */
    async setManualTemperature(celsius: number): Promise<{ manualTemperature: number }> {
        if (this.bind.kind === 'board' && this.bind.generation === 'mode') {
            await this.bind.request({
                namespace: THERMOSTAT_MODE_NAMESPACE,
                method: 'SET',
                payload: encodeThermostatModeSet({ channel: this.bind.channel, manualTemperature: celsius })
            });
            this.applyChange({ manualTemperature: celsius });
        }
        return { manualTemperature: celsius };
    }

    /**
     * Sets fan speed. ModeC only.
     */
    async setFanSpeed(fanSpeed: ClimateFanSpeed, fanHoldMinutes?: number): Promise<{ fanSpeed: ClimateFanSpeed }> {
        if (this.bind.kind !== 'board' || this.bind.generation !== 'modeC') {
            return { fanSpeed };
        }
        await this.bind.request({
            namespace: THERMOSTAT_MODEC_NAMESPACE,
            method: 'SET',
            payload: encodeThermostatModeCSet({
                channel: this.bind.channel,
                fanSpeed,
                ...(fanHoldMinutes !== undefined ? { fanHoldMinutes } : {})
            })
        });
        this.applyChange({
            fanSpeed,
            ...(fanHoldMinutes !== undefined ? { fanHoldMinutes } : {})
        });
        return { fanSpeed };
    }

    /**
     * Enables or disables open-window detection. Board WindowOpened only.
     * Open/closed status is GET/PUSH (`windowOpen` on change).
     */
    async setWindowDetect(detect: boolean): Promise<{ windowDetect: boolean }> {
        if (!this.has(WINDOW_OPENED_NAMESPACE) || this.bind.kind !== 'board') {
            return { windowDetect: detect };
        }
        await this.bind.request({
            namespace: WINDOW_OPENED_NAMESPACE,
            method: 'SET',
            payload: encodeWindowOpenedSet({ channel: this.bind.channel, detect })
        });
        this.applyChange({ windowDetect: detect });
        return { windowDetect: detect };
    }

    /**
     * Sets a temperature hold. No-op unless HoldAction is advertised.
     */
    async setHold(mode: ClimateHoldMode, minutes?: number): Promise<{ holdMode: ClimateHoldMode }> {
        if (!this.has(HOLD_ACTION_NAMESPACE) || this.bind.kind !== 'board') {
            return { holdMode: mode };
        }
        await this.bind.request({
            namespace: HOLD_ACTION_NAMESPACE,
            method: 'SET',
            payload: encodeHoldActionSet({ channel: this.bind.channel, mode, minutes })
        });
        this.applyChange({ holdMode: mode, ...(minutes !== undefined ? { holdMinutes: minutes } : {}) });
        return { holdMode: mode };
    }

    /**
     * Selects internal/external sensor. No-op unless Sensor is advertised.
     */
    async setSensorMode(sensorMode: ClimateSensorMode): Promise<{ sensorMode: ClimateSensorMode }> {
        if (!this.has(SENSOR_NAMESPACE) || this.bind.kind !== 'board') {
            return { sensorMode };
        }
        await this.bind.request({
            namespace: SENSOR_NAMESPACE,
            method: 'SET',
            payload: encodeSensorModeSet({ channel: this.bind.channel, sensorMode })
        });
        this.applyChange({ sensorMode });
        return { sensorMode };
    }

    /**
     * Sets frost protection. No-op unless Frost is advertised.
     */
    async setFrost(frost: boolean, frostTemperature?: number): Promise<{ frost: boolean }> {
        if (!this.has(FROST_NAMESPACE) || this.bind.kind !== 'board') {
            return { frost };
        }
        await this.bind.request({
            namespace: FROST_NAMESPACE,
            method: 'SET',
            payload: encodeFrostSet({
                channel: this.bind.channel,
                frost,
                frostTemperature,
                scale: this.boardScale()
            })
        });
        this.applyChange({ frost, ...(frostTemperature !== undefined ? { frostTemperature } : {}) });
        return { frost };
    }

    /**
     * Sets temperature calibration. Hub valves use Hub.Mts100.Adjust.
     */
    async setCalibration(calibration: number): Promise<{ calibration: number }> {
        if (this.bind.kind === 'hub') {
            if (!this.has(HUB_MTS100_ADJUST_NAMESPACE)) {
                return { calibration };
            }
            await this.bind.request({
                namespace: HUB_MTS100_ADJUST_NAMESPACE,
                method: 'SET',
                payload: encodeHubAdjustSet({ id: this.bind.subDeviceId, calibration })
            });
            this.applyChange({ calibration });
            return { calibration };
        }
        if (!this.has(CALIBRATION_NAMESPACE)) {
            return { calibration };
        }
        await this.bind.request({
            namespace: CALIBRATION_NAMESPACE,
            method: 'SET',
            payload: encodeCalibrationSet({
                channel: this.bind.channel,
                calibration,
                scale: this.boardScale()
            })
        });
        this.applyChange({ calibration });
        return { calibration };
    }

    /**
     * Sets overheat protection. No-op unless Overheat is advertised.
     */
    async setOverheat(overheat: boolean, overheatTemperature?: number): Promise<{ overheat: boolean }> {
        if (!this.has(OVERHEAT_NAMESPACE) || this.bind.kind !== 'board') {
            return { overheat };
        }
        await this.bind.request({
            namespace: OVERHEAT_NAMESPACE,
            method: 'SET',
            payload: encodeOverheatSet({ channel: this.bind.channel, overheat, overheatTemperature })
        });
        this.applyChange({ overheat, ...(overheatTemperature !== undefined ? { overheatTemperature } : {}) });
        return { overheat };
    }

    /**
     * Sets deadband. No-op unless DeadZone is advertised.
     */
    async setDeadZone(deadZone: number): Promise<{ deadZone: number }> {
        if (!this.has(DEAD_ZONE_NAMESPACE) || this.bind.kind !== 'board') {
            return { deadZone };
        }
        await this.bind.request({
            namespace: DEAD_ZONE_NAMESPACE,
            method: 'SET',
            payload: encodeDeadZoneSet({ channel: this.bind.channel, deadZone, scale: this.boardScale() })
        });
        this.applyChange({ deadZone });
        return { deadZone };
    }

    /**
     * Sets summer mode. No-op unless SummerMode is advertised.
     */
    async setSummerMode(summerMode: boolean): Promise<{ summerMode: boolean }> {
        if (!this.has(SUMMER_MODE_NAMESPACE) || this.bind.kind !== 'board') {
            return { summerMode };
        }
        await this.bind.request({
            namespace: SUMMER_MODE_NAMESPACE,
            method: 'SET',
            payload: encodeSummerModeSet({ channel: this.bind.channel, summerMode })
        });
        this.applyChange({ summerMode });
        return { summerMode };
    }

    /**
     * Sets compressor delay. No-op unless CompressorDelay is advertised.
     */
    async setCompressorDelay(
        compressorDelay: boolean,
        compressorDelayMinutes?: number
    ): Promise<{ compressorDelay: boolean }> {
        if (!this.has(COMPRESSOR_DELAY_NAMESPACE) || this.bind.kind !== 'board') {
            return { compressorDelay };
        }
        await this.bind.request({
            namespace: COMPRESSOR_DELAY_NAMESPACE,
            method: 'SET',
            payload: encodeCompressorDelaySet({
                channel: this.bind.channel,
                compressorDelay,
                compressorDelayMinutes
            })
        });
        this.applyChange({
            compressorDelay,
            ...(compressorDelayMinutes !== undefined ? { compressorDelayMinutes } : {})
        });
        return { compressorDelay };
    }

    /**
     * Sets the allowed temperature range. No-op unless CtlRange is advertised.
     */
    async setCtlRange(minTemperature: number, maxTemperature: number): Promise<{
        minTemperature: number;
        maxTemperature: number;
    }> {
        if (!this.has(CTL_RANGE_NAMESPACE) || this.bind.kind !== 'board') {
            return { minTemperature, maxTemperature };
        }
        await this.bind.request({
            namespace: CTL_RANGE_NAMESPACE,
            method: 'SET',
            payload: encodeCtlRangeSet({ channel: this.bind.channel, minTemperature, maxTemperature })
        });
        this.applyChange({ minTemperature, maxTemperature });
        return { minTemperature, maxTemperature };
    }

    /**
     * Sets the timer. No-op unless Timer is advertised.
     */
    async setTimer(timer: ClimateTimer): Promise<{ timer: ClimateTimer }> {
        if (!this.has(TIMER_NAMESPACE) || this.bind.kind !== 'board') {
            return { timer };
        }
        await this.bind.request({
            namespace: TIMER_NAMESPACE,
            method: 'SET',
            payload: encodeTimerSet({ channel: this.bind.channel, timer })
        });
        this.applyChange({ timer });
        return { timer };
    }

    /**
     * Sets high/low alarm config. No-op unless AlarmConfig is advertised.
     */
    async setAlarmConfig(options: {
        highAlarm?: boolean;
        highAlarmTemperature?: number;
        lowAlarm?: boolean;
        lowAlarmTemperature?: number;
    }): Promise<typeof options> {
        if (!this.has(ALARM_CONFIG_NAMESPACE) || this.bind.kind !== 'board') {
            return options;
        }
        await this.bind.request({
            namespace: ALARM_CONFIG_NAMESPACE,
            method: 'SET',
            payload: encodeAlarmConfigSet({ channel: this.bind.channel, ...options })
        });
        this.applyChange(options);
        return options;
    }

    /**
     * Sets the on-device temperature unit. Host temperatures stay °C.
     * No-op unless TempUnit is advertised (board thermostats only).
     */
    async setTempUnit(tempUnit: ClimateTempUnit): Promise<{ tempUnit: ClimateTempUnit }> {
        if (!this.has(TEMP_UNIT_NAMESPACE) || this.bind.kind !== 'board') {
            return { tempUnit };
        }
        await this.bind.request({
            namespace: TEMP_UNIT_NAMESPACE,
            method: 'SET',
            payload: encodeTempUnitSet({ channel: this.bind.channel, tempUnit })
        });
        this.applyChange({ tempUnit });
        return { tempUnit };
    }

    /**
     * Enables or disables the physical child lock. No-op unless PhysicalLock is advertised.
     */
    async setChildLock(locked: boolean): Promise<{ childLock: boolean }> {
        if (!this.has(PHYSICAL_LOCK_NAMESPACE)) {
            return { childLock: locked };
        }
        const channel = this.bind.kind === 'board' ? this.bind.channel : 0;
        const subId = this.bind.kind === 'hub' ? this.bind.subDeviceId : undefined;
        await this.bind.request({
            namespace: PHYSICAL_LOCK_NAMESPACE,
            method: 'SET',
            payload: encodePhysicalLockSet({ channel, locked, subId })
        });
        this.applyChange({ childLock: locked });
        return { childLock: locked };
    }

    /**
     * Sets display brightness (0–1). No-op unless Screen.Brightness is advertised (board only).
     */
    async setScreenBrightness(options: {
        standby?: number;
        operation?: number;
        standbyView?: boolean;
    }): Promise<typeof options> {
        if (!this.has(SCREEN_BRIGHTNESS_NAMESPACE) || this.bind.kind !== 'board') {
            return options;
        }
        await this.bind.request({
            namespace: SCREEN_BRIGHTNESS_NAMESPACE,
            method: 'SET',
            payload: encodeScreenBrightnessSet({ channel: this.bind.channel, ...options })
        });
        this.applyChange({
            ...(options.standby !== undefined ? { screenStandbyBrightness: options.standby } : {}),
            ...(options.operation !== undefined ? { screenOperationBrightness: options.operation } : {}),
            ...(options.standbyView !== undefined ? { screenStandbyView: options.standbyView } : {})
        });
        return options;
    }

    /**
     * Fetches stored sensor history samples. On-demand only; returns
     * `undefined` when Sensor.History is not advertised or the bind is a hub valve.
     */
    async getHistory(options?: { capacity?: number }): Promise<SensorHistorySample[] | undefined> {
        if (!this.has(SENSOR_HISTORY_NAMESPACE) || this.bind.kind !== 'board') {
            return undefined;
        }
        const channel = this.bind.channel;
        const reply = await this.bind.request({
            namespace: SENSOR_HISTORY_NAMESPACE,
            method: 'GET',
            payload: encodeSensorHistoryGet({
                channel,
                capacity: options?.capacity
            })
        });
        const match = decodeSensorHistoryGetAck(reply.payload, this.boardScale())
            .find((entry) => entry.channel === channel);
        return match?.samples;
    }

    /**
     * Sets the weekly schedule. Prefers ScheduleB when both are advertised.
     */
    async setSchedule(schedule: ClimateSchedule): Promise<{ schedule: ClimateSchedule }> {
        if (this.bind.kind === 'hub') {
            const ns = this.has(HUB_MTS100_SCHEDULEB_NAMESPACE)
                ? HUB_MTS100_SCHEDULEB_NAMESPACE
                : this.has(HUB_MTS100_SCHEDULE_NAMESPACE)
                    ? HUB_MTS100_SCHEDULE_NAMESPACE
                    : undefined;
            if (!ns) {
                return { schedule };
            }
            await this.bind.request({
                namespace: ns,
                method: 'SET',
                payload: encodeHubScheduleSet({ id: this.bind.subDeviceId, schedule, scale: 10 })
            });
            this.applyChange({ schedule });
            return { schedule };
        }
        const ns = this.has(SCHEDULEB_NAMESPACE)
            ? SCHEDULEB_NAMESPACE
            : this.has(SCHEDULE_NAMESPACE)
                ? SCHEDULE_NAMESPACE
                : undefined;
        if (!ns) {
            return { schedule };
        }
        await this.bind.request({
            namespace: ns,
            method: 'SET',
            payload: encodeScheduleSet({
                channel: this.bind.channel,
                schedule,
                scale: ns === SCHEDULEB_NAMESPACE ? 100 : 10,
                key: ns === SCHEDULEB_NAMESPACE ? 'scheduleB' : 'schedule'
            })
        });
        this.applyChange({ schedule });
        return { schedule };
    }

    /**
     * Sets hub valve PID config. No-op unless Hub.Mts100.Config is advertised.
     */
    async setConfig(pid: ClimatePid): Promise<{ pid: ClimatePid }> {
        if (!this.has(HUB_MTS100_CONFIG_NAMESPACE) || this.bind.kind !== 'hub') {
            return { pid };
        }
        await this.bind.request({
            namespace: HUB_MTS100_CONFIG_NAMESPACE,
            method: 'SET',
            payload: encodeHubConfigSet({ id: this.bind.subDeviceId, pid })
        });
        this.applyChange({ pid });
        return { pid };
    }

    /**
     * Sets hub SuperCtl. No-op unless Hub.Mts100.SuperCtl is advertised.
     */
    async setSuperCtl(superCtl: boolean, superCtlLevel?: number): Promise<{ superCtl: boolean }> {
        if (!this.has(HUB_MTS100_SUPERCTL_NAMESPACE) || this.bind.kind !== 'hub') {
            return { superCtl };
        }
        await this.bind.request({
            namespace: HUB_MTS100_SUPERCTL_NAMESPACE,
            method: 'SET',
            payload: encodeHubSuperCtlSet({
                id: this.bind.subDeviceId,
                superCtl,
                superCtlLevel
            })
        });
        this.applyChange({ superCtl, ...(superCtlLevel !== undefined ? { superCtlLevel } : {}) });
        return { superCtl };
    }

    /**
     * Applies a firmware PUSH for this endpoint.
     */
    handlePush(message: MerossMessage): void {
        const uuid = message.header.uuid
            ?? /^\/appliance\/([^/]+)\//.exec(message.header.from)?.[1];
        if (!uuid || uuid !== this.bind.uuid) {
            return;
        }
        const ns = message.header.namespace;
        const payload = message.payload;

        if (this.bind.kind === 'hub') {
            this.handleHubPush(ns, payload);
            return;
        }
        this.handleBoardPush(ns, payload);
    }

    private handleHubPush(ns: string, payload: MerossPayload): void {
        if (this.bind.kind !== 'hub') {
            return;
        }
        const subId = this.bind.subDeviceId;
        if (ns === HUB_TOGGLEX_NAMESPACE) {
            this.applyMatching(decodeHubToggleXPush(payload).map((entry) => ({
                id: entry.id,
                on: entry.on
            })));
            return;
        }
        if (ns === HUB_MTS100_MODE_NAMESPACE) {
            this.applyMatching(decodeHubMts100ModePush(payload).map((entry) => ({
                id: entry.id,
                mode: HUB_MODE_FROM_WIRE[entry.state] ?? 'custom'
            })));
            return;
        }
        if (ns === HUB_MTS100_TEMPERATURE_NAMESPACE) {
            this.applyMatching(decodeHubMts100TemperaturePush(payload));
            return;
        }
        if (ns === HUB_MTS100_SUPERCTL_NAMESPACE && this.has(ns)) {
            this.applyMatching(decodeHubSuperCtl(payload).filter((entry) => entry.id === subId));
            return;
        }
        if ((ns === HUB_MTS100_SCHEDULE_NAMESPACE || ns === HUB_MTS100_SCHEDULEB_NAMESPACE) && this.has(ns)) {
            this.applyMatching(decodeHubSchedule(payload, 10).filter((entry) => entry.id === subId));
            return;
        }
        if (ns === HUB_MTS100_TIMESYNC_NAMESPACE && this.has(ns)) {
            this.applyMatching(decodeHubTimeSync(payload).filter((entry) => entry.id === subId));
            return;
        }
        if (ns === PHYSICAL_LOCK_NAMESPACE && this.has(ns)) {
            this.applyMatching(decodePhysicalLock(payload).filter((entry) => entry.id === subId));
        }
    }

    private handleBoardPush(ns: string, payload: MerossPayload): void {
        if (this.bind.kind !== 'board') {
            return;
        }
        const generation = this.bind.generation;
        if (ns === THERMOSTAT_MODE_NAMESPACE && generation === 'mode') {
            this.applyMatching(decodeThermostatModePush(payload));
            return;
        }
        if (ns === THERMOSTAT_MODEB_NAMESPACE && generation === 'modeB') {
            this.applyMatching(decodeThermostatModeBPush(payload));
            return;
        }
        if (ns === THERMOSTAT_MODEC_NAMESPACE && generation === 'modeC') {
            this.applyMatching(decodeThermostatModeCPush(payload));
            return;
        }
        if (!this.has(ns)) {
            return;
        }
        const scale = this.boardScale();
        if (ns === HOLD_ACTION_NAMESPACE) {
            this.applyMatching(decodeHoldAction(payload));
            return;
        }
        if (ns === WINDOW_OPENED_NAMESPACE) {
            this.applyMatching(decodeWindowOpened(payload));
            return;
        }
        if (ns === SENSOR_NAMESPACE) {
            this.applyMatching(decodeSensorMode(payload));
            return;
        }
        if (ns === FROST_NAMESPACE) {
            this.applyMatching(decodeFrost(payload, scale));
            return;
        }
        if (ns === CALIBRATION_NAMESPACE) {
            this.applyMatching(decodeCalibration(payload, scale));
            return;
        }
        if (ns === OVERHEAT_NAMESPACE) {
            this.applyMatching(decodeOverheat(payload));
            return;
        }
        if (ns === DEAD_ZONE_NAMESPACE) {
            this.applyMatching(decodeDeadZone(payload, scale));
            return;
        }
        if (ns === SUMMER_MODE_NAMESPACE) {
            this.applyMatching(decodeSummerMode(payload));
            return;
        }
        if (ns === COMPRESSOR_DELAY_NAMESPACE) {
            this.applyMatching(decodeCompressorDelay(payload));
            return;
        }
        if (ns === CTL_RANGE_NAMESPACE) {
            this.applyMatching(decodeCtlRange(payload));
            return;
        }
        if (ns === TIMER_NAMESPACE) {
            this.applyMatching(decodeTimer(payload));
            return;
        }
        if (ns === ALARM_NAMESPACE) {
            this.applyMatching(decodeAlarm(payload));
            return;
        }
        if (ns === ALARM_CONFIG_NAMESPACE) {
            this.applyMatching(decodeAlarmConfig(payload));
            return;
        }
        if (ns === SCHEDULE_NAMESPACE) {
            this.applyMatching(decodeSchedule(payload, 10, 'schedule'));
            return;
        }
        if (ns === SCHEDULEB_NAMESPACE) {
            this.applyMatching(decodeSchedule(payload, 100, 'scheduleB'));
            return;
        }
        if (ns === TEMP_UNIT_NAMESPACE) {
            this.applyMatching(decodeTempUnit(payload));
            return;
        }
        if (ns === PHYSICAL_LOCK_NAMESPACE) {
            this.applyMatching(decodePhysicalLock(payload));
            return;
        }
        if (ns === SCREEN_BRIGHTNESS_NAMESPACE) {
            this.applyMatching(decodeScreenBrightness(payload));
            return;
        }
        if (ns === SENSOR_LATEST_NAMESPACE) {
            this.applyMatching(decodeSensorLatestPush(payload, scale).map(sensorLatestToClimatePatch));
            return;
        }
    }

    private async pollInitial(): Promise<void> {
        try {
            if (this.bind.kind === 'hub') {
                await this.pollHub();
                return;
            }
            await this.pollBoard();
        } catch {
            // Next PUSH or setter call will recover.
        }
    }

    private async pollBoard(): Promise<void> {
        if (this.bind.kind !== 'board') {
            return;
        }
        const channel = this.bind.channel;
        if (this.bind.generation === 'modeC') {
            const reply = await this.bind.request({
                namespace: THERMOSTAT_MODEC_NAMESPACE,
                method: 'GET',
                payload: encodeThermostatModeCGet({ channel })
            });
            this.applyMatching(decodeThermostatModeCGetAck(reply.payload));
        } else if (this.bind.generation === 'modeB') {
            const reply = await this.bind.request({
                namespace: THERMOSTAT_MODEB_NAMESPACE,
                method: 'GET',
                payload: encodeThermostatModeBGet({ channel })
            });
            this.applyMatching(decodeThermostatModeBGetAck(reply.payload));
        } else {
            const reply = await this.bind.request({
                namespace: THERMOSTAT_MODE_NAMESPACE,
                method: 'GET',
                payload: encodeThermostatModeGet({ channel })
            });
            this.applyMatching(decodeThermostatModeGetAck(reply.payload));
        }
        await this.pollBoardExtras();
    }

    private async pollBoardExtras(): Promise<void> {
        if (this.bind.kind !== 'board') {
            return;
        }
        const scale = this.boardScale();
        await Promise.all([
            this.pollNs(HOLD_ACTION_NAMESPACE, 'holdAction', decodeHoldAction),
            this.pollNs(WINDOW_OPENED_NAMESPACE, 'windowOpened', decodeWindowOpened),
            this.pollNs(SENSOR_NAMESPACE, 'sensor', decodeSensorMode),
            this.pollNs(FROST_NAMESPACE, 'frost', (payload) => decodeFrost(payload, scale)),
            this.pollNs(CALIBRATION_NAMESPACE, 'calibration', (payload) => decodeCalibration(payload, scale)),
            this.pollNs(OVERHEAT_NAMESPACE, 'overheat', decodeOverheat),
            this.pollNs(DEAD_ZONE_NAMESPACE, 'deadZone', (payload) => decodeDeadZone(payload, scale)),
            this.pollNs(SUMMER_MODE_NAMESPACE, 'summerMode', decodeSummerMode),
            this.pollNs(COMPRESSOR_DELAY_NAMESPACE, 'delay', decodeCompressorDelay),
            this.pollNs(CTL_RANGE_NAMESPACE, 'ctlRange', decodeCtlRange),
            this.pollNs(TIMER_NAMESPACE, 'timer', decodeTimer),
            this.pollNs(ALARM_NAMESPACE, 'alarm', decodeAlarm),
            this.pollNs(ALARM_CONFIG_NAMESPACE, 'alarmConfig', decodeAlarmConfig),
            this.pollNs(SCHEDULE_NAMESPACE, 'schedule', (payload) => decodeSchedule(payload, 10, 'schedule')),
            this.pollNs(SCHEDULEB_NAMESPACE, 'scheduleB', (payload) => decodeSchedule(payload, 100, 'scheduleB')),
            this.pollNs(TEMP_UNIT_NAMESPACE, 'tempUnit', decodeTempUnit),
            this.pollNs(PHYSICAL_LOCK_NAMESPACE, 'lock', decodePhysicalLock),
            this.pollNs(SCREEN_BRIGHTNESS_NAMESPACE, 'brightness', decodeScreenBrightness),
            this.pollNs(
                SENSOR_LATEST_NAMESPACE,
                'latest',
                (payload) => decodeSensorLatestGetAck(payload, scale).map(sensorLatestToClimatePatch)
            )
        ]);
    }

    private async pollHub(): Promise<void> {
        if (this.bind.kind !== 'hub') {
            return;
        }
        const subId = this.bind.subDeviceId;
        if (this.has(HUB_MTS100_ALL_NAMESPACE)) {
            try {
                const reply = await this.bind.request({
                    namespace: HUB_MTS100_ALL_NAMESPACE,
                    method: 'GET',
                    payload: encodeHubIdGet('all', subId)
                });
                for (const entry of decodeHubMts100All(reply.payload)) {
                    if (entry.id !== subId) {
                        continue;
                    }
                    const { id: _id, modeRaw, ...rest } = entry;
                    this.applyChange({
                        ...rest,
                        ...(modeRaw !== undefined ? { mode: HUB_MODE_FROM_WIRE[modeRaw] ?? 'custom' } : {})
                    });
                }
            } catch {
                await this.pollHubFallback();
            }
        } else {
            await this.pollHubFallback();
        }
        await this.pollHubExtras();
    }

    private async pollHubFallback(): Promise<void> {
        if (this.bind.kind !== 'hub') {
            return;
        }
        const subId = this.bind.subDeviceId;
        const [toggleAck, modeAck, tempAck] = await Promise.all([
            this.bind.request({
                namespace: HUB_TOGGLEX_NAMESPACE,
                method: 'GET',
                payload: encodeHubToggleXGet({ id: subId })
            }),
            this.bind.request({
                namespace: HUB_MTS100_MODE_NAMESPACE,
                method: 'GET',
                payload: encodeHubMts100ModeGet({ id: subId })
            }),
            this.bind.request({
                namespace: HUB_MTS100_TEMPERATURE_NAMESPACE,
                method: 'GET',
                payload: encodeHubMts100TemperatureGet({ id: subId })
            })
        ]);
        this.applyMatching(decodeHubToggleXGetAck(toggleAck.payload));
        this.applyMatching(decodeHubMts100ModeGetAck(modeAck.payload).map((entry) => ({
            id: entry.id,
            mode: HUB_MODE_FROM_WIRE[entry.state] ?? 'custom'
        })));
        this.applyMatching(decodeHubMts100TemperatureGetAck(tempAck.payload));
    }

    private async pollHubExtras(): Promise<void> {
        if (this.bind.kind !== 'hub') {
            return;
        }
        await Promise.all([
            this.pollHubNs(HUB_MTS100_ADJUST_NAMESPACE, 'adjust', decodeHubAdjust),
            this.pollHubNs(HUB_MTS100_CONFIG_NAMESPACE, 'config', decodeHubConfig),
            this.pollHubNs(HUB_MTS100_SUPERCTL_NAMESPACE, 'superCtl', decodeHubSuperCtl),
            this.pollHubNs(HUB_MTS100_TIMESYNC_NAMESPACE, 'timeSync', decodeHubTimeSync),
            this.pollHubNs(
                this.has(HUB_MTS100_SCHEDULEB_NAMESPACE)
                    ? HUB_MTS100_SCHEDULEB_NAMESPACE
                    : HUB_MTS100_SCHEDULE_NAMESPACE,
                'schedule',
                (payload) => decodeHubSchedule(payload, 10)
            ),
            this.pollPhysicalLock()
        ]);
    }

    private async pollPhysicalLock(): Promise<void> {
        if (!this.has(PHYSICAL_LOCK_NAMESPACE)) {
            return;
        }
        try {
            const payload = this.bind.kind === 'hub'
                ? encodePhysicalLockGet({ channel: 0, subId: this.bind.subDeviceId })
                : encodePhysicalLockGet({ channel: this.bind.channel });
            const reply = await this.bind.request({
                namespace: PHYSICAL_LOCK_NAMESPACE,
                method: 'GET',
                payload
            });
            this.applyMatching(decodePhysicalLock(reply.payload));
        } catch {
            // Next PUSH or setter call will recover.
        }
    }

    private async pollNs(
        namespace: string,
        key: string,
        decode: (payload: MerossPayload) => ClimatePatch[]
    ): Promise<void> {
        if (!this.has(namespace) || this.bind.kind !== 'board') {
            return;
        }
        try {
            const reply = await this.bind.request({
                namespace,
                method: 'GET',
                payload: encodeThermostatChannelGet(key, this.bind.channel)
            });
            this.applyMatching(decode(reply.payload));
        } catch {
            // Next PUSH or setter call will recover.
        }
    }

    private async pollHubNs(
        namespace: string,
        key: string,
        decode: (payload: MerossPayload) => ClimatePatch[]
    ): Promise<void> {
        if (!this.has(namespace) || this.bind.kind !== 'hub') {
            return;
        }
        try {
            const reply = await this.bind.request({
                namespace,
                method: 'GET',
                payload: encodeHubIdGet(key, this.bind.subDeviceId)
            });
            this.applyMatching(decode(reply.payload));
        } catch {
            // Next PUSH or setter call will recover.
        }
    }

    private applyMatching(entries: ClimatePatch[]): void {
        for (const entry of entries) {
            if (this.bind.kind === 'board' && entry.channel !== undefined && entry.channel !== this.bind.channel) {
                continue;
            }
            if (this.bind.kind === 'hub' && entry.id !== undefined && entry.id !== this.bind.subDeviceId) {
                continue;
            }
            const { channel: _channel, id: _id, ...patch } = entry;
            this.applyChange(patch);
        }
    }

    private applyChange(patch: ClimateValues): void {
        const next: ClimateValues = {};
        for (const key of Object.keys(patch) as Array<keyof ClimateValues>) {
            const value = patch[key];
            if (value === undefined) {
                continue;
            }
            const previous = this.last[key];
            const changed = typeof value === 'object'
                ? JSON.stringify(previous) !== JSON.stringify(value)
                : previous !== value;
            if (!changed) {
                continue;
            }
            (this.last as Record<string, unknown>)[key] = value;
            (next as Record<string, unknown>)[key] = value;
        }
        if (Object.keys(next).length > 0) {
            this.bind.emitChange(next);
        }
    }

    private has(namespace: string): boolean {
        return this.namespaces.has(namespace);
    }

    private boardScale(): number {
        return this.bind.kind === 'board' && this.bind.generation === 'mode' ? 10 : 100;
    }
}

function sensorLatestToClimatePatch(entry: SensorLatestState): ClimatePatch {
    const patch: ClimatePatch = { channel: entry.channel };
    if (entry.humidity !== undefined) {
        patch.humidity = entry.humidity;
    }
    if (entry.temperature !== undefined) {
        patch.currentTemperature = entry.temperature;
    }
    return patch;
}
