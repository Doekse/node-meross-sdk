import type { TraitAttachContext } from '../device/enroll-context';
import type { TraitDescriptor } from './descriptor';
import { SensorCatalog } from './sensor.catalog';
import {
    SensorContactTrait,
    SensorLeakTrait,
    SensorMotionTrait,
    type SensorTraitBind
} from './sensor-core';
import { SENSOR_FAMILY_MAP, type SensorKind } from './sensor-family';
import { SensorSmokeTrait } from './sensor-smoke';
import { SensorTempHumTrait } from './sensor-temphum';

export { SENSOR_FAMILY_MAP, type SensorKind } from './sensor-family';
export type {
    SensorAlertBand,
    SensorSmokeStatus,
    SensorTraitBind,
    SensorValues
} from './sensor-core';
export { SensorContactTrait, SensorLeakTrait, SensorMotionTrait } from './sensor-core';
export { SensorSmokeTrait } from './sensor-smoke';
export { SensorTempHumTrait } from './sensor-temphum';

/**
 * One enrolled hub sensor. Narrow on `kind` before calling tempHum
 * (`setCalibration`, `setAlerts`) or smoke (`mute`, `test`) methods.
 */
export type SensorTrait =
    | SensorTempHumTrait
    | SensorContactTrait
    | SensorLeakTrait
    | SensorMotionTrait
    | SensorSmokeTrait;

function sensorTrait(kind: SensorKind, bind: SensorTraitBind): SensorTrait {
    switch (kind) {
        case 'tempHum':
            return new SensorTempHumTrait(bind);
        case 'contact':
            return new SensorContactTrait(bind);
        case 'leak':
            return new SensorLeakTrait(bind);
        case 'motion':
            return new SensorMotionTrait(bind);
        case 'smoke':
            return new SensorSmokeTrait(bind);
    }
}

export const descriptor: TraitDescriptor<'sensor', SensorTrait> = {
    ...SensorCatalog,
    attach(args: TraitAttachContext<'sensor'>): SensorTrait | undefined {
        if (!args.graphEndpoint.subDeviceId) {
            return undefined;
        }
        // Enroll already rewrote aliases; omit when the canonical model is
        // missing from SENSOR_FAMILY_MAP (traits still list 'sensor').
        const kind = SENSOR_FAMILY_MAP.get(args.graphEndpoint.model.toLowerCase());
        if (!kind) {
            return undefined;
        }
        return sensorTrait(kind, {
            subDeviceId: args.graphEndpoint.subDeviceId,
            namespaces: args.namespaces,
            request: args.request,
            emitChange: args.emitChange
        });
    }
};
