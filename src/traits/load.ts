import { createRequire } from 'node:module';

import type { TraitInstances, TraitName } from '../endpoint';
import type { TraitDescriptor } from './descriptor';

/**
 * Per-trait module shapes. `typeof import(...)` is type-only and does not
 * emit a require — trait files must not import this module.
 */
type TraitModuleExports = {
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

/**
 * Mapped so `descriptor.attach` returns {@link TraitInstances}[K].
 */
type TraitModule = {
    [K in TraitName]: Omit<TraitModuleExports[K], 'descriptor'> & {
        readonly descriptor: TraitDescriptor<K, TraitInstances[K]>;
    };
};

const requireHere = createRequire(__filename);

/**
 * Sync-loads one trait class module. First attach pays the require; later
 * calls reuse Node's module cache. File names match {@link TraitName}.
 * Node's `require` is untyped, so the assertion names the module that
 * convention returns. Poll/PUSH data lives in `*.catalog.ts`. Enroll lives
 * in device/enroll.ts so this require is not how a board is classified.
 */
export function loadTrait<K extends TraitName>(name: K): TraitModule[K] {
    return requireHere(`./${name}.js`) as TraitModule[K];
}
