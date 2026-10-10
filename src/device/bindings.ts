/**
 * Constructor arguments for trait classes. Session and trait tests build
 * these; the host barrel does not export them, and the class modules do not
 * re-export them, so the published trait `.d.ts` stays the host class.
 */
import type {
    SystemFirmwareState,
    SystemHardwareState,
    SystemTimeState
} from '../protocol/codecs/system';
import { TOGGLE_NAMESPACE, TOGGLEX_NAMESPACE } from '../protocol/namespaces';
import type { DeviceRequest } from '../request';
import type { AlarmValues } from '../traits/alarm';
import type { AlertValues } from '../traits/alert';
import type { ClimateValues } from '../traits/climate-core';
import type { CoverValues } from '../traits/cover-core';
import type { DiffuserValues } from '../traits/diffuser';
import type { DndValues } from '../traits/dnd';
import type { EnergyValues } from '../traits/energy';
import type { FanValues } from '../traits/fan';
import type { LightValues } from '../traits/light';
import type { MediaValues } from '../traits/media';
import type { OverTempValues } from '../traits/overtemp';
import type { PresenceValues } from '../traits/presence';
import type { SensorValues } from '../traits/sensor-core';
import type { SprayValues } from '../traits/spray';
import type { SprinklerValues } from '../traits/sprinkler';
import type { StandbyKillerValues } from '../traits/standbykiller';
import type { SwitchValues } from '../traits/switch';
import type { SystemValues } from '../traits/system';
import type { TimerGeneration, TimerValues } from '../traits/timer';
import type { TriggerGeneration, TriggerValues } from '../traits/trigger';

/**
 * Board bind: one Toggle/ToggleX channel on the physical device.
 */
export interface SwitchTraitBoardBind {
    kind: 'board';
    channel: number;
    namespace: typeof TOGGLEX_NAMESPACE | typeof TOGGLE_NAMESPACE;
    request: DeviceRequest;
    emitChange: (values: SwitchValues) => void;
    /** System.All digest `onoff` so hosts can read on/off before the first PUSH. */
    initialOn?: boolean;
}

/**
 * Hub bind: one subdevice row driven by Hub.ToggleX (digest `onoff` without a known model).
 */
export interface SwitchTraitHubBind {
    kind: 'hub';
    subDeviceId: string;
    /** Ability keys; Exception / Version no-op when the namespace is absent. */
    namespaces?: ReadonlySet<string>;
    request: DeviceRequest;
    emitChange: (values: SwitchValues) => void;
    /** Hub digest `onoff` so hosts can read on/off before the first PUSH. */
    initialOn?: boolean;
}

export type SwitchTraitBind = SwitchTraitBoardBind | SwitchTraitHubBind;

/**
 * Transport + channel bind for one energy endpoint. Session supplies this;
 * trait tests inject a fake request/emit pair.
 */
export interface EnergyTraitBind {
    channel: number;
    hasElectricity: boolean;
    hasElectricityX: boolean;
    hasConsumptionX: boolean;
    hasConsumptionH: boolean;
    /** Ability keys; ConsumptionConfig no-ops when absent. */
    namespaces?: ReadonlySet<string>;
    request: DeviceRequest;
    emitChange: (values: EnergyValues) => void;
}

/**
 * Transport + channel bind for one Control.Light endpoint.
 * Session supplies the request transport and ToggleX preference.
 */
export interface LightTraitBind {
    channel: number;
    /** ToggleX when advertised; classic Toggle only when ToggleX is absent. */
    hasToggleX: boolean;
    hasToggle: boolean;
    /** Light.Effect catalog SET needs this namespace. */
    hasLightEffect: boolean;
    /** Capacity bitmask from Ability; the trait updates it after the first GETACK. */
    lightCapacity: number;
    /** System.All digest seed so hosts can read state before the first PUSH. */
    initial?: LightValues;
    request: DeviceRequest;
    emitChange: (values: LightValues) => void;
}

/**
 * Transport + channel bind. Kind is the concrete class, not a field here,
 * so a garage construct cannot call shutter setters.
 */
