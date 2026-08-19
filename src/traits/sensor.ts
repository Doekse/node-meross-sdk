import {
    HUB_BATTERY_NAMESPACE,
    HUB_SENSOR_ADJUST_NAMESPACE,
    HUB_SENSOR_ALERT_NAMESPACE,
    HUB_SENSOR_ALL_NAMESPACE,
    HUB_SENSOR_DOORWINDOW_NAMESPACE,
    HUB_SENSOR_SMOKE_NAMESPACE,
    HUB_SENSOR_TEMPHUM_NAMESPACE,
    HUB_SENSOR_WATERLEAK_NAMESPACE,
    SENSOR_LATESTX_NAMESPACE,
    decodeBatteryGetAck,
    decodeBatteryPush,
    decodeLatestXGetAck,
    decodeLatestXPush,
    decodeSensorAdjustGetAck,
    decodeSensorAdjustPush,
    decodeSensorAlertGetAck,
    decodeSensorAlertPush,
    decodeSensorAllGetAck,
    decodeSensorAllPush,
    decodeSensorDoorWindowGetAck,
    decodeSensorDoorWindowPush,
    decodeSensorSmokeGetAck,
    decodeSensorSmokePush,
    decodeSensorTempHumGetAck,
    decodeSensorTempHumPush,
    decodeSensorWaterLeakGetAck,
    decodeSensorWaterLeakPush,
    encodeBatteryGet,
    encodeLatestXGet,
    encodeSensorAdjustGet,
    encodeSensorAdjustSet,
    encodeSensorAlertGet,
    encodeSensorAlertSet,
    encodeSensorAllGet,
    encodeSensorDoorWindowGet,
    encodeSensorSmokeGet,
    encodeSensorSmokeSet,
    encodeSensorTempHumGet,
    encodeSensorWaterLeakGet,
    type MerossMessage,
    type MerossPayload,
    type SensorAlertBand,
    type SensorAlertState,
    type SensorAllState,
    type SensorSmokeState
} from '../protocol';
import type { RoutedRequestOptions } from '../transport/router';

/** Hub child sensor families. Determines which push namespace the trait listens to. */
export type SensorFamily = 'tempHum' | 'contact' | 'leak' | 'smoke';

/** Map from lowercase model string to sensor family. */
export const SENSOR_FAMILY_MAP: ReadonlyMap<string, SensorFamily> = new Map([
    ['ms100', 'tempHum'],
    ['ms100f', 'tempHum'],
    ['ms130', 'tempHum'],
    ['ms200', 'contact'],
    ['ms400', 'leak'],
    ['ms405', 'leak'],
    ['ma151', 'smoke'],
    ['gs559', 'smoke'],
]);

/** Host-facing smoke condition derived from firmware status codes. */
export type SensorSmokeStatus = 'ok' | 'alarm' | 'muted' | 'error' | 'test' | 'link';

export type { SensorAlertBand };

export interface SensorValues {
    temperature?: number;
    humidity?: number;
    light?: number;
    open?: boolean;
    leak?: boolean;
    smoke?: boolean;
    smokeStatus?: SensorSmokeStatus;
    smokeError?: boolean;
    smokeMuted?: boolean;
    interConn?: boolean;
    battery?: number;
    calibration?: number;
    humidityCalibration?: number;
    temperatureAlerts?: SensorAlertBand[];
    humidityAlerts?: SensorAlertBand[];
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
const SMOKE_MUTE = 27;

/**
 * Hub child sensor. Live readings plus temp/hum calibration, alerts, MS130
 * lux, and smoke mute/test. Sprinklers and WiFi presence stay on other traits.
 */
export class SensorTrait {
    private readonly bind: SensorTraitBind;
    private readonly namespaces: ReadonlySet<string>;
    private last: SensorValues = {};

    constructor(bind: SensorTraitBind) {
        this.bind = bind;
        this.namespaces = bind.namespaces ?? new Set();
    }

    /** Fetches initial state. Idempotent; Session calls this once and does not await it. */
    start(): void {
        void this.pollInitial();
    }

