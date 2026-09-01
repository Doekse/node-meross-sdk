import {
    CONFIG_SENSOR_ASSOCIATION_NAMESPACE,
    HUB_BATTERY_NAMESPACE,
    HUB_EXCEPTION_NAMESPACE,
    HUB_SENSOR_ADJUST_NAMESPACE,
    HUB_SENSOR_ALERT_NAMESPACE,
    HUB_SENSOR_ALL_NAMESPACE,
    HUB_SENSOR_DOORWINDOW_NAMESPACE,
    HUB_SENSOR_MOTION_NAMESPACE,
    HUB_SENSOR_SMOKE_NAMESPACE,
    HUB_SENSOR_TEMPHUM_NAMESPACE,
    HUB_SENSOR_WATERLEAK_NAMESPACE,
    HUB_SUBDEVICE_VERSION_NAMESPACE,
    SENSOR_LATESTX_NAMESPACE,
    SMOKE_CONFIG_NAMESPACE,
    decodeSmokeConfigPush,
    decodeBatteryPush,
    decodeHubExceptionPush,
    decodeHubSubDeviceVersionPush,
    decodeLatestXPush,
    decodeSensorAdjustPush,
    decodeSensorAlertPush,
    decodeSensorAllPush,
    decodeSensorAssociationPush,
    decodeSensorDoorWindowPush,
    decodeSensorMotionPush,
    decodeSensorSmokePush,
    decodeSensorTempHumPush,
    decodeSensorWaterLeakPush,
    encodeSensorAdjustSet,
    encodeSensorAlertSet,
    encodeSensorAssociationSet,
    encodeSensorSmokeSet,
    encodeSmokeConfigSet,
    type MerossMessage,
    type SensorAlertBand,
    type SensorAlertState,
    type SensorAllState,
    type SensorSmokeState
} from '../protocol';
import type { RoutedRequestOptions } from '../transport/router';

/** Hub child sensor families. Digest type strings do not match cloud subDeviceType. */
export type SensorFamily = 'tempHum' | 'contact' | 'leak' | 'motion' | 'smoke';

/** Lowercase model / digest alias → family so enroll and the trait share one table. */
export const SENSOR_FAMILY_MAP: ReadonlyMap<string, SensorFamily> = new Map([
    ['ms100', 'tempHum'],
    ['ms100f', 'tempHum'],
    ['ms130', 'tempHum'],
    ['ms120', 'motion'],
    ['ms200', 'contact'],
    ['ms400', 'leak'],
    ['ms405', 'leak'],
    ['ma151', 'smoke'],
    ['gs559', 'smoke']
]);

/**
 * Known Hub.Sensor.Smoke conditions. Codes outside the firmware table are `unknown`.
 */
export type SensorSmokeStatus =
    | 'ok'
    | 'test'
    | 'alarmSmoke'
    | 'alarmTemperature'
    | 'errorSmoke'
    | 'errorTemperature'
    | 'errorBattery'
    | 'unknown';

export type { SensorAlertBand };

export interface SensorValues {
    temperature?: number;
    humidity?: number;
    light?: number;
    open?: boolean;
    leak?: boolean;
    motion?: boolean;
    smoke?: boolean;
    smokeStatus?: SensorSmokeStatus;
    smokeError?: boolean;
    smokeMuted?: boolean;
    interConn?: boolean;
    smokeDnd?: boolean;
    smokeDetect?: boolean;
    battery?: number;
    fault?: number;
    firmwareVersion?: string;
    hardwareVersion?: string;
    calibration?: number;
    humidityCalibration?: number;
    temperatureAlerts?: SensorAlertBand[];
    humidityAlerts?: SensorAlertBand[];
    /** Config.Sensor.Association `temp.association` when present on hub children. */
    tempAssociation?: number;
}

/**
 * Transport + sub-device bind for a hub sensor child. Session supplies this;
 * trait tests inject a fake request/emit pair.
 */
