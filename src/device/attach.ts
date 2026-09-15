import { Endpoint, type TraitName } from '../endpoint';
import type { DeviceRequest } from '../request';
import {
    CONSUMPTIONH_NAMESPACE,
    CONSUMPTIONX_NAMESPACE,
    ELECTRICITY_NAMESPACE,
    ELECTRICITYX_NAMESPACE,
    LIGHT_EFFECT_NAMESPACE,
    TIMERX_NAMESPACE,
    TOGGLEX_NAMESPACE,
    TRIGGERX_NAMESPACE
} from '../protocol';
import { AlarmTrait } from '../traits/alarm';
import { ClimateTrait, type ThermostatGeneration } from '../traits/climate';
import { CoverTrait } from '../traits/cover';
import { DiffuserTrait } from '../traits/diffuser';
import { DndTrait } from '../traits/dnd';
import { EnergyTrait } from '../traits/energy';
import { FanTrait } from '../traits/fan';
import { LightTrait } from '../traits/light';
import { MediaTrait } from '../traits/media';
import { PresenceTrait } from '../traits/presence';
import { SENSOR_FAMILY_MAP, SensorTrait } from '../traits/sensor';
import { SprayTrait } from '../traits/spray';
import { SprinklerTrait } from '../traits/sprinkler';
import { SwitchTrait } from '../traits/switch';
import { SystemTrait } from '../traits/system';
import { TimerTrait, type TimerGeneration } from '../traits/timer';
import { TriggerTrait, type TriggerGeneration } from '../traits/trigger';
import type { GraphEndpoint, PhysicalDevice } from './index';

/**
 * Constructs trait instances for one enrolled endpoint.
 *
 * meross_lan analog is `Device.async_init`, not a handler registry. Ability
 * extras (Toggle vs ToggleX, climate Mode/ModeB/ModeC, timer/trigger
 * generation) read `physical.ability`. Channel stealing for light/fan/garage
 * is enroll, not attach — do not "fix" attach to meross_lan's digest-key
 * Toggle test.
 */
