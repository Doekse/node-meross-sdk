import type { TraitName } from '../endpoint';
import type { TraitCatalog } from './descriptor';
import { AlarmCatalog } from './alarm.catalog';
import { AlertCatalog } from './alert.catalog';
import { ClimateCatalog } from './climate.catalog';
import { CoverCatalog } from './cover.catalog';
import { DiffuserCatalog } from './diffuser.catalog';
import { DndCatalog } from './dnd.catalog';
import { EnergyCatalog } from './energy.catalog';
import { FanCatalog } from './fan.catalog';
import { LightCatalog } from './light.catalog';
import { MediaCatalog } from './media.catalog';
import { OverTempCatalog } from './overtemp.catalog';
import { PresenceCatalog } from './presence.catalog';
import { SensorCatalog } from './sensor.catalog';
import { SprayCatalog } from './spray.catalog';
import { SprinklerCatalog } from './sprinkler.catalog';
import { StandbyKillerCatalog } from './standbykiller.catalog';
import { SwitchCatalog } from './switch.catalog';
import { SystemCatalog } from './system.catalog';
import { TimerCatalog } from './timer.catalog';
import { TriggerCatalog } from './trigger.catalog';

/**
 * Exhaustive poll/PUSH catalog. Jobs and runtime iterate this; trait classes
 * stay behind `loadTrait` so a plug enroll does not load climate.ts.
 */
export const TRAIT_CATALOGS = {
    switch: SwitchCatalog,
    energy: EnergyCatalog,
    light: LightCatalog,
    climate: ClimateCatalog,
    cover: CoverCatalog,
    sensor: SensorCatalog,
    presence: PresenceCatalog,
    sprinkler: SprinklerCatalog,
    spray: SprayCatalog,
    fan: FanCatalog,
    diffuser: DiffuserCatalog,
    media: MediaCatalog,
    alarm: AlarmCatalog,
    alert: AlertCatalog,
    dnd: DndCatalog,
    overtemp: OverTempCatalog,
    standbykiller: StandbyKillerCatalog,
    system: SystemCatalog,
    timer: TimerCatalog,
    trigger: TriggerCatalog
} as const satisfies { [K in TraitName]: TraitCatalog & { name: K } };
