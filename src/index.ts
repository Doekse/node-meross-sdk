/**
 * Public exports only. Transports, namespace codecs, and the device graph
 * stay unexported so hosts program against Session, Endpoint, and traits.
 */
export { MerossError, NotImplementedError, AuthError, CloudError } from './errors';
export { Session } from './session';
export type { LoginOptions, TokenData } from './session';
export { Inventory } from './inventory';
export type { ClassHint, InventoryRow } from './inventory';
export { Endpoint } from './endpoint';
export type { EndpointChange, TraitName } from './endpoint';
export {
    SwitchTrait, EnergyTrait, LightTrait, CoverTrait, ClimateTrait,
    SensorTrait, PresenceTrait, SprinklerTrait, SprayTrait, FanTrait, DiffuserTrait, MediaTrait,
    AlarmTrait, DndTrait, TimerTrait, TriggerTrait
} from './traits';
export type {
    SensorFamily, SensorValues, SensorSmokeStatus, SensorAlertBand,
    PresenceValues, SprinklerValues, SprayValues, SprayMode, FanValues,
    DiffuserValues, DiffuserLightMode, DiffuserSprayMode, MediaValues, AlarmValues,
    TimerEntry, TimerSetInput, TimerValues,
    TriggerEntry, TriggerRule, TriggerSetInput, TriggerValues
} from './traits';
