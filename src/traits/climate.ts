import {
    ALARM_CONFIG_NAMESPACE,
    ALARM_NAMESPACE,
    CALIBRATION_NAMESPACE,
    COMPRESSOR_DELAY_NAMESPACE,
    CONFIG_SENSOR_ASSOCIATION_NAMESPACE,
    CONTROL_ALERT_CONFIG_NAMESPACE,
    CONTROL_ALERT_REPORT_NAMESPACE,
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
    HUB_EXCEPTION_NAMESPACE,
    HUB_SUBDEVICE_VERSION_NAMESPACE,
    OVERHEAT_NAMESPACE,
    SCHEDULEB_NAMESPACE,
    SCHEDULE_NAMESPACE,
    SENSOR_NAMESPACE,
    SUMMER_MODE_NAMESPACE,
    THERMOSTAT_MODEB_NAMESPACE,
    THERMOSTAT_MODEC_NAMESPACE,
    THERMOSTAT_MODE_NAMESPACE,
    THERMOSTAT_SYSTEM_NAMESPACE,
    TIMER_NAMESPACE,
    WINDOW_OPENED_NAMESPACE,
    TEMP_UNIT_NAMESPACE,
    PHYSICAL_LOCK_NAMESPACE,
    SCREEN_BRIGHTNESS_NAMESPACE,
    decodeAlarm,
    decodeAlarmConfig,
    decodeAlertConfigPush,
    decodeAlertReportPush,
    decodeCalibration,
    decodeCompressorDelay,
    decodeCtlRange,
    decodeDeadZone,
    decodeFrost,
    decodeHoldAction,
    decodeHubAdjust,
    decodeHubConfig,
    decodeHubMts100All,
    decodeHubMts100ModePush,
    decodeHubMts100TemperaturePush,
    decodeHubSchedule,
    decodeHubSuperCtl,
    decodeHubTimeSync,
    decodeHubToggleXPush,
    decodeHubExceptionPush,
    decodeHubSubDeviceVersionPush,
    decodeOverheat,
    decodeSchedule,
    decodeSensorAssociationPush,
    decodeSensorMode,
    decodeSummerMode,
    decodeTempUnit,
    decodePhysicalLock,
    decodeScreenBrightness,
    decodeThermostatModeBPush,
    decodeThermostatModeCPush,
    decodeThermostatModePush,
    decodeThermostatSystemPush,
    decodeTimer,
    decodeWindowOpened,
    encodeAlarmConfigSet,
    encodeAlertConfigSet,
    encodeCalibrationSet,
    encodeCompressorDelaySet,
    encodeCtlRangeSet,
    encodeDeadZoneSet,
    encodeFrostSet,
    encodeHoldActionSet,
    encodeHubAdjustSet,
    encodeHubConfigSet,
    encodeHubMts100ModeSet,
    encodeHubMts100TemperatureSet,
    encodeHubScheduleSet,
    encodeHubSuperCtlSet,
    encodeHubToggleXSet,
    encodeOverheatSet,
    encodePhysicalLockSet,
    encodeScheduleSet,
    encodeScreenBrightnessSet,
    encodeSensorAssociationSet,
    encodeSensorModeSet,
    encodeSummerModeSet,
    encodeTempUnitSet,
    encodeThermostatModeBSet,
    encodeThermostatModeCSet,
    encodeThermostatModeSet,
    encodeThermostatSystemSet,
    encodeTimerSet,
    encodeWindowOpenedSet,
    type ClimateAlarmKind,
    type ClimateFanSpeed,
    type ClimateHoldMode,
    type ClimateMode,
    type ClimateSchedule,
    type ClimateSensorMode,
    type ClimateSystem,
    type ClimateSystemWire,
    type ClimateTempUnit,
    type ClimateTimer,
    type ClimateWorkMode,
    type MerossMessage,
    type MerossPayload,
    SENSOR_LATEST_NAMESPACE,
    SENSOR_HISTORY_NAMESPACE,
    SENSOR_HISTORYX_NAMESPACE,
    decodeSensorLatestPush,
    encodeSensorHistoryGet,
    decodeSensorHistoryGetAck,
    encodeSensorHistoryXGet,
    decodeSensorHistoryXGetAck,
    type SensorHistorySample,
    type SensorHistoryXState,
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
    compTemp?: number;
    compTempEnable?: boolean;
    wire?: ClimateSystemWire;
    fault?: number;
    firmwareVersion?: string;
    hardwareVersion?: string;
    alertConfigType?: number;
    alertConfig?: Record<string, unknown>;
    alertReport?: Record<string, unknown>;
    /** Config.Sensor.Association `temp.association` (2 = internal on MTS300). */
    tempAssociation?: number;
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

/**
 * MTS100 Mode.state: 0=custom, 1=heat/comfort, 2=cool/economy, 3=auto/schedule, 4=eco/away.
 * Off is Hub.ToggleX, not a Mode state. `manual` has no hub wire value.
 */
const HUB_MODE_FROM_WIRE: Record<number, ClimateMode> = {
    0: 'custom',
    1: 'heat',
    2: 'cool',
    3: 'auto',
    4: 'eco'
};
const HUB_MODE_TO_WIRE: Partial<Record<ClimateMode, number>> = {
    custom: 0,
    heat: 1,
    cool: 2,
    auto: 3,
    eco: 4
};

const MODEC_MODES = new Set<ClimateMode>(['off', 'heat', 'cool', 'auto']);
const MODE_MODES = new Set<ClimateMode>(['off', 'heat', 'cool', 'auto', 'eco', 'manual']);

/**
 * Climate control for one enrolled thermostat or hub valve. Board generation
 * and hub wiring stay in the bind; the host API is the same for both.
 * DevicePoller owns the schedule.
 */
export class ClimateTrait {
    private readonly bind: ClimateTraitBind;
    private readonly namespaces: ReadonlySet<string>;
    private last: ClimateValues = {};
    private lastSystem: ClimateSystem | undefined;

    constructor(bind: ClimateTraitBind) {
        this.bind = bind;
        this.namespaces = bind.namespaces ?? new Set();
    }

    /** Undefined until poller GETACK or PUSH fills it. */
    isOn(): boolean | undefined {
        return this.last.on;
    }

    /**
     * Hub valves use Hub.ToggleX; board ModeC/Mode map off onto mode rather than a separate toggle.
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
     * Unsupported modes for this generation are a no-op. Hub `off` is ToggleX, not Mode.state.
     */
    async setMode(mode: ClimateMode): Promise<{ mode: ClimateMode }> {
        if (this.bind.kind === 'hub') {
            if (mode === 'off') {
                await this.bind.request({
                    namespace: HUB_TOGGLEX_NAMESPACE,
                    method: 'SET',
                    payload: encodeHubToggleXSet({ id: this.bind.subDeviceId, on: false })
                });
                this.applyChange({ mode, on: false });
                return { mode };
            }
            const state = HUB_MODE_TO_WIRE[mode];
            if (state === undefined) {
                return { mode };
            }
            await this.bind.request({
                namespace: HUB_MTS100_MODE_NAMESPACE,
                method: 'SET',
                payload: encodeHubMts100ModeSet({ id: this.bind.subDeviceId, state })
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
     * Hub valves write the custom Temperature slot; board generations use Mode/ModeB/ModeC.
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
     * No-op on Mode generation and hub valves.
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
     * Hub valves write the comfort slot.
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

    /**
     * Hub valves write the economy slot; board ModeB maps this onto the shared target.
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
     * Hub valves write the away slot.
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
     * Mode generation only; other binds are a no-op.
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
     * ModeC only; other binds are a no-op.
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
     * Board WindowOpened only. Open/closed status is GET/PUSH (`windowOpen` on change).
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
     * No-op unless HoldAction is advertised.
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
     * No-op unless Sensor is advertised.
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
     * No-op unless Frost is advertised.
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
     * Hub valves use Hub.Mts100.Adjust.
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
     * No-op unless Overheat is advertised.
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
     * No-op unless DeadZone is advertised.
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
     * No-op unless SummerMode is advertised.
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
     * No-op unless CompressorDelay is advertised.
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
     * No-op unless CtlRange is advertised.
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
     * No-op unless Timer is advertised.
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
     * No-op unless AlarmConfig is advertised.
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
     * SET Control.AlertConfig for this channel. No-op when absent (MTS300).
     */
    async setAlertConfig(options: {
        type?: number;
        value?: Record<string, unknown>;
    }): Promise<typeof options> {
        if (!this.has(CONTROL_ALERT_CONFIG_NAMESPACE) || this.bind.kind !== 'board') {
            return options;
        }
        await this.bind.request({
            namespace: CONTROL_ALERT_CONFIG_NAMESPACE,
            method: 'SET',
            payload: encodeAlertConfigSet({
                channel: this.bind.channel,
                ...options
            })
        });
        this.applyChange({
            ...(options.type !== undefined ? { alertConfigType: options.type } : {}),
            ...(options.value !== undefined ? { alertConfig: options.value } : {})
        });
        return options;
    }

    /**
     * SET Config.Sensor.Association temp binding. No-op when absent (MTS300).
     */
    async setTempAssociation(tempAssociation: number): Promise<{ tempAssociation: number }> {
        if (!this.has(CONFIG_SENSOR_ASSOCIATION_NAMESPACE) || this.bind.kind !== 'board') {
            return { tempAssociation };
        }
        await this.bind.request({
            namespace: CONFIG_SENSOR_ASSOCIATION_NAMESPACE,
            method: 'SET',
            payload: encodeSensorAssociationSet({
                channel: this.bind.channel,
                tempAssociation
            })
        });
        this.applyChange({ tempAssociation });
        return { tempAssociation };
    }

    /**
     * Host temperatures stay °C. No-op unless TempUnit is advertised (board thermostats only).
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
     * No-op unless PhysicalLock is advertised.
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
     * Host range is 0–1. No-op unless Screen.Brightness is advertised (board only).
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
     * On-demand only. Returns `undefined` when Sensor.History is not advertised or the bind is a hub valve.
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
     * On-demand only. Returns `undefined` when Sensor.HistoryX is not advertised or the bind is a hub valve.
     */
    async getHistoryX(): Promise<SensorHistoryXState | undefined> {
        if (!this.has(SENSOR_HISTORYX_NAMESPACE) || this.bind.kind !== 'board') {
            return undefined;
        }
        const channel = this.bind.channel;
        const reply = await this.bind.request({
            namespace: SENSOR_HISTORYX_NAMESPACE,
            method: 'GET',
            payload: encodeSensorHistoryXGet({ channel, keys: [] })
        });
        return decodeSensorHistoryXGetAck(reply.payload, this.boardScale())
            .find((entry) => entry.channel === channel);
    }

    /**
     * Does not GET — MTS300 GET can disconnect.
     */
    getSystem(): ClimateSystem | undefined {
        return this.lastSystem;
    }

    /**
     * No-op unless System is advertised.
     */
    async setSystem(patch: ClimateSystem): Promise<ClimateSystem> {
        if (!this.has(THERMOSTAT_SYSTEM_NAMESPACE) || this.bind.kind !== 'board') {
            return patch;
        }
        await this.bind.request({
            namespace: THERMOSTAT_SYSTEM_NAMESPACE,
            method: 'SET',
            payload: encodeThermostatSystemSet({ channel: this.bind.channel, ...patch })
        });
        this.lastSystem = { ...this.lastSystem, ...patch };
        this.applyChange(systemToClimateValues(patch));
        return this.lastSystem;
    }

    /**
     * Prefers ScheduleB when both are advertised.
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
     * No-op unless Hub.Mts100.Config is advertised.
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
     * No-op unless Hub.Mts100.SuperCtl is advertised.
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

    handlePush(message: MerossMessage): void {
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
        if (ns === HUB_MTS100_ALL_NAMESPACE && this.has(ns)) {
            for (const entry of decodeHubMts100All(payload)) {
                if (entry.id !== subId) {
                    continue;
                }
                const { id: _id, modeRaw, ...rest } = entry;
                this.applyChange({
                    ...rest,
                    ...(modeRaw !== undefined ? { mode: HUB_MODE_FROM_WIRE[modeRaw] ?? 'custom' } : {})
                });
            }
            return;
        }
        if (ns === HUB_TOGGLEX_NAMESPACE) {
            this.applyMatching(decodeHubToggleXPush(payload).map((entry) => ({
                id: entry.id,
                on: entry.on
            })));
            return;
        }
        if (ns === HUB_EXCEPTION_NAMESPACE && this.has(ns)) {
            this.applyMatching(decodeHubExceptionPush(payload).map((entry) => ({
                id: entry.id,
                fault: entry.code
            })));
            return;
        }
        if (ns === HUB_SUBDEVICE_VERSION_NAMESPACE && this.has(ns)) {
            this.applyMatching(decodeHubSubDeviceVersionPush(payload).map((entry) => ({
                id: entry.id,
                ...(entry.firmware !== undefined ? { firmwareVersion: entry.firmware } : {}),
                ...(entry.hardware !== undefined ? { hardwareVersion: entry.hardware } : {})
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
        if (ns === HUB_MTS100_ADJUST_NAMESPACE && this.has(ns)) {
            this.applyMatching(decodeHubAdjust(payload).filter((entry) => entry.id === subId));
            return;
        }
        if (ns === HUB_MTS100_CONFIG_NAMESPACE && this.has(ns)) {
            this.applyMatching(decodeHubConfig(payload).filter((entry) => entry.id === subId));
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
        if (ns === THERMOSTAT_SYSTEM_NAMESPACE) {
            const entries = decodeThermostatSystemPush(payload);
            this.applyMatching(entries.map((entry) => {
                const { channel, ...system } = entry;
                return { channel, ...systemToClimateValues(system) };
            }));
            for (const entry of entries) {
                if (entry.channel !== this.bind.channel) {
                    continue;
                }
                const { channel: _channel, ...system } = entry;
                this.lastSystem = { ...this.lastSystem, ...system };
            }
            return;
        }
        if (ns === CONTROL_ALERT_CONFIG_NAMESPACE) {
            this.applyMatching(decodeAlertConfigPush(payload).map((entry) => ({
                channel: entry.channel,
                ...(entry.type !== undefined ? { alertConfigType: entry.type } : {}),
                ...(entry.value !== undefined ? { alertConfig: entry.value } : {})
            })));
            return;
        }
        if (ns === CONTROL_ALERT_REPORT_NAMESPACE) {
            this.applyMatching(decodeAlertReportPush(payload).map((entry) => ({
                channel: entry.channel,
                alertReport: entry.fields
            })));
            return;
        }
        if (ns === CONFIG_SENSOR_ASSOCIATION_NAMESPACE) {
            this.applyMatching(decodeSensorAssociationPush(payload).map((entry) => ({
                channel: entry.channel,
                ...(entry.tempAssociation !== undefined
                    ? { tempAssociation: entry.tempAssociation }
                    : {})
            })));
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

function systemToClimateValues(system: ClimateSystem): ClimateValues {
    return {
        ...(system.compTemp !== undefined ? { compTemp: system.compTemp } : {}),
        ...(system.compTempEnable !== undefined ? { compTempEnable: system.compTempEnable } : {}),
        ...(system.wire !== undefined ? { wire: system.wire } : {})
    };
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
