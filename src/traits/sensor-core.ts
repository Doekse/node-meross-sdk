import { MerossError } from '../errors';
import {
    decodeHubExceptionPush,
    decodeHubSubDeviceVersionPush
} from '../protocol/codecs/hub';
import {
    CONFIG_SENSOR_ASSOCIATION_NAMESPACE,
    HUB_BATTERY_NAMESPACE,
    HUB_SENSOR_ADJUST_NAMESPACE,
    HUB_SENSOR_ALERT_NAMESPACE,
    HUB_SENSOR_ALL_NAMESPACE,
    HUB_SENSOR_DOORWINDOW_NAMESPACE,
    HUB_SENSOR_MOTION_NAMESPACE,
    HUB_SENSOR_SMOKE_NAMESPACE,
    HUB_SENSOR_TEMPHUM_NAMESPACE,
    HUB_SENSOR_WATERLEAK_NAMESPACE,
    SENSOR_LATESTX_NAMESPACE,
    SMOKE_CONFIG_NAMESPACE,
    decodeSmokeConfigPush,
    decodeBatteryPush,
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
    encodeSensorAssociationSet,
    type SensorAlertBand,
    type SensorAlertState,
    type SensorAllState,
    type SensorSmokeState
} from '../protocol/codecs/sensor';
import type { MerossMessage } from '../protocol/message';
import {
    HUB_EXCEPTION_NAMESPACE,
    HUB_SUBDEVICE_VERSION_NAMESPACE
} from '../protocol/namespaces';
import type { DeviceRequest } from '../request';
import { applyPatch } from './patch';
import type { SensorKind } from './sensor-family';

export type { SensorKind };

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
 * Transport + sub-device bind. Kind is the concrete class, not a field
 * here, so a contact sensor cannot call smoke setters.
 */
export interface SensorTraitBind {
    subDeviceId: string;
    /** Ability keys; extra methods throw when the namespace is absent. */
    namespaces?: ReadonlySet<string>;
    request: DeviceRequest;
    emitChange: (values: SensorValues) => void;
}

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
 * Shared hub-child cache. Kind-specific commands live on the concrete classes.
 */
export abstract class SensorTraitBase {
    abstract readonly kind: SensorKind;

    protected readonly subDeviceId: string;
    protected readonly namespaces: ReadonlySet<string>;
    protected readonly request: DeviceRequest;
    protected readonly emitChange: (values: SensorValues) => void;
    protected last: SensorValues = {};
    /** Last Hub.Sensor.Smoke wire `status`; mute() maps from this. */
    protected lastSmokeStatus: number | undefined;

    /** @internal */
    protected constructor(bind: SensorTraitBind) {
        this.subDeviceId = bind.subDeviceId;
        this.namespaces = bind.namespaces ?? new Set();
        this.request = bind.request;
        this.emitChange = bind.emitChange;
    }

    /**
     * Full cache, not the last diff. A subscriber that attaches after enroll
     * never saw the seeded fields, and an unchanged poll does not emit again.
     */
    values(): SensorValues {
        return { ...this.last };
    }

    /**
     * SET Config.Sensor.Association for this hub child.
     */
    async setTempAssociation(tempAssociation: number): Promise<SensorValues> {
        this.requireNamespace(CONFIG_SENSOR_ASSOCIATION_NAMESPACE);
        const patch: SensorValues = { tempAssociation };
        await this.request({
            namespace: CONFIG_SENSOR_ASSOCIATION_NAMESPACE,
            method: 'SET',
            payload: encodeSensorAssociationSet({
                channel: 0,
                subId: this.subDeviceId,
                tempAssociation
            })
        });
        this.applyChange(patch);
        return patch;
    }

