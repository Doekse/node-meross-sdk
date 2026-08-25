import { EventEmitter } from 'node:events';

import type { AlarmTrait } from './traits/alarm';
import type { ClimateTrait } from './traits/climate';
import type { CoverTrait } from './traits/cover';
import type { DiffuserTrait } from './traits/diffuser';
import type { DndTrait } from './traits/dnd';
import type { EnergyTrait } from './traits/energy';
import type { FanTrait } from './traits/fan';
import type { LightTrait } from './traits/light';
import type { MediaTrait } from './traits/media';
import type { PresenceTrait } from './traits/presence';
import type { SensorTrait } from './traits/sensor';
import type { SprayTrait } from './traits/spray';
import type { SprinklerTrait } from './traits/sprinkler';
import type { SwitchTrait } from './traits/switch';
import type { TimerTrait } from './traits/timer';
import type { TriggerTrait } from './traits/trigger';

export type TraitName =
    | 'switch' | 'energy' | 'light' | 'climate' | 'cover'
    | 'sensor' | 'presence' | 'sprinkler' | 'spray' | 'fan' | 'diffuser' | 'media' | 'alarm' | 'dnd'
    | 'timer' | 'trigger';

export interface EndpointChange {
    trait: TraitName;
    values: Record<string, unknown>;
}

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
    dnd?: DndTrait;
    timer?: TimerTrait;
    trigger?: TriggerTrait;
    initialOnline?: boolean;
}

interface EndpointEvents {
    change: [change: EndpointChange];
    availability: [online: boolean];
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
    readonly dnd?: DndTrait;
    readonly timer?: TimerTrait;
    readonly trigger?: TriggerTrait;

    private online: boolean;

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
        this.dnd = options.dnd;
        this.timer = options.timer;
        this.trigger = options.trigger;
        this.online = options.initialOnline ?? true;
    }

    /**
     * Current availability. Inventory omits this so hosts cannot read a
     * snapshot frozen at enroll.
     */
    isOnline(): boolean {
        return this.online;
    }

    /**
     * `force` is for the initial fan-out so hosts get a first availability
     * event even when the value matches the constructor default.
     */
    setAvailability(online: boolean, force = false): void {
        if (!force && this.online === online) {
            return;
        }
        this.online = online;
        this.emit('availability', online);
    }
}