export function attachEndpoint(
    graphEndpoint: GraphEndpoint,
    request: DeviceRequest,
    physical: PhysicalDevice
): Endpoint {
    const channel = graphEndpoint.channel ?? 0;
    const namespaces = new Set(Object.keys(physical.ability));
    // Assigned after traits so emitChange closures can capture the binding.
    // eslint-disable-next-line prefer-const -- definite assignment; constructed below
    let endpoint!: Endpoint;
    /**
     * Each trait declares its own `Values` interface, so the parameter is
     * widened to `object`; the spread is what gives {@link EndpointChange}
     * an indexable type.
     */
    const changeEmitter = (trait: TraitName) => (values: object) => {
        endpoint.emit('change', { trait, values: { ...values } });
    };
    let switchTrait: SwitchTrait | undefined;
    let energyTrait: EnergyTrait | undefined;
    let lightTrait: LightTrait | undefined;
    let coverTrait: CoverTrait | undefined;
    let climateTrait: ClimateTrait | undefined;
    let sensorTrait: SensorTrait | undefined;
    let presenceTrait: PresenceTrait | undefined;
    let sprinklerTrait: SprinklerTrait | undefined;
    let sprayTrait: SprayTrait | undefined;
    let fanTrait: FanTrait | undefined;
    let diffuserTrait: DiffuserTrait | undefined;
    let mediaTrait: MediaTrait | undefined;
    let alarmTrait: AlarmTrait | undefined;
    let dndTrait: DndTrait | undefined;
    let systemTrait: SystemTrait | undefined;
    let timerTrait: TimerTrait | undefined;
    let triggerTrait: TriggerTrait | undefined;
    if (graphEndpoint.traits.includes('switch')) {
        if (graphEndpoint.subDeviceId) {
            switchTrait = new SwitchTrait({
                kind: 'hub',
                uuid: physical.uuid,
                subDeviceId: graphEndpoint.subDeviceId,
                initialOn: graphEndpoint.on,
                namespaces,
                request,
                emitChange: changeEmitter('switch')
            });
        } else {
            switchTrait = new SwitchTrait({
                kind: 'board',
                uuid: physical.uuid,
                channel,
                namespace: 'Appliance.Control.Toggle' in physical.ability && !(TOGGLEX_NAMESPACE in physical.ability)
                    ? 'Appliance.Control.Toggle'
                    : TOGGLEX_NAMESPACE,
                initialOn: graphEndpoint.on,
                request,
                emitChange: changeEmitter('switch')
            });
        }
    }
    if (graphEndpoint.traits.includes('energy')) {
        const hasElectricity = ELECTRICITY_NAMESPACE in physical.ability;
        energyTrait = new EnergyTrait({
            uuid: physical.uuid,
            channel,
            hasElectricity,
            hasElectricityX: !hasElectricity && ELECTRICITYX_NAMESPACE in physical.ability,
            hasConsumptionX: CONSUMPTIONX_NAMESPACE in physical.ability,
            hasConsumptionH: CONSUMPTIONH_NAMESPACE in physical.ability,
            namespaces,
            request,
            emitChange: changeEmitter('energy')
        });
    }

    if (graphEndpoint.traits.includes('light')) {
        const abilityLight = physical.ability['Appliance.Control.Light'];
        const guessedCapacity = abilityLight && typeof abilityLight === 'object'
            ? typeof (abilityLight as { capacity?: unknown }).capacity === 'number'
                ? (abilityLight as { capacity: number }).capacity
                : 0
            : 0;

        const hasToggleX = TOGGLEX_NAMESPACE in physical.ability;
        const hasToggle = !hasToggleX && 'Appliance.Control.Toggle' in physical.ability;
        const hasLightEffect = LIGHT_EFFECT_NAMESPACE in physical.ability;

        lightTrait = new LightTrait({
            uuid: physical.uuid,
            channel,
            hasToggleX,
            hasToggle,
            hasLightEffect,
            lightCapacity: guessedCapacity,
            request,
            emitChange: changeEmitter('light')
        });
    }
    if (graphEndpoint.traits.includes('cover')) {
        const kind: 'garage' | 'shutter' = 'Appliance.RollerShutter.State' in physical.ability
            ? 'shutter'
            : 'garage';
        coverTrait = new CoverTrait({
            uuid: physical.uuid,
            channel,
            kind,
            namespaces,
            initialOpen: graphEndpoint.on,
            request,
            emitChange: changeEmitter('cover')
        });
    }
    if (graphEndpoint.traits.includes('climate')) {
        if (graphEndpoint.subDeviceId) {
            climateTrait = new ClimateTrait({
                kind: 'hub',
                uuid: physical.uuid,
                subDeviceId: graphEndpoint.subDeviceId,
                namespaces,
                request,
                emitChange: changeEmitter('climate')
            });
        } else {
            const generation: ThermostatGeneration =
                'Appliance.Control.Thermostat.ModeC' in physical.ability ? 'modeC'
                    : 'Appliance.Control.Thermostat.ModeB' in physical.ability ? 'modeB'
                        : 'mode';
            climateTrait = new ClimateTrait({
                kind: 'board',
                uuid: physical.uuid,
                channel,
                generation,
                namespaces,
                request,
                emitChange: changeEmitter('climate')
            });
        }
    }
    if (graphEndpoint.traits.includes('sensor') && graphEndpoint.subDeviceId) {
        const family = SENSOR_FAMILY_MAP.get(graphEndpoint.model.toLowerCase());
        if (family) {
            sensorTrait = new SensorTrait({
                uuid: physical.uuid,
                subDeviceId: graphEndpoint.subDeviceId,
                family,
                namespaces,
                request,
                emitChange: changeEmitter('sensor')
            });
        }
    }
    if (graphEndpoint.traits.includes('presence')) {
        presenceTrait = new PresenceTrait({
            uuid: physical.uuid,
            channel,
            namespaces,
            request,
            emitChange: changeEmitter('presence')
        });
    }
    if (graphEndpoint.traits.includes('sprinkler') && graphEndpoint.subDeviceId) {
        sprinklerTrait = new SprinklerTrait({
            uuid: physical.uuid,
            subDeviceId: graphEndpoint.subDeviceId,
            namespaces,
            request,
            emitChange: changeEmitter('sprinkler')
        });
    }
    if (graphEndpoint.traits.includes('spray')) {
        sprayTrait = new SprayTrait({
            uuid: physical.uuid,
            channel,
            request,
            emitChange: changeEmitter('spray')
        });
    }
    if (graphEndpoint.traits.includes('fan')) {
        fanTrait = new FanTrait({
            uuid: physical.uuid,
            channel,
            namespaces,
            hasToggleX: TOGGLEX_NAMESPACE in physical.ability,
            hasToggle: !(TOGGLEX_NAMESPACE in physical.ability)
                && 'Appliance.Control.Toggle' in physical.ability,
            request,
            emitChange: changeEmitter('fan')
        });
    }
    if (graphEndpoint.traits.includes('diffuser')) {
        diffuserTrait = new DiffuserTrait({
            uuid: physical.uuid,
            channel,
            namespaces,
            request,
            emitChange: changeEmitter('diffuser')
        });
    }
    if (graphEndpoint.traits.includes('media')) {
        mediaTrait = new MediaTrait({
            uuid: physical.uuid,
            channel,
            request,
            emitChange: changeEmitter('media')
        });
    }
    if (graphEndpoint.traits.includes('alarm')) {
        alarmTrait = new AlarmTrait({
            uuid: physical.uuid,
            channel,
            namespaces,
            request,
            emitChange: changeEmitter('alarm')
        });
    }
    if (graphEndpoint.traits.includes('dnd')) {
        dndTrait = new DndTrait({
            uuid: physical.uuid,
            request,
            emitChange: (on) => endpoint.emit('change', { trait: 'dnd', values: { on } })
        });
    }
    if (graphEndpoint.traits.includes('system')) {
        systemTrait = new SystemTrait({
            uuid: physical.uuid,
            initialFirmware: physical.system.firmware,
            initialHardware: physical.system.hardware,
            initialTime: physical.system.time,
            request,
            emitChange: changeEmitter('system')
        });
    }
    if (graphEndpoint.traits.includes('timer')) {
        const generation: TimerGeneration = TIMERX_NAMESPACE in physical.ability
            ? 'x'
            : 'legacy';
        timerTrait = new TimerTrait({
            uuid: physical.uuid,
            channel,
            generation,
            namespaces,
            request,
            emitChange: changeEmitter('timer')
        });
    }
    if (graphEndpoint.traits.includes('trigger')) {
        const generation: TriggerGeneration = TRIGGERX_NAMESPACE in physical.ability
            ? 'x'
            : 'legacy';
        triggerTrait = new TriggerTrait({
            uuid: physical.uuid,
            channel,
            generation,
            namespaces,
            request,
            emitChange: changeEmitter('trigger')
        });
    }
    endpoint = new Endpoint({
        id: graphEndpoint.id,
        traits: graphEndpoint.traits,
        switch: switchTrait,
        energy: energyTrait,
        light: lightTrait,
        cover: coverTrait,
        climate: climateTrait,
        sensor: sensorTrait,
        presence: presenceTrait,
        sprinkler: sprinklerTrait,
        spray: sprayTrait,
        fan: fanTrait,
        diffuser: diffuserTrait,
        media: mediaTrait,
        alarm: alarmTrait,
        dnd: dndTrait,
        system: systemTrait,
        timer: timerTrait,
        trigger: triggerTrait,
        initialOnline: graphEndpoint.online
    });
    return endpoint;
}