export interface SensorTraitBind {
    uuid: string;
    subDeviceId: string;
    family: SensorFamily;
    /** Ability keys; extra methods no-op when the namespace is absent. */
    namespaces?: ReadonlySet<string>;
    request: (options: Omit<RoutedRequestOptions, 'uuid' | 'ip' | 'encryptionKey'>) => Promise<MerossMessage>;
    emitChange: (values: SensorValues) => void;
}

const SMOKE_TEST = 23;

/** SET mute is only valid from the matching live alarm/error; otherwise firmware returns 5000. */
const SMOKE_MUTE_MAP: Readonly<Record<number, number>> = {
    17: 20,
    18: 21,
    19: 22,
    24: 26,
    25: 27
};

const SMOKE_FROM_WIRE: Record<number, SensorValues> = {
    17: { smoke: false, smokeStatus: 'errorTemperature', smokeError: true, smokeMuted: false },
    18: { smoke: false, smokeStatus: 'errorSmoke', smokeError: true, smokeMuted: false },
    19: { smoke: false, smokeStatus: 'errorBattery', smokeError: true, smokeMuted: false },
    20: { smoke: false, smokeStatus: 'errorTemperature', smokeError: true, smokeMuted: true },
    21: { smoke: false, smokeStatus: 'errorSmoke', smokeError: true, smokeMuted: true },
    22: { smoke: false, smokeStatus: 'errorBattery', smokeError: true, smokeMuted: true },
    23: { smoke: true, smokeStatus: 'test', smokeError: false, smokeMuted: false },
    24: { smoke: true, smokeStatus: 'alarmTemperature', smokeError: false, smokeMuted: false },
    25: { smoke: true, smokeStatus: 'alarmSmoke', smokeError: false, smokeMuted: false },
    26: { smoke: true, smokeStatus: 'alarmTemperature', smokeError: false, smokeMuted: true },
    27: { smoke: true, smokeStatus: 'alarmSmoke', smokeError: false, smokeMuted: true },
    170: { smoke: false, smokeStatus: 'ok', smokeError: false, smokeMuted: false }
};

/**
 * Hub child sensor. Live readings plus temp/hum calibration, alerts, MS130
 * lux, and smoke mute/test. Sprinklers and WiFi presence stay on other traits.
 */
export class SensorTrait {
    private readonly bind: SensorTraitBind;
    private readonly namespaces: ReadonlySet<string>;
    private last: SensorValues = {};
    /** Last Hub.Sensor.Smoke wire `status`; mute() maps from this. */
    private lastSmokeStatus: number | undefined;

    constructor(bind: SensorTraitBind) {
        this.bind = bind;
        this.namespaces = bind.namespaces ?? new Set();
    }

    /**
     * No-op unless this is a tempHum child and Adjust is advertised.
     */
    async setCalibration(options: { temperature?: number; humidity?: number }): Promise<SensorValues> {
        const patch: SensorValues = {};
        if (options.temperature !== undefined) {
            patch.calibration = options.temperature;
        }
        if (options.humidity !== undefined) {
            patch.humidityCalibration = options.humidity;
        }
        if (this.bind.family !== 'tempHum' || !this.has(HUB_SENSOR_ADJUST_NAMESPACE)) {
            return patch;
        }
        await this.bind.request({
            namespace: HUB_SENSOR_ADJUST_NAMESPACE,
            method: 'SET',
            payload: encodeSensorAdjustSet({ id: this.bind.subDeviceId, ...options })
        });
        this.applyChange(patch);
        return patch;
    }