    /**
     * PUSH/GETACK from DeviceRuntime. Hosts subscribe to Endpoint `change`.
     *
     * @internal
     * @package
     */
    handlePush(message: MerossMessage): void {
        const ns = message.header.namespace;
        const payload = message.payload;
        const id = this.subDeviceId;
        const kind = this.kind;

        if (ns === HUB_SENSOR_TEMPHUM_NAMESPACE && kind === 'tempHum') {
            for (const entry of decodeSensorTempHumPush(payload)) {
                if (entry.id === id) {
                    this.applyChange(tempHumPatch(entry));
                }
            }
            return;
        }
        if (ns === HUB_SENSOR_DOORWINDOW_NAMESPACE && kind === 'contact') {
            for (const entry of decodeSensorDoorWindowPush(payload)) {
                if (entry.id === id) {
                    this.applyChange({ open: entry.open });
                }
            }
            return;
        }
        if (ns === HUB_SENSOR_WATERLEAK_NAMESPACE && kind === 'leak') {
            for (const entry of decodeSensorWaterLeakPush(payload)) {
                if (entry.id === id) {
                    this.applyChange({ leak: entry.leak });
                }
            }
            return;
        }
        if (ns === HUB_SENSOR_MOTION_NAMESPACE && kind === 'motion') {
            for (const entry of decodeSensorMotionPush(payload)) {
                if (entry.id === id) {
                    this.applyChange({ motion: entry.motion });
                }
            }
            return;
        }
        if (ns === HUB_SENSOR_SMOKE_NAMESPACE && kind === 'smoke') {
            for (const entry of decodeSensorSmokePush(payload)) {
                if (entry.id === id) {
                    this.applySmoke(entry);
                }
            }
            return;
        }
        if (ns === SMOKE_CONFIG_NAMESPACE && kind === 'smoke' && this.has(ns)) {
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
        if (ns === HUB_SENSOR_ADJUST_NAMESPACE && kind === 'tempHum' && this.has(ns)) {
            for (const entry of decodeSensorAdjustPush(payload)) {
                if (entry.id === id) {
                    this.applyChange(adjustPatch(entry));
                }
            }
            return;
        }
        if (ns === HUB_SENSOR_ALERT_NAMESPACE && kind === 'tempHum' && this.has(ns)) {
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
                    this.applyAll(kind, entry);
                }
            }
            return;
        }
        if (ns === SENSOR_LATESTX_NAMESPACE && kind === 'tempHum' && this.has(ns)) {
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

    /** Records wire `status` so mute() can pick the firmware-legal SET code. */
    private applySmoke(entry: SensorSmokeState): void {
        this.lastSmokeStatus = entry.status;
        this.applyChange(smokePatch(entry));
    }

    protected applyChange(patch: SensorValues): void {
        applyPatch(this.last, patch, this.emitChange);
    }

    /** Hub.Sensor.All carries every kind; smoke rows still need the wire status. */
    private applyAll(kind: SensorKind, entry: SensorAllState): void {
        if (kind === 'smoke' && entry.smoke) {
            this.applySmoke(entry.smoke);
            return;
        }
        this.applyChange(allPatch(kind, entry));
    }
}

/** Hub contact child (MS200). Readings only; calibration and mute are other kinds. */
export class SensorContactTrait extends SensorTraitBase {
    readonly kind = 'contact' as const;

    /** @internal */
    constructor(bind: SensorTraitBind) {
        super(bind);
    }
}

/** Hub leak child (MS400 / MS405). */
export class SensorLeakTrait extends SensorTraitBase {
    readonly kind = 'leak' as const;

    /** @internal */
    constructor(bind: SensorTraitBind) {
        super(bind);
    }
}

/** Hub motion child (MS120). */
export class SensorMotionTrait extends SensorTraitBase {
    readonly kind = 'motion' as const;

    /** @internal */
    constructor(bind: SensorTraitBind) {
        super(bind);
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

function allPatch(kind: SensorKind, entry: SensorAllState): SensorValues {
    switch (kind) {
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

export function smokePatch(entry: SensorSmokeState): SensorValues {
    const mapped = SMOKE_FROM_WIRE[entry.status];
    const patch: SensorValues = mapped === undefined
        ? { smoke: false, smokeStatus: 'unknown', smokeError: false, smokeMuted: false }
        : { ...mapped };
    if (entry.interConn !== undefined) {
        patch.interConn = entry.interConn !== 0;
    }
    return patch;
}

export function smokeConfigPatch(entry: { dndEnabled?: boolean; detectEnabled?: boolean }): SensorValues {
    const patch: SensorValues = {};
    if (entry.dndEnabled !== undefined) {
        patch.smokeDnd = entry.dndEnabled;
    }
    if (entry.detectEnabled !== undefined) {
        patch.smokeDetect = entry.detectEnabled;
    }
    return patch;
}
