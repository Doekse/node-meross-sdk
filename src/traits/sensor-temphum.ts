import type { SensorTraitBind } from '../device/bindings';
import {
    HUB_SENSOR_ADJUST_NAMESPACE,
    HUB_SENSOR_ALERT_NAMESPACE,
    encodeSensorAdjustSet,
    encodeSensorAlertSet,
    type SensorAlertBand
} from '../protocol/codecs/sensor';
import {
    SensorTraitBase,
    type SensorValues
} from './sensor-core';

/** Hub temp/hum child (MS100 / MS130). Calibration and alert bands live here. */
export class SensorTempHumTrait extends SensorTraitBase {
    readonly kind = 'tempHum' as const;

    /** @internal */
    constructor(bind: SensorTraitBind) {
        super(bind);
    }

    async setCalibration(options: { temperature?: number; humidity?: number }): Promise<SensorValues> {
        this.requireNamespace(HUB_SENSOR_ADJUST_NAMESPACE);
        const patch: SensorValues = {};
        if (options.temperature !== undefined) {
            patch.calibration = options.temperature;
        }
        if (options.humidity !== undefined) {
            patch.humidityCalibration = options.humidity;
        }
        await this.request({
            namespace: HUB_SENSOR_ADJUST_NAMESPACE,
            method: 'SET',
            payload: encodeSensorAdjustSet({ id: this.subDeviceId, ...options })
        });
        this.applyChange(patch);
        return patch;
    }

    /**
     * Values are °C / RH%.
     */
    async setAlerts(options: { temperature?: SensorAlertBand[]; humidity?: SensorAlertBand[] }): Promise<SensorValues> {
        this.requireNamespace(HUB_SENSOR_ALERT_NAMESPACE);
        const patch: SensorValues = {};
        if (options.temperature) {
            patch.temperatureAlerts = options.temperature;
        }
        if (options.humidity) {
            patch.humidityAlerts = options.humidity;
        }
        await this.request({
            namespace: HUB_SENSOR_ALERT_NAMESPACE,
            method: 'SET',
            payload: encodeSensorAlertSet({ id: this.subDeviceId, ...options })
        });
        this.applyChange(patch);
        return patch;
    }
}
