import { MerossError } from '../errors';
import {
    ALARM_CONFIG_NAMESPACE,
    ALARM_NAMESPACE,
    CALIBRATION_NAMESPACE,
    COMPRESSOR_DELAY_NAMESPACE,
    CTL_RANGE_NAMESPACE,
    DEAD_ZONE_NAMESPACE,
    FROST_NAMESPACE,
    HOLD_ACTION_NAMESPACE,
    OVERHEAT_NAMESPACE,
    PHYSICAL_LOCK_NAMESPACE,
    SCHEDULEB_NAMESPACE,
    SCHEDULE_NAMESPACE,
    SCREEN_BRIGHTNESS_NAMESPACE,
    SENSOR_NAMESPACE,
    SUMMER_MODE_NAMESPACE,
    TEMP_UNIT_NAMESPACE,
    THERMOSTAT_MODEB_NAMESPACE,
    THERMOSTAT_MODEC_NAMESPACE,
    THERMOSTAT_MODE_NAMESPACE,
    THERMOSTAT_SYSTEM_NAMESPACE,
    TIMER_NAMESPACE,
    WINDOW_OPENED_NAMESPACE,
    decodeAlarm,
    decodeAlarmConfig,
    decodeCalibration,
    decodeCompressorDelay,
    decodeCtlRange,
    decodeDeadZone,
    decodeFrost,
    decodeHoldAction,
    decodeOverheat,
    decodePhysicalLock,
    decodeSchedule,
    decodeScreenBrightness,
    decodeSensorMode,
    decodeSummerMode,
    decodeTempUnit,
    decodeThermostatModeBPush,
    decodeThermostatModeCPush,
    decodeThermostatModePush,
    decodeThermostatSystemPush,
    decodeTimer,
    decodeWindowOpened,
    encodeAlarmConfigSet,
    encodeCalibrationSet,
    encodeCompressorDelaySet,
    encodeCtlRangeSet,
    encodeDeadZoneSet,
    encodeFrostSet,
    encodeHoldActionSet,
    encodeOverheatSet,
    encodePhysicalLockSet,
    encodeScheduleSet,
    encodeScreenBrightnessSet,
    encodeSensorModeSet,
    encodeSummerModeSet,
    encodeTempUnitSet,
    encodeThermostatSystemSet,
    encodeTimerSet,
    encodeWindowOpenedSet
} from '../protocol/codecs/climate';
import {
    CONFIG_SENSOR_ASSOCIATION_NAMESPACE,
    SENSOR_HISTORY_NAMESPACE,
    SENSOR_HISTORYX_NAMESPACE,
    SENSOR_LATEST_NAMESPACE,
    decodeSensorAssociationPush,
    decodeSensorHistoryGetAck,
    decodeSensorHistoryXGetAck,
    decodeSensorLatestPush,
    encodeSensorAssociationSet,
    encodeSensorHistoryGet,
    encodeSensorHistoryXGet,
    type SensorHistorySample,
    type SensorHistoryXState
} from '../protocol/codecs/sensor';
import type { MerossMessage, MerossPayload } from '../protocol/message';
import {
    ClimateTraitBase,
    sensorLatestToClimatePatch,
    systemToClimateValues,
    type ClimateBoardGeneration,
    type ClimateHoldMode,
    type ClimateSchedule,
    type ClimateSensorMode,
    type ClimateSystem,
    type ClimateTempUnit,
    type ClimateTimer,
    type ClimateTraitBoardBind
} from './climate-core';

/**
 * Board extras (HoldAction, Frost, …) are Ability-gated, not generation-gated.
 * Generation SET/PUSH stay on the concrete Mode/ModeB/ModeC classes.
 */
export abstract class ClimateBoardBase extends ClimateTraitBase {
    abstract override readonly generation: ClimateBoardGeneration;

    protected readonly channel: number;
    protected lastSystem: ClimateSystem | undefined;

