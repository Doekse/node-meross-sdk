import { MerossError } from '../errors';
import type {
    ClimateAlarmKind,
    ClimateFanSpeed,
    ClimateHoldMode,
    ClimateMode,
    ClimateSchedule,
    ClimateSensorMode,
    ClimateSystem,
    ClimateSystemWire,
    ClimateTempUnit,
    ClimateTimer,
    ClimateWorkMode
} from '../protocol/codecs/climate';
import type { SensorLatestState } from '../protocol/codecs/sensor';
import type { MerossMessage } from '../protocol/message';
import type { DeviceRequest } from '../request';
import { applyPatch } from './patch';

export type {
    ClimateAlarmKind,
    ClimateFanSpeed,
    ClimateHoldMode,
    ClimateMode,
    ClimateSchedule,
    ClimateSensorMode,
    ClimateSystem,
    ClimateSystemWire,
    ClimateTempUnit,
    ClimateTimer,
    ClimateWorkMode
};

/**
 * Bound at enroll. Hosts narrow the climate instance on this field so
 * ModeC-only methods are not callable on a valve.
 */
export type ClimateKind = 'mode' | 'modeB' | 'modeC' | 'hub';

export type ClimateBoardKind = 'mode' | 'modeB' | 'modeC';

/** Thermostat.Mode `mode` values. */
export type ClimateModeMode = 'off' | 'heat' | 'cool' | 'auto' | 'eco' | 'manual';

/** Thermostat.ModeB working + onoff. */
export type ClimateModeBMode = 'off' | 'heat' | 'cool';

/** Thermostat.ModeC `control.mode`. */
export type ClimateModeCMode = 'off' | 'heat' | 'cool' | 'auto';

/**
 * Hub.Mts100.Mode plus ToggleX for `off`. `manual` has no hub wire value.
 */
export type ClimateHubMode = 'off' | 'custom' | 'heat' | 'cool' | 'auto' | 'eco';

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
    fanHoldMinutes?: number | null;
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
    /** Config.Sensor.Association `temp.association` (2 = internal on MTS300). */
    tempAssociation?: number;
}

export type ClimatePatch = ClimateValues & { channel?: number; id?: string };

/**
 * Shared cache and Ability checks. Kind-specific SET/PUSH live on
 * the concrete classes so unsupported commands are not on the type.
 */
export abstract class ClimateTraitBase {
    abstract readonly kind: ClimateKind;

    protected readonly namespaces: ReadonlySet<string>;
    protected readonly request: DeviceRequest;
    protected readonly emitChange: (values: ClimateValues) => void;
    protected last: ClimateValues = {};

    /** @internal */
    protected constructor(
        namespaces: ReadonlySet<string> | undefined,
        request: DeviceRequest,
        emitChange: (values: ClimateValues) => void
    ) {
        this.namespaces = namespaces ?? new Set();
        this.request = request;
        this.emitChange = emitChange;
    }

    /**
     * Full cache, not the last diff. A subscriber that attaches after enroll
     * never saw the seeded fields, and an unchanged poll does not emit again.
     */
    values(): ClimateValues {
        return { ...this.last };
    }

    /** Undefined until poller GETACK or PUSH fills it. */
    isOn(): boolean | undefined {
        return this.last.on;
    }

    /**
     * PUSH/GETACK from Runtime. Hosts subscribe to Endpoint `change`.
     *
     * @internal
     * @package
     */
    abstract handlePush(message: MerossMessage): void;

    abstract setOn(on: boolean): Promise<{ on: boolean }>;

    abstract setTargetTemperature(celsius: number): Promise<{ targetTemperature: number }>;

    abstract setHeatTemperature(celsius: number): Promise<{ heatTemperature: number }>;

    abstract setCoolTemperature(celsius: number): Promise<{ coolTemperature: number }>;

    abstract setCalibration(calibration: number): Promise<{ calibration: number }>;

    abstract setChildLock(locked: boolean): Promise<{ childLock: boolean }>;

    abstract setSchedule(schedule: ClimateSchedule): Promise<{ schedule: ClimateSchedule }>;

    protected has(namespace: string): boolean {
        return this.namespaces.has(namespace);
    }

    /**
     * Ability-gated extras used to return success without a SET. Hosts
     * cannot tell a missing namespace from a write that landed.
     */
    protected requireNamespace(namespace: string): void {
        if (!this.has(namespace)) {
            throw new MerossError(
                `${namespace} is not advertised`,
                'NAMESPACE_NOT_ADVERTISED'
            );
        }
    }

    protected applyMatching(
        entries: ClimatePatch[],
        identity: { channel?: number; id?: string }
    ): void {
        for (const entry of entries) {
            if (
                identity.channel !== undefined
                && entry.channel !== undefined
                && entry.channel !== identity.channel
            ) {
                continue;
            }
            if (
                identity.id !== undefined
                && entry.id !== undefined
                && entry.id !== identity.id
            ) {
                continue;
            }
            const { channel: _channel, id: _id, ...patch } = entry;
            this.applyChange(patch);
        }
    }

    protected applyChange(patch: ClimateValues): void {
        applyPatch(this.last, patch, this.emitChange);
    }
}

export function systemToClimateValues(system: ClimateSystem): ClimateValues {
    return {
        ...(system.compTemp !== undefined ? { compTemp: system.compTemp } : {}),
        ...(system.compTempEnable !== undefined ? { compTempEnable: system.compTempEnable } : {}),
        ...(system.wire !== undefined ? { wire: system.wire } : {})
    };
}

export function sensorLatestToClimatePatch(entry: SensorLatestState): ClimatePatch {
    const patch: ClimatePatch = { channel: entry.channel };
    if (entry.humidity !== undefined) {
        patch.humidity = entry.humidity;
    }
    if (entry.temperature !== undefined) {
        patch.currentTemperature = entry.temperature;
    }
    return patch;
}