    /**
     * Values are °C / RH%. No-op unless this is a tempHum child and Alert is advertised.
     */
    async setAlerts(options: { temperature?: SensorAlertBand[]; humidity?: SensorAlertBand[] }): Promise<SensorValues> {
        const patch: SensorValues = {};
        if (options.temperature) {
            patch.temperatureAlerts = options.temperature;
        }
        if (options.humidity) {
            patch.humidityAlerts = options.humidity;
        }
        if (this.bind.family !== 'tempHum' || !this.has(HUB_SENSOR_ALERT_NAMESPACE)) {
            return patch;
        }
        await this.bind.request({
            namespace: HUB_SENSOR_ALERT_NAMESPACE,
            method: 'SET',
            payload: encodeSensorAlertSet({ id: this.bind.subDeviceId, ...options })
        });
        this.applyChange(patch);
        return patch;
    }

    /**
     * SET Config.Sensor.Association for this hub child. No-op when absent.
     */
    async setTempAssociation(tempAssociation: number): Promise<SensorValues> {
        const patch: SensorValues = { tempAssociation };
        if (!this.has(CONFIG_SENSOR_ASSOCIATION_NAMESPACE)) {
            return patch;
        }
        await this.bind.request({
            namespace: CONFIG_SENSOR_ASSOCIATION_NAMESPACE,
            method: 'SET',
            payload: encodeSensorAssociationSet({
                channel: 0,
                subId: this.bind.subDeviceId,
                tempAssociation
            })
        });
        this.applyChange(patch);
        return patch;
    }

    /**
     * Firmware only accepts the mute code that matches the live status
     * (smoke 25→27, temperature 24→26, faults 17–19→20–22). No-op when
     * there is nothing to mute.
     */
    async mute(): Promise<SensorValues> {
        const mapped = this.lastSmokeStatus === undefined
            ? undefined
            : SMOKE_MUTE_MAP[this.lastSmokeStatus];
        if (mapped === undefined) {
            return {};
        }
        return this.setSmokeStatus(mapped);
    }

    /**
     * No-op unless smoke family.
     */
    async test(): Promise<SensorValues> {
        return this.setSmokeStatus(SMOKE_TEST);
    }

    /**
     * No-op unless this is a smoke child and Control.Smoke.Config is advertised.
     */
    async setSmokeDnd(enabled: boolean): Promise<SensorValues> {
        return this.setSmokeConfig({ dndEnabled: enabled });
    }

    /**
     * No-op unless this is a smoke child and Control.Smoke.Config is advertised.
     */
    async setSmokeDetect(enabled: boolean): Promise<SensorValues> {
        return this.setSmokeConfig({ detectEnabled: enabled });
    }

