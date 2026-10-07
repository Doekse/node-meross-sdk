import { MerossError } from '../errors';
import {
    HUB_SENSOR_SMOKE_NAMESPACE,
    SMOKE_CONFIG_NAMESPACE,
    encodeSensorSmokeSet,
    encodeSmokeConfigSet
} from '../protocol/codecs/sensor';
import {
    SensorTraitBase,
    smokeConfigPatch,
    smokePatch,
    type SensorTraitBind,
    type SensorValues
} from './sensor-core';

const SMOKE_TEST = 23;

/** SET mute is only valid from the matching live alarm/error; otherwise firmware returns 5000. */
const SMOKE_MUTE_MAP: Readonly<Record<number, number>> = {
    17: 20,
    18: 21,
    19: 22,
    24: 26,
    25: 27
};

/** Hub smoke child (MA151 / GS559). Mute codes must match the live wire status. */
export class SensorSmokeTrait extends SensorTraitBase {
    readonly kind = 'smoke' as const;

    /** @internal */
    constructor(bind: SensorTraitBind) {
        super(bind);
    }

    /**
     * Firmware only accepts the mute code that matches the live status
     * (smoke 25→27, temperature 24→26, faults 17–19→20–22).
     */
    async mute(): Promise<SensorValues> {
        this.requireNamespace(HUB_SENSOR_SMOKE_NAMESPACE);
        const mapped = this.lastSmokeStatus === undefined
            ? undefined
            : SMOKE_MUTE_MAP[this.lastSmokeStatus];
        if (mapped === undefined) {
            throw new MerossError(
                'sensor.mute() requires a live alarm or fault',
                'UNSUPPORTED'
            );
        }
        return this.setSmokeStatus(mapped);
    }

    async test(): Promise<SensorValues> {
        return this.setSmokeStatus(SMOKE_TEST);
    }

    async setSmokeDnd(enabled: boolean): Promise<SensorValues> {
        return this.setSmokeConfig({ dndEnabled: enabled });
    }

    async setSmokeDetect(enabled: boolean): Promise<SensorValues> {
        return this.setSmokeConfig({ detectEnabled: enabled });
    }

    private async setSmokeStatus(status: number): Promise<SensorValues> {
        this.requireNamespace(HUB_SENSOR_SMOKE_NAMESPACE);
        const patch = smokePatch({ id: this.subDeviceId, status });
        await this.request({
            namespace: HUB_SENSOR_SMOKE_NAMESPACE,
            method: 'SET',
            payload: encodeSensorSmokeSet({ id: this.subDeviceId, status })
        });
        this.lastSmokeStatus = status;
        this.applyChange(patch);
        return patch;
    }

    private async setSmokeConfig(options: { dndEnabled?: boolean; detectEnabled?: boolean }): Promise<SensorValues> {
        this.requireNamespace(SMOKE_CONFIG_NAMESPACE);
        const patch = smokeConfigPatch(options);
        await this.request({
            namespace: SMOKE_CONFIG_NAMESPACE,
            method: 'SET',
            payload: encodeSmokeConfigSet({
                channel: 0,
                subId: this.subDeviceId,
                ...options
            })
        });
        this.applyChange(patch);
        return patch;
    }
}
