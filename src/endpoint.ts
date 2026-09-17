import { EventEmitter } from 'node:events';

import type { MerossMessage } from './protocol';
import type { AlarmTrait, AlarmValues } from './traits/alarm';
import type { AlertTrait, AlertValues } from './traits/alert';
import type { ClimateTrait, ClimateValues } from './traits/climate';
import type { CoverTrait, CoverValues } from './traits/cover';
import type { DiffuserTrait, DiffuserValues } from './traits/diffuser';
import type { DndTrait, DndValues } from './traits/dnd';
import type { EnergyTrait, EnergyValues } from './traits/energy';
import type { FanTrait, FanValues } from './traits/fan';
import type { LightTrait, LightValues } from './traits/light';
import type { MediaTrait, MediaValues } from './traits/media';
import type { OverTempTrait, OverTempValues } from './traits/overtemp';
import type { PresenceTrait, PresenceValues } from './traits/presence';
import type { SensorTrait, SensorValues } from './traits/sensor';
import type { SprayTrait, SprayValues } from './traits/spray';
import type { SprinklerTrait, SprinklerValues } from './traits/sprinkler';
import type { SwitchTrait, SwitchValues } from './traits/switch';
import type { SystemTrait, SystemValues } from './traits/system';
import type { TimerTrait, TimerValues } from './traits/timer';
import type { TriggerTrait, TriggerValues } from './traits/trigger';

export type TraitName =
    | 'switch' | 'energy' | 'light' | 'climate' | 'cover'
    | 'sensor' | 'presence' | 'sprinkler' | 'spray' | 'fan' | 'diffuser' | 'media'
    | 'alarm' | 'alert' | 'dnd' | 'overtemp'
    | 'system' | 'timer' | 'trigger';

/**
 * Per-trait snapshot shapes for {@link EndpointChange}. Kept off the public
 * barrel so hosts narrow on `change.trait` instead of indexing this map.
 */
export interface TraitValues {
    switch: SwitchValues;
    energy: EnergyValues;
    light: LightValues;
    climate: ClimateValues;
    cover: CoverValues;
    sensor: SensorValues;
    presence: PresenceValues;
    sprinkler: SprinklerValues;
    spray: SprayValues;
    fan: FanValues;
    diffuser: DiffuserValues;
    media: MediaValues;
    alarm: AlarmValues;
    alert: AlertValues;
    dnd: DndValues;
    overtemp: OverTempValues;
    system: SystemValues;
    timer: TimerValues;
    trigger: TriggerValues;
}

/**
 * Discriminated by `trait` so hosts can narrow `values` without a cast.
 * A new {@link TraitName} without a {@link TraitValues} entry is a compile error.
 */
export type EndpointChange = {
    [K in TraitName]: { trait: K; values: TraitValues[K] }
}[TraitName];

/** LAN HTTP or cloud MQTT. Hosts display this; they cannot pick which path a request uses. */
export type Protocol = 'http' | 'mqtt';

export interface EndpointOptions {
    id: string;
    traits?: readonly TraitName[];
    switch?: SwitchTrait;
    energy?: EnergyTrait;
    light?: LightTrait;
    cover?: CoverTrait;
    climate?: ClimateTrait;
    sensor?: SensorTrait;
    presence?: PresenceTrait;
    sprinkler?: SprinklerTrait;
    spray?: SprayTrait;
    fan?: FanTrait;
    diffuser?: DiffuserTrait;
    media?: MediaTrait;
    alarm?: AlarmTrait;
    alert?: AlertTrait;
    dnd?: DndTrait;
    overtemp?: OverTempTrait;
    system?: SystemTrait;
    timer?: TimerTrait;
    trigger?: TriggerTrait;
    initialOnline?: boolean;
}

interface EndpointEvents {
    change: [change: EndpointChange];
    availability: [online: boolean];
    protocol: [protocol: Protocol];
    /**
     * One trait's handlePush threw; the rest of the batch still ran, same as
     * {@link SessionEvents.warning}.
     *
     * Deliberately not named `error`: Node throws on an unhandled `error`
     * emit, which would turn one trait's decode bug into a crashed host
     * process.
     */
    warning: [error: Error, trait: TraitName];
}