    handlePush(message: MerossMessage): void {
        const ns = message.header.namespace;
        const payload = message.payload;
        const id = this.bind.subDeviceId;
        const family = this.bind.family;

        if (ns === HUB_SENSOR_TEMPHUM_NAMESPACE && family === 'tempHum') {
            for (const entry of decodeSensorTempHumPush(payload)) {
                if (entry.id === id) {
                    this.applyChange(tempHumPatch(entry));
                }
            }
            return;
        }
        if (ns === HUB_SENSOR_DOORWINDOW_NAMESPACE && family === 'contact') {
            for (const entry of decodeSensorDoorWindowPush(payload)) {
                if (entry.id === id) {
                    this.applyChange({ open: entry.open });
                }
            }
            return;
        }
        if (ns === HUB_SENSOR_WATERLEAK_NAMESPACE && family === 'leak') {
            for (const entry of decodeSensorWaterLeakPush(payload)) {
                if (entry.id === id) {
                    this.applyChange({ leak: entry.leak });
                }
            }
            return;
        }
        if (ns === HUB_SENSOR_MOTION_NAMESPACE && family === 'motion') {
            for (const entry of decodeSensorMotionPush(payload)) {
                if (entry.id === id) {
                    this.applyChange({ motion: entry.motion });
                }
            }
            return;
        }
        if (ns === HUB_SENSOR_SMOKE_NAMESPACE && family === 'smoke') {
            for (const entry of decodeSensorSmokePush(payload)) {
                if (entry.id === id) {
                    this.applySmoke(entry);
                }
            }
            return;
        }
        if (ns === SMOKE_CONFIG_NAMESPACE && family === 'smoke' && this.has(ns)) {
            for (const entry of decodeSmokeConfigPush(payload)) {
                if (entry.subId === id) {
                    this.applyChange(smokeConfigPatch(entry));
                }
            }
            return;
        }
        if (ns === HUB_BATTERY_NAMESPACE && this.has(ns)) {
            for (const entry of decodeBatteryPush(payload)) {
                if (entry.id === id && entry.battery !== undefined) {
                    this.applyChange({ battery: entry.battery });
                }
            }
            return;
        }
        if (ns === HUB_EXCEPTION_NAMESPACE && this.has(ns)) {
            for (const entry of decodeHubExceptionPush(payload)) {
                if (entry.id === id) {
                    this.applyChange({ fault: entry.code });
                }
            }
            return;
        }
        if (ns === HUB_SUBDEVICE_VERSION_NAMESPACE && this.has(ns)) {
            for (const entry of decodeHubSubDeviceVersionPush(payload)) {
                if (entry.id === id) {
                    this.applyChange(versionPatch(entry));
                }
            }
            return;
        }
        if (ns === HUB_SENSOR_ADJUST_NAMESPACE && family === 'tempHum' && this.has(ns)) {
            for (const entry of decodeSensorAdjustPush(payload)) {
                if (entry.id === id) {
                    this.applyChange(adjustPatch(entry));
                }
            }
            return;
        }
        if (ns === HUB_SENSOR_ALERT_NAMESPACE && family === 'tempHum' && this.has(ns)) {
            for (const entry of decodeSensorAlertPush(payload)) {
                if (entry.id === id) {
                    this.applyChange(alertPatch(entry));
                }
            }
            return;
        }
        if (ns === HUB_SENSOR_ALL_NAMESPACE && this.has(ns)) {
            for (const entry of decodeSensorAllPush(payload)) {
                if (entry.id === id) {
                    this.applyAll(family, entry);
                }
            }
            return;
        }
        if (ns === SENSOR_LATESTX_NAMESPACE && family === 'tempHum' && this.has(ns)) {
            for (const entry of decodeLatestXPush(payload)) {
                if (entry.subId === id) {
                    this.applyChange(latestXPatch(entry));
                }
            }
            return;
        }
        if (ns === CONFIG_SENSOR_ASSOCIATION_NAMESPACE && this.has(ns)) {
            for (const entry of decodeSensorAssociationPush(payload)) {
                if (entry.subId !== id || entry.tempAssociation === undefined) {
                    continue;
                }
                this.applyChange({ tempAssociation: entry.tempAssociation });
            }
        }
    }

    /** Records wire `status` so mute() can pick the firmware-legal SET code. */
    private applySmoke(entry: SensorSmokeState): void {
        this.lastSmokeStatus = entry.status;
        this.applyChange(smokePatch(entry));
    }

    /** Hub.Sensor.All carries every family; smoke rows still need the wire status. */
    private applyAll(family: SensorFamily, entry: SensorAllState): void {
        if (family === 'smoke' && entry.smoke) {
            this.applySmoke(entry.smoke);
            return;
        }
        this.applyChange(allPatch(family, entry));
    }