export interface CoverTraitBind {
    channel: number;
    /** Ability keys; extra methods throw when the namespace is absent. */
    namespaces?: ReadonlySet<string>;
    /** System.All digest `open` so hosts can read open/closed before the first PUSH. */
    initialOpen?: boolean;
    request: DeviceRequest;
    emitChange: (values: CoverValues) => void;
}

/**
 * Transport + channel bind for a board thermostat. Mode / ModeB / ModeC
 * is the class, not a field here, so a ModeC construct cannot call
 * Mode-only setters.
 */
export interface ClimateTraitBoardBind {
    kind: 'board';
    channel: number;
    /** Ability keys; extra methods throw when the namespace is absent. */
    namespaces?: ReadonlySet<string>;
    /** System.All digest seed so hosts can read mode/temps before the first PUSH. */
    initial?: ClimateValues;
    request: DeviceRequest;
    emitChange: (values: ClimateValues) => void;
}

/**
 * Transport + sub-device bind for a hub MTS100/MTS150 valve child.
 */
export interface ClimateTraitHubBind {
    kind: 'hub';
    subDeviceId: string;
    /** Ability keys; extra methods throw when the namespace is absent. */
    namespaces?: ReadonlySet<string>;
    request: DeviceRequest;
    emitChange: (values: ClimateValues) => void;
}

/**
 * Transport + sub-device bind. Kind is the concrete class, not a field
 * here, so a contact sensor cannot call smoke setters.
 */
export interface SensorTraitBind {
    subDeviceId: string;
    /** Ability keys; extra methods throw when the namespace is absent. */
    namespaces?: ReadonlySet<string>;
    request: DeviceRequest;
    emitChange: (values: SensorValues) => void;
}

/**
 * Transport + channel bind for a WiFi presence device (MS600). Session supplies
 * this; trait tests inject a fake request/emit pair.
 */
export interface PresenceTraitBind {
    channel: number;
    /** Ability keys; extra methods no-op when the namespace is absent. */
    namespaces?: ReadonlySet<string>;
    request: DeviceRequest;
    emitChange: (values: PresenceValues) => void;
}

/**
 * Transport + sub-device bind for a hub sprinkler child. Session supplies this;
 * trait tests inject a fake request/emit pair.
 */
export interface SprinklerTraitBind {
    subDeviceId: string;
    /** Ability keys; DeviceCfg, Battery, WaterPlan, and WaterEvent no-op when absent. */
    namespaces?: ReadonlySet<string>;
    request: DeviceRequest;
    emitChange: (values: SprinklerValues) => void;
}

/**
 * Transport + channel bind for one Control.Spray endpoint. Session supplies this;
 * trait tests inject a fake request/emit pair.
 */
export interface SprayTraitBind {
    channel: number;
    /** System.All digest seed so hosts can read mode before the first PUSH. */
    initial?: SprayValues;
    request: DeviceRequest;
    emitChange: (values: SprayValues) => void;
}

/**
 * Transport + channel bind for one Control.Fan endpoint. Session supplies this;
 * trait tests inject a fake request/emit pair.
 */
export interface FanTraitBind {
    channel: number;
    /** Ability keys; extras no-op when the namespace is absent. */
    namespaces?: ReadonlySet<string>;
    /** ToggleX when advertised; classic Toggle only when ToggleX is absent. */
    hasToggleX: boolean;
    hasToggle: boolean;
    /** System.All digest seed so hosts can read speed before the first PUSH. */
    initial?: FanValues;
    request: DeviceRequest;
    emitChange: (values: FanValues) => void;
}

/**
 * Transport + channel bind for one Diffuser device. Session supplies this;
 * trait tests inject a fake request/emit pair.
 */
export interface DiffuserTraitBind {
    channel: number;
    /** Ability keys; extra methods no-op when the namespace is absent. */
    namespaces?: ReadonlySet<string>;
    /** System.All digest seed so hosts can read light/spray before the first PUSH. */
    initial?: DiffuserValues;
    request: DeviceRequest;
    emitChange: (values: DiffuserValues) => void;
}