/**
 * One user-visible device. A strip is a master plus child sockets; hub
 * children use this same type. `parentId` stays inventory metadata.
 */
export class Endpoint extends EventEmitter<EndpointEvents> {
    readonly id: string;
    readonly traits: readonly TraitName[];
    readonly switch?: SwitchTrait;
    readonly energy?: EnergyTrait;
    readonly light?: LightTrait;
    readonly cover?: CoverTrait;
    readonly climate?: ClimateTrait;
    readonly sensor?: SensorTrait;
    readonly presence?: PresenceTrait;
    readonly sprinkler?: SprinklerTrait;
    readonly spray?: SprayTrait;
    readonly fan?: FanTrait;
    readonly diffuser?: DiffuserTrait;
    readonly media?: MediaTrait;
    readonly alarm?: AlarmTrait;
    readonly alert?: AlertTrait;
    readonly dnd?: DndTrait;
    readonly overtemp?: OverTempTrait;
    readonly system?: SystemTrait;
    readonly timer?: TimerTrait;
    readonly trigger?: TriggerTrait;

    private online: boolean;
    private currentProtocol: Protocol;

    constructor(options: EndpointOptions) {
        super();
        this.id = options.id;
        this.traits = options.traits ?? [];
        this.switch = options.switch;
        this.energy = options.energy;
        this.light = options.light;
        this.cover = options.cover;
        this.climate = options.climate;
        this.sensor = options.sensor;
        this.presence = options.presence;
        this.sprinkler = options.sprinkler;
        this.spray = options.spray;
        this.fan = options.fan;
        this.diffuser = options.diffuser;
        this.media = options.media;
        this.alarm = options.alarm;
        this.alert = options.alert;
        this.dnd = options.dnd;
        this.overtemp = options.overtemp;
        this.system = options.system;
        this.timer = options.timer;
        this.trigger = options.trigger;
        this.online = options.initialOnline ?? true;
        this.currentProtocol = 'mqtt';
    }

    /**
     * Current availability. Inventory omits this so hosts cannot read a
     * snapshot frozen at enroll.
     */
    isOnline(): boolean {
        return this.online;
    }

    /**
     * Current request protocol. Inventory omits this so hosts cannot read a
     * snapshot frozen at enroll.
     */
    protocol(): Protocol {
        return this.currentProtocol;
    }

    /**
     * Driven by {@link traits} rather than a hand-listed set, so adding a trait
     * cannot leave it silently deaf to PUSH frames. Handler exceptions are
     * isolated so one namespace cannot drop the rest of a GETACK batch; the
     * failure is still surfaced via `warning` rather than swallowed.
     *
     * Session/runtime owns PUSH delivery; hosts subscribe to `change` instead.
     *
     * @internal
     * @package
     */
    handlePush(message: MerossMessage): void {
        for (const trait of this.traits) {
            try {
                this[trait]?.handlePush(message);
            } catch (error) {
                this.emitWarning(error, trait);
            }
        }
    }

    private emitWarning(error: unknown, trait: TraitName): void {
        this.emit('warning', error instanceof Error ? error : new Error(String(error)), trait);
    }

    /**
     * `force` is for the initial fan-out so hosts get a first availability
     * event even when the value matches the constructor default.
     *
     * Session/runtime drives availability; hosts subscribe to `availability`.
     *
     * @internal
     * @package
     */
    setAvailability(online: boolean, force = false): void {
        if (!force && this.online === online) {
            return;
        }
        this.online = online;
        this.emit('availability', online);
    }

    /**
     * `force` is for the initial fan-out so hosts get a first protocol
     * event even when the value matches the constructor default.
     *
     * Session/runtime drives protocol changes; hosts subscribe to `protocol`.
     *
     * @internal
     * @package
     */
    setProtocol(protocol: Protocol, force = false): void {
        if (!force && this.currentProtocol === protocol) {
            return;
        }
        this.currentProtocol = protocol;
        this.emit('protocol', protocol);
    }
}
