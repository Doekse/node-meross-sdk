import { createRequire } from 'node:module';

import type { TraitName } from '../endpoint';
import type { TraitDescriptor } from './descriptor';

/**
 * Relative CJS paths for sync {@link loadTrait}. `.js` matches `dist/traits/`
 * after `tsc`; Node's require cache is the only module cache.
 */
export const TRAIT_MODULES = {
    switch: './switch.js',
    energy: './energy.js',
    light: './light.js',
    climate: './climate.js',
    cover: './cover.js',
    sensor: './sensor.js',
    presence: './presence.js',
    sprinkler: './sprinkler.js',
    spray: './spray.js',
    fan: './fan.js',
    diffuser: './diffuser.js',
    media: './media.js',
    alarm: './alarm.js',
    alert: './alert.js',
    dnd: './dnd.js',
    overtemp: './overtemp.js',
    standbykiller: './standbykiller.js',
    system: './system.js',
    timer: './timer.js',
    trigger: './trigger.js'
} as const satisfies Record<TraitName, string>;

/**
 * Export name of each colocated descriptor so poll/enroll never guess casing.
 */
export const TRAIT_DESCRIPTOR_KEY = {
    switch: 'SwitchDescriptor',
    energy: 'EnergyDescriptor',
    light: 'LightDescriptor',
    climate: 'ClimateDescriptor',
    cover: 'CoverDescriptor',
    sensor: 'SensorDescriptor',
    presence: 'PresenceDescriptor',
    sprinkler: 'SprinklerDescriptor',
    spray: 'SprayDescriptor',
    fan: 'FanDescriptor',
    diffuser: 'DiffuserDescriptor',
    media: 'MediaDescriptor',
    alarm: 'AlarmDescriptor',
    alert: 'AlertDescriptor',
    dnd: 'DndDescriptor',
    overtemp: 'OverTempDescriptor',
    standbykiller: 'StandbyKillerDescriptor',
    system: 'SystemDescriptor',
    timer: 'TimerDescriptor',
    trigger: 'TriggerDescriptor'
} as const satisfies Record<TraitName, string>;

/**
 * Per-trait module shapes. `typeof import(...)` is type-only and does not
 * emit a require — trait files must not import this module.
 */
type TraitModule = {
    switch: typeof import('./switch');
    energy: typeof import('./energy');
    light: typeof import('./light');
    climate: typeof import('./climate');
    cover: typeof import('./cover');
    sensor: typeof import('./sensor');
    presence: typeof import('./presence');
    sprinkler: typeof import('./sprinkler');
    spray: typeof import('./spray');
    fan: typeof import('./fan');
    diffuser: typeof import('./diffuser');
    media: typeof import('./media');
    alarm: typeof import('./alarm');
    alert: typeof import('./alert');
    dnd: typeof import('./dnd');
    overtemp: typeof import('./overtemp');
    standbykiller: typeof import('./standbykiller');
    system: typeof import('./system');
    timer: typeof import('./timer');
    trigger: typeof import('./trigger');
};

const requireHere = createRequire(__filename);

/**
 * Sync-loads one trait module. First Ability/digest hit pays the require;
 * later calls reuse Node's module cache.
 */
export function loadTrait<K extends TraitName>(name: K): TraitModule[K] {
    return requireHere(TRAIT_MODULES[name]) as TraitModule[K];
}

/**
 * Resolves the colocated {@link TraitDescriptor} without callers naming exports.
 */
export function loadTraitDescriptor(name: TraitName): TraitDescriptor {
    const exportName = TRAIT_DESCRIPTOR_KEY[name];
    const loaded = loadTrait(name) as unknown as Record<string, TraitDescriptor>;
    return loaded[exportName];
}
