/**
 * Hub child SKU tables for climate / sensor / sprinkler. Kept out of those
 * trait modules so hub child classification does not `require` them.
 */
import type { TraitName } from '../endpoint';
import type { HubChildRule } from '../traits/descriptor';
import { SENSOR_FAMILY_MAP } from '../traits/sensor-family';

/** Board and hub MTS thermostat SKUs. */
export const CLIMATE_HUB_CHILD: HubChildRule = {
    models: new Set(['mts100', 'mts100v3', 'mts150', 'mts150p']),
    aliases: {},
    classHint: 'climate'
};

/**
 * Sensor SKUs and digest aliases. {@link SENSOR_FAMILY_MAP} stays the source
 * of truth for models and families.
 */
export const SENSOR_HUB_CHILD: HubChildRule = {
    models: new Set(SENSOR_FAMILY_MAP.keys()),
    aliases: {
        temphum: 'ms100',
        temphumi: 'ms130',
        doorwindow: 'ms200',
        waterleak: 'ms400',
        smokealarm: 'gs559',
        motion: 'ms120'
    },
    classHint: 'sensor'
};

/** MST100 sprinkler SKU plus short digest alias. */
export const SPRINKLER_HUB_CHILD: HubChildRule = {
    models: new Set(['mst100']),
    aliases: { mst: 'mst100' },
    classHint: 'sprinkler'
};

/** One climate / sensor / sprinkler row in {@link HUB_CHILD_RULES}. */
interface HubChildTraitRule {
    readonly name: TraitName;
    readonly hubChild: HubChildRule;
}

/**
 * Local climate → sensor → sprinkler order. Must not be derived from
 * TRAIT_DESCRIPTORS — enroll must not iterate that catalog.
 */
export const HUB_CHILD_RULES: readonly HubChildTraitRule[] = [
    { name: 'climate', hubChild: CLIMATE_HUB_CHILD },
    { name: 'sensor', hubChild: SENSOR_HUB_CHILD },
    { name: 'sprinkler', hubChild: SPRINKLER_HUB_CHILD }
];
