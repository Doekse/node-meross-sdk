/**
 * Hub child sensor SKU → family map. Lives outside {@link ./sensor} so
 * {@link ../device/hub-child} can classify children without loading the
 * sensor trait or codec modules.
 */

/** Hub child sensor families. Digest type strings do not match cloud subDeviceType. */
export type SensorFamily = 'tempHum' | 'contact' | 'leak' | 'motion' | 'smoke';

/** Canonical lowercase model → family. Digest aliases live on SENSOR_HUB_CHILD. */
export const SENSOR_FAMILY_MAP: ReadonlyMap<string, SensorFamily> = new Map([
    ['ms100', 'tempHum'],
    ['ms100f', 'tempHum'],
    ['ms130', 'tempHum'],
    ['ms120', 'motion'],
    ['ms200', 'contact'],
    ['ms400', 'leak'],
    ['ms405', 'leak'],
    ['ma151', 'smoke'],
    ['gs559', 'smoke']
]);
