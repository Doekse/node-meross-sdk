import type { TraitName } from '../endpoint';
import type { TraitDescriptor } from './descriptor';
import { AlarmDescriptor } from './alarm';
import { ClimateDescriptor } from './climate';
import { CoverDescriptor } from './cover';
import { DiffuserDescriptor } from './diffuser';
import { DndDescriptor } from './dnd';
import { EnergyDescriptor } from './energy';
import { FanDescriptor } from './fan';
import { LightDescriptor } from './light';
import { MediaDescriptor } from './media';
import { OverTempDescriptor } from './overtemp';
import { PresenceDescriptor } from './presence';
import { SensorDescriptor } from './sensor';
import { SprayDescriptor } from './spray';
import { SprinklerDescriptor } from './sprinkler';
import { SwitchDescriptor } from './switch';
import { SystemDescriptor } from './system';
import { TimerDescriptor } from './timer';
import { TriggerDescriptor } from './trigger';

/**
 * Exhaustive colocated catalog. Enroll, attach, and POLL construction keep
 * explicit call sites and must not iterate this map — tests use it for
 * pairwise poll-key ownership.
 */
export const TRAIT_DESCRIPTORS = {
    switch: SwitchDescriptor,
    energy: EnergyDescriptor,
    light: LightDescriptor,
    climate: ClimateDescriptor,
    cover: CoverDescriptor,
    sensor: SensorDescriptor,
    presence: PresenceDescriptor,
    sprinkler: SprinklerDescriptor,
    spray: SprayDescriptor,
    fan: FanDescriptor,
    diffuser: DiffuserDescriptor,
    media: MediaDescriptor,
    alarm: AlarmDescriptor,
    dnd: DndDescriptor,
    overtemp: OverTempDescriptor,
    system: SystemDescriptor,
    timer: TimerDescriptor,
    trigger: TriggerDescriptor
} as const satisfies { [K in TraitName]: TraitDescriptor & { name: K } };