    private applyChange(patch: SensorValues): void {
        const next: SensorValues = {};
        for (const key of Object.keys(patch) as Array<keyof SensorValues>) {
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

    private async setSmokeStatus(status: number): Promise<SensorValues> {
        const patch = smokePatch({ id: this.bind.subDeviceId, status });
        if (this.bind.family !== 'smoke' || !this.has(HUB_SENSOR_SMOKE_NAMESPACE)) {
            return patch;
        }
        await this.bind.request({
            namespace: HUB_SENSOR_SMOKE_NAMESPACE,
            method: 'SET',
            payload: encodeSensorSmokeSet({ id: this.bind.subDeviceId, status })
        });
        this.lastSmokeStatus = status;
        this.applyChange(patch);
        return patch;
    }

    private async setSmokeConfig(options: { dndEnabled?: boolean; detectEnabled?: boolean }): Promise<SensorValues> {
        const patch = smokeConfigPatch(options);
        if (this.bind.family !== 'smoke' || !this.has(SMOKE_CONFIG_NAMESPACE)) {
            return patch;
        }
        await this.bind.request({
            namespace: SMOKE_CONFIG_NAMESPACE,
            method: 'SET',
            payload: encodeSmokeConfigSet({
                channel: 0,
                subId: this.bind.subDeviceId,
                ...options
            })
        });
        this.applyChange(patch);
        return patch;
    }
}

function tempHumPatch(entry: { temperature?: number; humidity?: number }): SensorValues {
    const patch: SensorValues = {};
    if (entry.temperature !== undefined) {
        patch.temperature = entry.temperature;
    }
    if (entry.humidity !== undefined) {
        patch.humidity = entry.humidity;
    }
    return patch;
}

function versionPatch(entry: { firmware?: string; hardware?: string }): SensorValues {
    const patch: SensorValues = {};
    if (entry.firmware !== undefined) {
        patch.firmwareVersion = entry.firmware;
    }
    if (entry.hardware !== undefined) {
        patch.hardwareVersion = entry.hardware;
    }
    return patch;
}

function adjustPatch(entry: { temperature?: number; humidity?: number }): SensorValues {
    const patch: SensorValues = {};
    if (entry.temperature !== undefined) {
        patch.calibration = entry.temperature;
    }
    if (entry.humidity !== undefined) {
        patch.humidityCalibration = entry.humidity;
    }
    return patch;
}

function alertPatch(entry: SensorAlertState): SensorValues {
    const patch: SensorValues = {};
    if (entry.temperature) {
        patch.temperatureAlerts = entry.temperature;
    }
    if (entry.humidity) {
        patch.humidityAlerts = entry.humidity;
    }
    return patch;
}

function latestXPatch(entry: { temperature?: number; humidity?: number; light?: number }): SensorValues {
    const patch: SensorValues = {};
    if (entry.temperature !== undefined) {
        patch.temperature = entry.temperature;
    }
    if (entry.humidity !== undefined) {
        patch.humidity = entry.humidity;
    }
    if (entry.light !== undefined) {
        patch.light = entry.light;
    }
    return patch;
}

function allPatch(family: SensorFamily, entry: SensorAllState): SensorValues {
    switch (family) {
        case 'tempHum':
            return tempHumPatch(entry);
        case 'contact':
            return entry.open !== undefined ? { open: entry.open } : {};
        case 'leak':
            return entry.leak !== undefined ? { leak: entry.leak } : {};
        case 'motion':
            return entry.motion !== undefined ? { motion: entry.motion } : {};
        case 'smoke':
            return entry.smoke ? smokePatch(entry.smoke) : {};
    }
}

function smokePatch(entry: SensorSmokeState): SensorValues {
    const mapped = SMOKE_FROM_WIRE[entry.status];
    const patch: SensorValues = mapped === undefined
        ? { smoke: false, smokeStatus: 'unknown', smokeError: false, smokeMuted: false }
        : { ...mapped };
    if (entry.interConn !== undefined) {
        patch.interConn = entry.interConn !== 0;
    }
    return patch;
}

function smokeConfigPatch(entry: { dndEnabled?: boolean; detectEnabled?: boolean }): SensorValues {
    const patch: SensorValues = {};
    if (entry.dndEnabled !== undefined) {
        patch.smokeDnd = entry.dndEnabled;
    }
    if (entry.detectEnabled !== undefined) {
        patch.smokeDetect = entry.detectEnabled;
    }
    return patch;
}
