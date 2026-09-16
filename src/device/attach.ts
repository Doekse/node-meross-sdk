import { Endpoint } from '../endpoint';
import type { DeviceRequest } from '../request';
import {
    LIGHT_EFFECT_NAMESPACE,
    TOGGLEX_NAMESPACE
} from '../protocol';
import { AlarmDescriptor, AlarmTrait, type AlarmValues } from '../traits/alarm';
import { ClimateTrait, type ClimateValues, type ThermostatGeneration } from '../traits/climate';
import { CoverTrait, type CoverValues } from '../traits/cover';
import { DiffuserTrait, type DiffuserValues } from '../traits/diffuser';
import { DndDescriptor, DndTrait, type DndValues } from '../traits/dnd';
import { EnergyDescriptor, EnergyTrait, type EnergyValues } from '../traits/energy';
import { FanTrait, type FanValues } from '../traits/fan';
import { LightTrait, type LightValues } from '../traits/light';
import { MediaDescriptor, MediaTrait, type MediaValues } from '../traits/media';
import { PresenceTrait, type PresenceValues } from '../traits/presence';
import { SENSOR_FAMILY_MAP, SensorTrait, type SensorValues } from '../traits/sensor';
import { SprayTrait, type SprayValues } from '../traits/spray';
import { SprinklerTrait, type SprinklerValues } from '../traits/sprinkler';
import { SwitchTrait, type SwitchValues } from '../traits/switch';
import { SystemDescriptor, SystemTrait, type SystemValues } from '../traits/system';
import { TimerDescriptor, TimerTrait, type TimerValues } from '../traits/timer';
import { TriggerDescriptor, TriggerTrait, type TriggerValues } from '../traits/trigger';
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
    // Literal keys so each arm's `values` stays that trait's snapshot type.
    // A shared factory would widen and need `as EndpointChange`.
    // Spread copies so hosts cannot mutate trait `last` through the event.
    const emit = {
        switch: (values: SwitchValues) => {
            endpoint.emit('change', { trait: 'switch', values: { ...values } });
        },
        energy: (values: EnergyValues) => {
            endpoint.emit('change', { trait: 'energy', values: { ...values } });
        },
        light: (values: LightValues) => {
            endpoint.emit('change', { trait: 'light', values: { ...values } });
        },
        cover: (values: CoverValues) => {
            endpoint.emit('change', { trait: 'cover', values: { ...values } });
        },
        climate: (values: ClimateValues) => {
            endpoint.emit('change', { trait: 'climate', values: { ...values } });
        },
        sensor: (values: SensorValues) => {
            endpoint.emit('change', { trait: 'sensor', values: { ...values } });
        },
        presence: (values: PresenceValues) => {
            endpoint.emit('change', { trait: 'presence', values: { ...values } });
        },
        sprinkler: (values: SprinklerValues) => {
            endpoint.emit('change', { trait: 'sprinkler', values: { ...values } });
        },
        spray: (values: SprayValues) => {
            endpoint.emit('change', { trait: 'spray', values: { ...values } });
        },
        fan: (values: FanValues) => {
            endpoint.emit('change', { trait: 'fan', values: { ...values } });
        },
        diffuser: (values: DiffuserValues) => {
            endpoint.emit('change', { trait: 'diffuser', values: { ...values } });
        },
        media: (values: MediaValues) => {
            endpoint.emit('change', { trait: 'media', values: { ...values } });
        },
        alarm: (values: AlarmValues) => {
            endpoint.emit('change', { trait: 'alarm', values: { ...values } });
        },
        dnd: (values: DndValues) => {
            endpoint.emit('change', { trait: 'dnd', values: { ...values } });
        },
        system: (values: SystemValues) => {
            endpoint.emit('change', { trait: 'system', values: { ...values } });
        },
        timer: (values: TimerValues) => {
            endpoint.emit('change', { trait: 'timer', values: { ...values } });
        },
        trigger: (values: TriggerValues) => {
            endpoint.emit('change', { trait: 'trigger', values: { ...values } });
        }
    } as const;
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
                emitChange: emit.switch
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
                emitChange: emit.switch
            });
        }
    }
    if (graphEndpoint.traits.includes('energy')) {
        energyTrait = EnergyDescriptor.attach({
            graphEndpoint,
            physical,
            request,
            channel,
            namespaces,
            emitChange: emit.energy
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
            emitChange: emit.light
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
            emitChange: emit.cover
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
                emitChange: emit.climate
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
                emitChange: emit.climate
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
                emitChange: emit.sensor
            });
        }
    }
    if (graphEndpoint.traits.includes('presence')) {
        presenceTrait = new PresenceTrait({
            uuid: physical.uuid,
            channel,
            namespaces,
            request,
            emitChange: emit.presence
        });
    }
    if (graphEndpoint.traits.includes('sprinkler') && graphEndpoint.subDeviceId) {
        sprinklerTrait = new SprinklerTrait({
            uuid: physical.uuid,
            subDeviceId: graphEndpoint.subDeviceId,
            namespaces,
            request,
            emitChange: emit.sprinkler
        });
    }
    if (graphEndpoint.traits.includes('spray')) {
        sprayTrait = new SprayTrait({
            uuid: physical.uuid,
            channel,
            request,
            emitChange: emit.spray
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
            emitChange: emit.fan
        });
    }
    if (graphEndpoint.traits.includes('diffuser')) {
        diffuserTrait = new DiffuserTrait({
            uuid: physical.uuid,
            channel,
            namespaces,
            request,
            emitChange: emit.diffuser
        });
    }
    if (graphEndpoint.traits.includes('media')) {
        mediaTrait = MediaDescriptor.attach({
            graphEndpoint,
            physical,
            request,
            channel,
            namespaces,
            emitChange: emit.media
        });
    }
    if (graphEndpoint.traits.includes('alarm')) {
        alarmTrait = AlarmDescriptor.attach({
            graphEndpoint,
            physical,
            request,
            channel,
            namespaces,
            emitChange: emit.alarm
        });
    }
    if (graphEndpoint.traits.includes('dnd')) {
        dndTrait = DndDescriptor.attach({
            graphEndpoint,
            physical,
            request,
            channel,
            namespaces,
            emitChange: emit.dnd
        });
    }
    if (graphEndpoint.traits.includes('system')) {
        systemTrait = SystemDescriptor.attach({
            graphEndpoint,
            physical,
            request,
            channel,
            namespaces,
            emitChange: emit.system
        });
    }
    if (graphEndpoint.traits.includes('timer')) {
        timerTrait = TimerDescriptor.attach({
            graphEndpoint,
            physical,
            request,
            channel,
            namespaces,
            emitChange: emit.timer
        });
    }
    if (graphEndpoint.traits.includes('trigger')) {
        triggerTrait = TriggerDescriptor.attach({
            graphEndpoint,
            physical,
            request,
            channel,
            namespaces,
            emitChange: emit.trigger
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