    /** @internal */
    protected constructor(bind: ClimateTraitBoardBind) {
        super(bind.namespaces, bind.request, bind.emitChange);
        this.channel = bind.channel;
    }

    /**
     * PUSH/GETACK from DeviceRuntime. Hosts subscribe to Endpoint `change`.
     *
     * @internal
     * @package
     */
    handlePush(message: MerossMessage): void {
        this.handleBoardPush(message.header.namespace, message.payload);
    }

    /**
     * Board WindowOpened only. Open/closed status is GET/PUSH (`windowOpen` on change).
     */
    async setWindowDetect(detect: boolean): Promise<{ windowDetect: boolean }> {
        this.requireNamespace(WINDOW_OPENED_NAMESPACE);
        await this.request({
            namespace: WINDOW_OPENED_NAMESPACE,
            method: 'SET',
            payload: encodeWindowOpenedSet({ channel: this.channel, detect })
        });
        this.applyChange({ windowDetect: detect });
        return { windowDetect: detect };
    }

    async setHold(mode: ClimateHoldMode, minutes?: number): Promise<{ holdMode: ClimateHoldMode }> {
        this.requireNamespace(HOLD_ACTION_NAMESPACE);
        await this.request({
            namespace: HOLD_ACTION_NAMESPACE,
            method: 'SET',
            payload: encodeHoldActionSet({ channel: this.channel, mode, minutes })
        });
        this.applyChange({ holdMode: mode, ...(minutes !== undefined ? { holdMinutes: minutes } : {}) });
        return { holdMode: mode };
    }

    async setSensorMode(sensorMode: ClimateSensorMode): Promise<{ sensorMode: ClimateSensorMode }> {
        this.requireNamespace(SENSOR_NAMESPACE);
        await this.request({
            namespace: SENSOR_NAMESPACE,
            method: 'SET',
            payload: encodeSensorModeSet({ channel: this.channel, sensorMode })
        });
        this.applyChange({ sensorMode });
        return { sensorMode };
    }

    async setFrost(frost: boolean, frostTemperature?: number): Promise<{ frost: boolean }> {
        this.requireNamespace(FROST_NAMESPACE);
        await this.request({
            namespace: FROST_NAMESPACE,
            method: 'SET',
            payload: encodeFrostSet({
                channel: this.channel,
                frost,
                frostTemperature,
                scale: this.boardScale()
            })
        });
        this.applyChange({ frost, ...(frostTemperature !== undefined ? { frostTemperature } : {}) });
        return { frost };
    }

    async setCalibration(calibration: number): Promise<{ calibration: number }> {
        this.requireNamespace(CALIBRATION_NAMESPACE);
        await this.request({
            namespace: CALIBRATION_NAMESPACE,
            method: 'SET',
            payload: encodeCalibrationSet({
                channel: this.channel,
                calibration,
                scale: this.boardScale()
            })
        });
        this.applyChange({ calibration });
        return { calibration };
    }

    async setOverheat(overheat: boolean, overheatTemperature?: number): Promise<{ overheat: boolean }> {
        this.requireNamespace(OVERHEAT_NAMESPACE);
        await this.request({
            namespace: OVERHEAT_NAMESPACE,
            method: 'SET',
            payload: encodeOverheatSet({ channel: this.channel, overheat, overheatTemperature })
        });
        this.applyChange({ overheat, ...(overheatTemperature !== undefined ? { overheatTemperature } : {}) });
        return { overheat };
    }

    async setDeadZone(deadZone: number): Promise<{ deadZone: number }> {
        this.requireNamespace(DEAD_ZONE_NAMESPACE);
        await this.request({
            namespace: DEAD_ZONE_NAMESPACE,
            method: 'SET',
            payload: encodeDeadZoneSet({ channel: this.channel, deadZone, scale: this.boardScale() })
        });
        this.applyChange({ deadZone });
        return { deadZone };
    }