/**
 * Transport + channel bind for one Control.Mp3 endpoint. Session supplies this;
 * trait tests inject a fake request/emit pair.
 */
export interface MediaTraitBind {
    channel: number;
    request: DeviceRequest;
    emitChange: (values: MediaValues) => void;
}

/**
 * Transport + channel bind for one Control.Alarm / Control.Beep endpoint.
 * Session supplies this; trait tests inject a fake request/emit pair. Hub
 * parent uses channel 0.
 */
export interface AlarmTraitBind {
    channel: number;
    /** Ability keys; setters and PUSH apply only for advertised namespaces. */
    namespaces?: ReadonlySet<string>;
    request: DeviceRequest;
    emitChange: (values: AlarmValues) => void;
}

/**
 * Transport + channel bind for one AlertConfig / AlertReport endpoint.
 * Session supplies this; trait tests inject a fake request/emit pair.
 */
export interface AlertTraitBind {
    channel: number;
    /** Ability keys; Config SET and Report PUSH apply only when advertised. */
    namespaces?: ReadonlySet<string>;
    request: DeviceRequest;
    emitChange: (values: AlertValues) => void;
}

/**
 * Transport bind for one device's System.DNDMode surface. Session supplies this;
 * trait tests inject a fake request/emit pair.
 */
export interface DndTraitBind {
    request: DeviceRequest;
    emitChange: (values: DndValues) => void;
}

/**
 * Transport bind for one device's Config.OverTemp / Control.OverTemp surface.
 * Session supplies this; trait tests inject a fake request/emit pair.
 */
export interface OverTempTraitBind {
    /** Ability keys; Config SET and Control PUSH apply only when advertised. */
    namespaces?: ReadonlySet<string>;
    request: DeviceRequest;
    emitChange: (values: OverTempValues) => void;
}

/**
 * Transport + channel bind for one StandbyKiller endpoint.
 * Session supplies this; trait tests inject a fake request/emit pair.
 */
export interface StandbyKillerTraitBind {
    channel: number;
    /** Ability keys; SET and PUSH apply only when advertised. */
    namespaces?: ReadonlySet<string>;
    request: DeviceRequest;
    emitChange: (values: StandbyKillerValues) => void;
}

/**
 * Transport bind for one device's System.* surface. Session supplies this;
 * trait tests inject a fake request/emit pair.
 */
export interface SystemTraitBind {
    /** System.All firmware so hosts can read version before the first poll. */
    initialFirmware?: SystemFirmwareState;
    /** System.All hardware identity before the first poll. */
    initialHardware?: SystemHardwareState;
    /** System.All time when the digest carried it. */
    initialTime?: SystemTimeState;
    request: DeviceRequest;
    emitChange: (values: SystemValues) => void;
    /**
     * Ability listed Appliance.System.Runtime. The trait is still attached
     * without it; hosts use this so an empty signal sensor is not created.
     */
    hasRuntime?: boolean;
    /** Injectable for clock-skew tests. */
    now?: () => number;
}

/**
 * Transport + channel bind for one TimerX / Control.Timer endpoint. Session
 * supplies this; trait tests inject a fake request/emit pair.
 */
export interface TimerTraitBind {
    channel: number;
    /** Chosen at enrollment from Ability: TimerX preferred over Control.Timer. */
    generation: TimerGeneration;
    /**
     * Ability keys advertised by the device. Digest.TimerX listing no-ops when absent.
     */
    namespaces?: ReadonlySet<string>;
    request: DeviceRequest;
    emitChange: (values: TimerValues) => void;
}

/**
 * Transport + channel bind for one TriggerX / Control.Trigger endpoint. Session
 * supplies this; trait tests inject a fake request/emit pair.
 */
export interface TriggerTraitBind {
    channel: number;
    /** Chosen at enrollment from Ability: TriggerX preferred over Control.Trigger. */
    generation: TriggerGeneration;
    /**
     * Ability keys advertised by the device. Digest.TriggerX listing no-ops when absent.
     */
    namespaces?: ReadonlySet<string>;
    request: DeviceRequest;
    emitChange: (values: TriggerValues) => void;
}