    /**
     * Sets temperature/humidity calibration offsets in °C / RH%. No-op unless
     * this is a tempHum child and Adjust is advertised.
     */
    async setCalibration(options: { temperature?: number; humidity?: number }): Promise<SensorValues> {
        const patch: SensorValues = {};
        if (options.temperature !== undefined) patch.calibration = options.temperature;
        if (options.humidity !== undefined) patch.humidityCalibration = options.humidity;
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
     * Sets temperature/humidity alert bands. Values are °C / RH%. No-op unless
     * this is a tempHum child and Alert is advertised.
     */
    async setAlerts(options: { temperature?: SensorAlertBand[]; humidity?: SensorAlertBand[] }): Promise<SensorValues> {
        const patch: SensorValues = {};
        if (options.temperature) patch.temperatureAlerts = options.temperature;
        if (options.humidity) patch.humidityAlerts = options.humidity;
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
     * Silences an active smoke alarm. No-op unless smoke family.
     */
    async mute(): Promise<SensorValues> {
        return this.setSmokeStatus(SMOKE_MUTE);
    }

    /**
     * Triggers a smoke-detector self-test. No-op unless smoke family.
     */
    async test(): Promise<SensorValues> {
        return this.setSmokeStatus(SMOKE_TEST);
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
        const id = this.bind.subDeviceId;
        const family = this.bind.family;

        if (ns === HUB_SENSOR_TEMPHUM_NAMESPACE && family === 'tempHum') {
            for (const entry of decodeSensorTempHumPush(payload)) {
                if (entry.id === id) this.applyChange(tempHumPatch(entry));
            }
            return;
        }
        if (ns === HUB_SENSOR_DOORWINDOW_NAMESPACE && family === 'contact') {
            for (const entry of decodeSensorDoorWindowPush(payload)) {
                if (entry.id === id) this.applyChange({ open: entry.open });
            }
            return;
        }
        if (ns === HUB_SENSOR_WATERLEAK_NAMESPACE && family === 'leak') {
            for (const entry of decodeSensorWaterLeakPush(payload)) {
                if (entry.id === id) this.applyChange({ leak: entry.leak });
            }
            return;
        }
        if (ns === HUB_SENSOR_SMOKE_NAMESPACE && family === 'smoke') {
            for (const entry of decodeSensorSmokePush(payload)) {
                if (entry.id === id) this.applyChange(smokePatch(entry));
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
        if (ns === HUB_SENSOR_ADJUST_NAMESPACE && family === 'tempHum' && this.has(ns)) {
            for (const entry of decodeSensorAdjustPush(payload)) {
                if (entry.id === id) this.applyChange(adjustPatch(entry));
            }
            return;
        }
        if (ns === HUB_SENSOR_ALERT_NAMESPACE && family === 'tempHum' && this.has(ns)) {
            for (const entry of decodeSensorAlertPush(payload)) {
                if (entry.id === id) this.applyChange(alertPatch(entry));
            }
            return;
        }
        if (ns === HUB_SENSOR_ALL_NAMESPACE && this.has(ns)) {
            for (const entry of decodeSensorAllPush(payload)) {
                if (entry.id === id) this.applyChange(allPatch(family, entry));
            }
            return;
        }
        if (ns === SENSOR_LATESTX_NAMESPACE && family === 'tempHum' && this.has(ns)) {
            for (const entry of decodeLatestXPush(payload)) {
                if (entry.subId === id) this.applyChange(latestXPatch(entry));
            }
        }
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
        this.applyChange(patch);
        return patch;
    }

    private async pollInitial(): Promise<void> {
        try {
            await this.pollHub();
        } catch {
            // Next PUSH or setter call will recover.
        }
    }

    private async pollHub(): Promise<void> {
        if (this.has(HUB_SENSOR_ALL_NAMESPACE)) {
            try {
                const reply = await this.bind.request({
                    namespace: HUB_SENSOR_ALL_NAMESPACE,
                    method: 'GET',
                    payload: encodeSensorAllGet(this.bind.subDeviceId)
                });
                const entry = decodeSensorAllGetAck(reply.payload).find((e) => e.id === this.bind.subDeviceId);
                if (entry) this.applyChange(allPatch(this.bind.family, entry));
            } catch {
                await this.pollHubFallback();
            }
        } else {
            await this.pollHubFallback();
        }
        await this.pollHubExtras();
    }

    private async pollHubFallback(): Promise<void> {
        const { subDeviceId, family, request } = this.bind;
        switch (family) {
            case 'tempHum': {
                const reply = await request({
                    namespace: HUB_SENSOR_TEMPHUM_NAMESPACE,
                    method: 'GET',
                    payload: encodeSensorTempHumGet(subDeviceId)
                });
                const entry = decodeSensorTempHumGetAck(reply.payload).find((e) => e.id === subDeviceId);
                if (entry) this.applyChange(tempHumPatch(entry));
                break;
            }
            case 'contact': {
                const reply = await request({
                    namespace: HUB_SENSOR_DOORWINDOW_NAMESPACE,
                    method: 'GET',
                    payload: encodeSensorDoorWindowGet(subDeviceId)
                });
                const entry = decodeSensorDoorWindowGetAck(reply.payload).find((e) => e.id === subDeviceId);
                if (entry) this.applyChange({ open: entry.open });
                break;
            }
            case 'leak': {
                const reply = await request({
                    namespace: HUB_SENSOR_WATERLEAK_NAMESPACE,
                    method: 'GET',
                    payload: encodeSensorWaterLeakGet(subDeviceId)
                });
                const entry = decodeSensorWaterLeakGetAck(reply.payload).find((e) => e.id === subDeviceId);
                if (entry) this.applyChange({ leak: entry.leak });
                break;
            }
            case 'smoke': {
                const reply = await request({
                    namespace: HUB_SENSOR_SMOKE_NAMESPACE,
                    method: 'GET',
                    payload: encodeSensorSmokeGet(subDeviceId)
                });
                const entry = decodeSensorSmokeGetAck(reply.payload).find((e) => e.id === subDeviceId);
                if (entry) this.applyChange(smokePatch(entry));
                break;
            }
        }
    }

    private async pollHubExtras(): Promise<void> {
        const { subDeviceId, family } = this.bind;
        const extras = [
            this.pollHubNs(HUB_BATTERY_NAMESPACE, encodeBatteryGet(subDeviceId), (payload) => {
                const entry = decodeBatteryGetAck(payload).find((b) => b.id === subDeviceId);
                if (entry?.battery !== undefined) this.applyChange({ battery: entry.battery });
            })
        ];
        if (family === 'tempHum') {
            extras.push(
                this.pollHubNs(HUB_SENSOR_ADJUST_NAMESPACE, encodeSensorAdjustGet(subDeviceId), (payload) => {
                    const entry = decodeSensorAdjustGetAck(payload).find((e) => e.id === subDeviceId);
                    if (entry) this.applyChange(adjustPatch(entry));
                }),
                this.pollHubNs(HUB_SENSOR_ALERT_NAMESPACE, encodeSensorAlertGet(subDeviceId), (payload) => {
                    const entry = decodeSensorAlertGetAck(payload).find((e) => e.id === subDeviceId);
                    if (entry) this.applyChange(alertPatch(entry));
                }),
                this.pollHubNs(
                    SENSOR_LATESTX_NAMESPACE,
                    encodeLatestXGet({ channel: 0, subId: subDeviceId, keys: ['light', 'temp', 'humi'] }),
                    (payload) => {
                        const entry = decodeLatestXGetAck(payload).find((e) => e.subId === subDeviceId);
                        if (entry) this.applyChange(latestXPatch(entry));
                    }
                )
            );
        }
        await Promise.all(extras);
    }

    private async pollHubNs(
        namespace: string,
        payload: MerossPayload,
        apply: (payload: MerossPayload) => void
    ): Promise<void> {
        if (!this.has(namespace)) {
            return;
        }
        try {
            const reply = await this.bind.request({ namespace, method: 'GET', payload });
            apply(reply.payload);
        } catch {
            // Next PUSH or setter call will recover.
        }
    }
}

function tempHumPatch(entry: { temperature?: number; humidity?: number }): SensorValues {
    const patch: SensorValues = {};
    if (entry.temperature !== undefined) patch.temperature = entry.temperature;
    if (entry.humidity !== undefined) patch.humidity = entry.humidity;
    return patch;
}

function adjustPatch(entry: { temperature?: number; humidity?: number }): SensorValues {
    const patch: SensorValues = {};
    if (entry.temperature !== undefined) patch.calibration = entry.temperature;
    if (entry.humidity !== undefined) patch.humidityCalibration = entry.humidity;
    return patch;
}

function alertPatch(entry: SensorAlertState): SensorValues {
    const patch: SensorValues = {};
    if (entry.temperature) patch.temperatureAlerts = entry.temperature;
    if (entry.humidity) patch.humidityAlerts = entry.humidity;
    return patch;
}

function latestXPatch(entry: { temperature?: number; humidity?: number; light?: number }): SensorValues {
    const patch: SensorValues = {};
    if (entry.temperature !== undefined) patch.temperature = entry.temperature;
    if (entry.humidity !== undefined) patch.humidity = entry.humidity;
    if (entry.light !== undefined) patch.light = entry.light;
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
        case 'smoke':
            return entry.smoke ? smokePatch(entry.smoke) : {};
    }
}

function smokePatch(entry: SensorSmokeState): SensorValues {
    const status = smokeStatus(entry.status);
    const patch: SensorValues = {
        smoke: status === 'alarm',
        smokeStatus: status,
        smokeError: status === 'error',
        smokeMuted: status === 'muted'
    };
    if (entry.interConn !== undefined) {
        patch.interConn = entry.interConn !== 0;
    }
    return patch;
}

function smokeStatus(status: number): SensorSmokeStatus {
    if (status === 24 || status === 25) return 'alarm';
    if (status === 26 || status === 27) return 'muted';
    if (status >= 17 && status <= 22) return 'error';
    if (status === 23) return 'test';
    if (status === 170) return 'link';
    return 'ok';
}
