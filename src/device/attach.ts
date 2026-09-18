import { Endpoint } from '../endpoint';
import type { DeviceRequest } from '../request';
import { loadTrait } from '../traits/load';
import type { AlarmTrait, AlarmValues } from '../traits/alarm';
import type { AlertTrait, AlertValues } from '../traits/alert';
import type { ClimateTrait, ClimateValues } from '../traits/climate';
import type { CoverTrait, CoverValues } from '../traits/cover';
import type { DiffuserTrait, DiffuserValues } from '../traits/diffuser';
import type { DndTrait, DndValues } from '../traits/dnd';
import type { EnergyTrait, EnergyValues } from '../traits/energy';
import type { FanTrait, FanValues } from '../traits/fan';
import type { LightTrait, LightValues } from '../traits/light';
import type { MediaTrait, MediaValues } from '../traits/media';
import type { OverTempTrait, OverTempValues } from '../traits/overtemp';
import type { PresenceTrait, PresenceValues } from '../traits/presence';
import type { SensorTrait, SensorValues } from '../traits/sensor';
import type { SprayTrait, SprayValues } from '../traits/spray';
import type { SprinklerTrait, SprinklerValues } from '../traits/sprinkler';
import type { StandbyKillerTrait, StandbyKillerValues } from '../traits/standbykiller';
import type { SwitchTrait, SwitchValues } from '../traits/switch';
import type { SystemTrait, SystemValues } from '../traits/system';
import type { TimerTrait, TimerValues } from '../traits/timer';
import type { TriggerTrait, TriggerValues } from '../traits/trigger';
import type { GraphEndpoint, PhysicalDevice } from './index';

/**
 * Constructs trait instances for one enrolled endpoint.
 *
 * meross_lan analog is `Device.async_init`, not a handler registry. Ability
 * extras (Toggle vs ToggleX, climate Mode/ModeB/ModeC, timer/trigger
 * generation) read `physical.ability`. Channel stealing for light/fan/garage
 * is enroll, not attach — do not "fix" attach to meross_lan's digest-key
 * Toggle test. Trait modules load only when `graphEndpoint.traits` lists them.
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
        alert: (values: AlertValues) => {
            endpoint.emit('change', { trait: 'alert', values: { ...values } });
        },
        dnd: (values: DndValues) => {
            endpoint.emit('change', { trait: 'dnd', values: { ...values } });
        },
        overtemp: (values: OverTempValues) => {
            endpoint.emit('change', { trait: 'overtemp', values: { ...values } });
        },
        standbykiller: (values: StandbyKillerValues) => {
            endpoint.emit('change', { trait: 'standbykiller', values: { ...values } });
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
    let alertTrait: AlertTrait | undefined;
    let dndTrait: DndTrait | undefined;
    let overTempTrait: OverTempTrait | undefined;
    let standbyKillerTrait: StandbyKillerTrait | undefined;
    let systemTrait: SystemTrait | undefined;
    let timerTrait: TimerTrait | undefined;
    let triggerTrait: TriggerTrait | undefined;
    const shared = {
        graphEndpoint,
        physical,
        request,
        channel,
        namespaces
    };
    if (graphEndpoint.traits.includes('switch')) {
        switchTrait = loadTrait('switch').SwitchDescriptor.attach({
            ...shared,
            emitChange: emit.switch
        });
    }
    if (graphEndpoint.traits.includes('energy')) {
        energyTrait = loadTrait('energy').EnergyDescriptor.attach({
            ...shared,
            emitChange: emit.energy
        });
    }
    if (graphEndpoint.traits.includes('light')) {
        lightTrait = loadTrait('light').LightDescriptor.attach({
            ...shared,
            emitChange: emit.light
        });
    }
    if (graphEndpoint.traits.includes('cover')) {
        coverTrait = loadTrait('cover').CoverDescriptor.attach({
            ...shared,
            emitChange: emit.cover
        });
    }
    if (graphEndpoint.traits.includes('climate')) {
        climateTrait = loadTrait('climate').ClimateDescriptor.attach({
            ...shared,
            emitChange: emit.climate
        });
    }
    if (graphEndpoint.traits.includes('sensor')) {
        sensorTrait = loadTrait('sensor').SensorDescriptor.attach({
            ...shared,
            emitChange: emit.sensor
        });
    }
    if (graphEndpoint.traits.includes('presence')) {
        presenceTrait = loadTrait('presence').PresenceDescriptor.attach({
            ...shared,
            emitChange: emit.presence
        });
    }
    if (graphEndpoint.traits.includes('sprinkler')) {
        sprinklerTrait = loadTrait('sprinkler').SprinklerDescriptor.attach({
            ...shared,
            emitChange: emit.sprinkler
        });
    }
    if (graphEndpoint.traits.includes('spray')) {
        sprayTrait = loadTrait('spray').SprayDescriptor.attach({
            ...shared,
            emitChange: emit.spray
        });
    }
    if (graphEndpoint.traits.includes('fan')) {
        fanTrait = loadTrait('fan').FanDescriptor.attach({
            ...shared,
            emitChange: emit.fan
        });
    }
    if (graphEndpoint.traits.includes('diffuser')) {
        diffuserTrait = loadTrait('diffuser').DiffuserDescriptor.attach({
            ...shared,
            emitChange: emit.diffuser
        });
    }
    if (graphEndpoint.traits.includes('media')) {
        mediaTrait = loadTrait('media').MediaDescriptor.attach({
            ...shared,
            emitChange: emit.media
        });
    }
    if (graphEndpoint.traits.includes('alarm')) {
        alarmTrait = loadTrait('alarm').AlarmDescriptor.attach({
            ...shared,
            emitChange: emit.alarm
        });
    }
    if (graphEndpoint.traits.includes('alert')) {
        alertTrait = loadTrait('alert').AlertDescriptor.attach({
            ...shared,
            emitChange: emit.alert
        });
    }
    if (graphEndpoint.traits.includes('dnd')) {
        dndTrait = loadTrait('dnd').DndDescriptor.attach({
            ...shared,
            emitChange: emit.dnd
        });
    }
    if (graphEndpoint.traits.includes('overtemp')) {
        overTempTrait = loadTrait('overtemp').OverTempDescriptor.attach({
            ...shared,
            emitChange: emit.overtemp
        });
    }
    if (graphEndpoint.traits.includes('standbykiller')) {
        standbyKillerTrait = loadTrait('standbykiller').StandbyKillerDescriptor.attach({
            ...shared,
            emitChange: emit.standbykiller
        });
    }
    if (graphEndpoint.traits.includes('system')) {
        systemTrait = loadTrait('system').SystemDescriptor.attach({
            ...shared,
            emitChange: emit.system
        });
    }
    if (graphEndpoint.traits.includes('timer')) {
        timerTrait = loadTrait('timer').TimerDescriptor.attach({
            ...shared,
            emitChange: emit.timer
        });
    }
    if (graphEndpoint.traits.includes('trigger')) {
        triggerTrait = loadTrait('trigger').TriggerDescriptor.attach({
            ...shared,
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
        alert: alertTrait,
        dnd: dndTrait,
        overtemp: overTempTrait,
        standbykiller: standbyKillerTrait,
        system: systemTrait,
        timer: timerTrait,
        trigger: triggerTrait,
        initialOnline: graphEndpoint.online
    });
    return endpoint;
}