    async setSummerMode(summerMode: boolean): Promise<{ summerMode: boolean }> {
        this.requireNamespace(SUMMER_MODE_NAMESPACE);
        await this.request({
            namespace: SUMMER_MODE_NAMESPACE,
            method: 'SET',
            payload: encodeSummerModeSet({ channel: this.channel, summerMode })
        });
        this.applyChange({ summerMode });
        return { summerMode };
    }

    async setCompressorDelay(
        compressorDelay: boolean,
        compressorDelayMinutes?: number
    ): Promise<{ compressorDelay: boolean }> {
        this.requireNamespace(COMPRESSOR_DELAY_NAMESPACE);
        await this.request({
            namespace: COMPRESSOR_DELAY_NAMESPACE,
            method: 'SET',
            payload: encodeCompressorDelaySet({
                channel: this.channel,
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

    async setCtlRange(minTemperature: number, maxTemperature: number): Promise<{
        minTemperature: number;
        maxTemperature: number;
    }> {
        this.requireNamespace(CTL_RANGE_NAMESPACE);
        await this.request({
            namespace: CTL_RANGE_NAMESPACE,
            method: 'SET',
            payload: encodeCtlRangeSet({ channel: this.channel, minTemperature, maxTemperature })
        });
        this.applyChange({ minTemperature, maxTemperature });
        return { minTemperature, maxTemperature };
    }

    async setTimer(timer: ClimateTimer): Promise<{ timer: ClimateTimer }> {
        this.requireNamespace(TIMER_NAMESPACE);
        await this.request({
            namespace: TIMER_NAMESPACE,
            method: 'SET',
            payload: encodeTimerSet({ channel: this.channel, timer })
        });
        this.applyChange({ timer });
        return { timer };
    }

    async setAlarmConfig(options: {
        highAlarm?: boolean;
        highAlarmTemperature?: number;
        lowAlarm?: boolean;
        lowAlarmTemperature?: number;
    }): Promise<typeof options> {
        this.requireNamespace(ALARM_CONFIG_NAMESPACE);
        await this.request({
            namespace: ALARM_CONFIG_NAMESPACE,
            method: 'SET',
            payload: encodeAlarmConfigSet({ channel: this.channel, ...options })
        });
        this.applyChange(options);
        return options;
    }

    /**
     * SET Config.Sensor.Association temp binding. Throws when absent (MTS300).
     */
    async setTempAssociation(tempAssociation: number): Promise<{ tempAssociation: number }> {
        this.requireNamespace(CONFIG_SENSOR_ASSOCIATION_NAMESPACE);
        await this.request({
            namespace: CONFIG_SENSOR_ASSOCIATION_NAMESPACE,
            method: 'SET',
            payload: encodeSensorAssociationSet({
                channel: this.channel,
                tempAssociation
            })
        });
        this.applyChange({ tempAssociation });
        return { tempAssociation };
    }

    /**
     * Host temperatures stay °C. Throws unless TempUnit is advertised.
     */
    async setTempUnit(tempUnit: ClimateTempUnit): Promise<{ tempUnit: ClimateTempUnit }> {
        this.requireNamespace(TEMP_UNIT_NAMESPACE);
        await this.request({
            namespace: TEMP_UNIT_NAMESPACE,
            method: 'SET',
            payload: encodeTempUnitSet({ channel: this.channel, tempUnit })
        });
        this.applyChange({ tempUnit });
        return { tempUnit };
    }

    async setChildLock(locked: boolean): Promise<{ childLock: boolean }> {
        this.requireNamespace(PHYSICAL_LOCK_NAMESPACE);
        await this.request({
            namespace: PHYSICAL_LOCK_NAMESPACE,
            method: 'SET',
            payload: encodePhysicalLockSet({ channel: this.channel, locked })
        });
        this.applyChange({ childLock: locked });
        return { childLock: locked };
    }

    /**
     * Host range is 0–1. Throws unless Screen.Brightness is advertised.
     */
    async setScreenBrightness(options: {
        standby?: number;
        operation?: number;
        standbyView?: boolean;
    }): Promise<typeof options> {
        this.requireNamespace(SCREEN_BRIGHTNESS_NAMESPACE);
        await this.request({
            namespace: SCREEN_BRIGHTNESS_NAMESPACE,
            method: 'SET',
            payload: encodeScreenBrightnessSet({ channel: this.channel, ...options })
        });
        this.applyChange({
            ...(options.standby !== undefined ? { screenStandbyBrightness: options.standby } : {}),
            ...(options.operation !== undefined ? { screenOperationBrightness: options.operation } : {}),
            ...(options.standbyView !== undefined ? { screenStandbyView: options.standbyView } : {})
        });
        return options;
    }

    async getHistory(options?: { capacity?: number }): Promise<SensorHistorySample[]> {
        this.requireNamespace(SENSOR_HISTORY_NAMESPACE);
        const channel = this.channel;
        const reply = await this.request({
            namespace: SENSOR_HISTORY_NAMESPACE,
            method: 'GET',
            payload: encodeSensorHistoryGet({
                channel,
                capacity: options?.capacity
            })
        });
        const match = decodeSensorHistoryGetAck(reply.payload, this.boardScale())
            .find((entry) => entry.channel === channel);
        return match?.samples ?? [];
    }

    async getHistoryX(): Promise<SensorHistoryXState | undefined> {
        this.requireNamespace(SENSOR_HISTORYX_NAMESPACE);
        const channel = this.channel;
        const reply = await this.request({
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

    async setSystem(patch: ClimateSystem): Promise<ClimateSystem> {
        this.requireNamespace(THERMOSTAT_SYSTEM_NAMESPACE);
        await this.request({
            namespace: THERMOSTAT_SYSTEM_NAMESPACE,
            method: 'SET',
            payload: encodeThermostatSystemSet({ channel: this.channel, ...patch })
        });
        this.lastSystem = { ...this.lastSystem, ...patch };
        this.applyChange(systemToClimateValues(patch));
        return this.lastSystem;
    }

    /**
     * Prefers ScheduleB when both are advertised.
     */
    async setSchedule(schedule: ClimateSchedule): Promise<{ schedule: ClimateSchedule }> {
        const ns = this.has(SCHEDULEB_NAMESPACE)
            ? SCHEDULEB_NAMESPACE
            : this.has(SCHEDULE_NAMESPACE)
                ? SCHEDULE_NAMESPACE
                : undefined;
        if (!ns) {
            throw new MerossError(
                `${SCHEDULE_NAMESPACE} is not advertised`,
                'NAMESPACE_NOT_ADVERTISED'
            );
        }
        await this.request({
            namespace: ns,
            method: 'SET',
            payload: encodeScheduleSet({
                channel: this.channel,
                schedule,
                scale: ns === SCHEDULEB_NAMESPACE ? 100 : 10,
                key: ns === SCHEDULEB_NAMESPACE ? 'scheduleB' : 'schedule'
            })
        });
        this.applyChange({ schedule });
        return { schedule };
    }

    private handleBoardPush(ns: string, payload: MerossPayload): void {
        const generation = this.generation;
        const id = { channel: this.channel };
        if (ns === THERMOSTAT_MODE_NAMESPACE && generation === 'mode') {
            this.applyMatching(decodeThermostatModePush(payload), id);
            return;
        }
        if (ns === THERMOSTAT_MODEB_NAMESPACE && generation === 'modeB') {
            this.applyMatching(decodeThermostatModeBPush(payload), id);
            return;
        }
        if (ns === THERMOSTAT_MODEC_NAMESPACE && generation === 'modeC') {
            this.applyMatching(decodeThermostatModeCPush(payload), id);
            return;
        }
        if (!this.has(ns)) {
            return;
        }
        const scale = this.boardScale();
        if (ns === HOLD_ACTION_NAMESPACE) {
            this.applyMatching(decodeHoldAction(payload), id);
            return;
        }
        if (ns === WINDOW_OPENED_NAMESPACE) {
            this.applyMatching(decodeWindowOpened(payload), id);
            return;
        }
        if (ns === SENSOR_NAMESPACE) {
            this.applyMatching(decodeSensorMode(payload), id);
            return;
        }
        if (ns === FROST_NAMESPACE) {
            this.applyMatching(decodeFrost(payload, scale), id);
            return;
        }
        if (ns === CALIBRATION_NAMESPACE) {
            this.applyMatching(decodeCalibration(payload, scale), id);
            return;
        }
        if (ns === OVERHEAT_NAMESPACE) {
            this.applyMatching(decodeOverheat(payload), id);
            return;
        }
        if (ns === DEAD_ZONE_NAMESPACE) {
            this.applyMatching(decodeDeadZone(payload, scale), id);
            return;
        }
        if (ns === SUMMER_MODE_NAMESPACE) {
            this.applyMatching(decodeSummerMode(payload), id);
            return;
        }
        if (ns === COMPRESSOR_DELAY_NAMESPACE) {
            this.applyMatching(decodeCompressorDelay(payload), id);
            return;
        }
        if (ns === CTL_RANGE_NAMESPACE) {
            this.applyMatching(decodeCtlRange(payload), id);
            return;
        }
        if (ns === TIMER_NAMESPACE) {
            this.applyMatching(decodeTimer(payload), id);
            return;
        }
        if (ns === ALARM_NAMESPACE) {
            this.applyMatching(decodeAlarm(payload), id);
            return;
        }
        if (ns === ALARM_CONFIG_NAMESPACE) {
            this.applyMatching(decodeAlarmConfig(payload), id);
            return;
        }
        if (ns === SCHEDULE_NAMESPACE) {
            this.applyMatching(decodeSchedule(payload, 10, 'schedule'), id);
            return;
        }
        if (ns === SCHEDULEB_NAMESPACE) {
            this.applyMatching(decodeSchedule(payload, 100, 'scheduleB'), id);
            return;
        }
        if (ns === TEMP_UNIT_NAMESPACE) {
            this.applyMatching(decodeTempUnit(payload), id);
            return;
        }
        if (ns === PHYSICAL_LOCK_NAMESPACE) {
            this.applyMatching(decodePhysicalLock(payload), id);
            return;
        }
        if (ns === SCREEN_BRIGHTNESS_NAMESPACE) {
            this.applyMatching(decodeScreenBrightness(payload), id);
            return;
        }
        if (ns === SENSOR_LATEST_NAMESPACE) {
            this.applyMatching(
                decodeSensorLatestPush(payload, scale).map(sensorLatestToClimatePatch),
                id
            );
            return;
        }
        if (ns === THERMOSTAT_SYSTEM_NAMESPACE) {
            const entries = decodeThermostatSystemPush(payload);
            this.applyMatching(entries.map((entry) => {
                const { channel, ...system } = entry;
                return { channel, ...systemToClimateValues(system) };
            }), id);
            for (const entry of entries) {
                if (entry.channel !== this.channel) {
                    continue;
                }
                const { channel: _channel, ...system } = entry;
                this.lastSystem = { ...this.lastSystem, ...system };
            }
            return;
        }
        if (ns === CONFIG_SENSOR_ASSOCIATION_NAMESPACE) {
            this.applyMatching(decodeSensorAssociationPush(payload).map((entry) => ({
                channel: entry.channel,
                ...(entry.tempAssociation !== undefined
                    ? { tempAssociation: entry.tempAssociation }
                    : {})
            })), id);
        }
    }

    protected boardScale(): number {
        return this.generation === 'mode' ? 10 : 100;
    }
}
