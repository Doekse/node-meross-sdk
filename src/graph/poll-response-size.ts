import { CONSUMPTIONH_NAMESPACE } from '../protocol/codecs/consumptionh';
import { CONSUMPTIONX_NAMESPACE, consumptionXDays } from '../protocol/codecs/consumptionx';
import {
    DIFFUSER_SENSOR_NAMESPACE
} from '../protocol/codecs/diffuser';
import { ELECTRICITY_NAMESPACE, ELECTRICITYX_NAMESPACE } from '../protocol/codecs/electricity';
import { FAN_NAMESPACE, FILTER_MAINTENANCE_NAMESPACE } from '../protocol/codecs/fan';
import { LIGHT_EFFECT_NAMESPACE } from '../protocol/codecs/light';
import { MP3_NAMESPACE } from '../protocol/codecs/mp3';
import {
    GARAGE_CONFIG_NAMESPACE,
    GARAGE_MULTIPLE_CONFIG_NAMESPACE,
    SHUTTER_ADJUST_NAMESPACE,
    SHUTTER_CONFIG_NAMESPACE,
    SHUTTER_POSITION_NAMESPACE,
    SHUTTER_STATE_NAMESPACE
} from '../protocol/codecs/cover';
import { DND_MODE_NAMESPACE } from '../protocol/codecs/dnd';
import { CONFIG_OVERTEMP_NAMESPACE } from '../protocol/codecs/overtemp';
import { PHYSICAL_LOCK_NAMESPACE, SCREEN_BRIGHTNESS_NAMESPACE } from '../protocol/codecs/climate';
import { PRESENCE_CONFIG_NAMESPACE } from '../protocol/codecs/presence';
import {
    CONFIG_SENSOR_ASSOCIATION_NAMESPACE,
    SENSOR_LATEST_NAMESPACE,
    SENSOR_LATESTX_NAMESPACE
} from '../protocol/codecs/sensor';
import { SYSTEM_DEBUG_NAMESPACE } from '../protocol/codecs/system';
import type { MerossPayload } from '../protocol/message';
import { SYSTEM_ALL_NAMESPACE } from './system-all';

/**
 * Control.Multiple's envelope is counted before any sub-GETACK so the HTTP
 * ~3000-byte ceiling is not spent twice.
 */
export const POLL_RESPONSE_HEADER_SIZE = 300;

/**
 * Floor after a truncated-Multiple shrink, and the advertised max when
 * `maxCmdNum * 800` is smaller, so packing cannot collapse below a usable
 * HTTP body.
 */
export const POLL_RESPONSE_SIZE_MIN = 1_000;

/**
 * Ability advertises a command count, not a byte budget; 800 bytes per
 * packed slot is the working estimate.
 */
export const POLL_RESPONSE_SIZE_PER_CMD = 800;

/**
 * Reserve a month of daily ConsumptionX rows before the first GETACK
 * calibrates, so a large history reply cannot crowd live Electricity out
 * of the same HTTP body.
 */
export const CONSUMPTIONX_DEFAULT_DAYS = 30;

/**
 * GETACK size split so list namespaces grow with row count (days, channels)
 * while object payloads stay a fixed `base`.
 */
export interface PollResponseParts {
    base: number;
    item: number;
}

/**
 * Estimated GETACK bytes by namespace. Omitted namespaces use
 * {@link POLL_RESPONSE_HEADER_SIZE} and no per-item cost, so packing still
 * charges the Multiple envelope instead of treating them as free.
 */
const RESPONSE_SIZE: Record<string, PollResponseParts> = {
    [SYSTEM_ALL_NAMESPACE]: { base: 1_000, item: 0 },
    [SYSTEM_DEBUG_NAMESPACE]: { base: 1_900, item: 0 },
    [DND_MODE_NAMESPACE]: { base: 320, item: 0 },
    'Appliance.System.Runtime': { base: 330, item: 0 },
    [CONFIG_SENSOR_ASSOCIATION_NAMESPACE]: { base: POLL_RESPONSE_HEADER_SIZE, item: 30 },
    [CONFIG_OVERTEMP_NAMESPACE]: { base: 340, item: 0 },
    [CONSUMPTIONH_NAMESPACE]: { base: 320, item: 1_900 },
    [CONSUMPTIONX_NAMESPACE]: { base: 320, item: 53 },
    [DIFFUSER_SENSOR_NAMESPACE]: { base: POLL_RESPONSE_HEADER_SIZE, item: 100 },
    [ELECTRICITY_NAMESPACE]: { base: 430, item: 0 },
    [ELECTRICITYX_NAMESPACE]: { base: POLL_RESPONSE_HEADER_SIZE, item: 100 },
    [FAN_NAMESPACE]: { base: POLL_RESPONSE_HEADER_SIZE, item: 20 },
    [FILTER_MAINTENANCE_NAMESPACE]: { base: POLL_RESPONSE_HEADER_SIZE, item: 35 },
    [LIGHT_EFFECT_NAMESPACE]: { base: 1_850, item: 0 },
    [MP3_NAMESPACE]: { base: 380, item: 0 },
    [PHYSICAL_LOCK_NAMESPACE]: { base: POLL_RESPONSE_HEADER_SIZE, item: 35 },
    [SCREEN_BRIGHTNESS_NAMESPACE]: { base: POLL_RESPONSE_HEADER_SIZE, item: 70 },
    [PRESENCE_CONFIG_NAMESPACE]: { base: POLL_RESPONSE_HEADER_SIZE, item: 260 },
    [SENSOR_LATEST_NAMESPACE]: { base: POLL_RESPONSE_HEADER_SIZE, item: 80 },
    [SENSOR_LATESTX_NAMESPACE]: { base: POLL_RESPONSE_HEADER_SIZE, item: 220 },
    [GARAGE_CONFIG_NAMESPACE]: { base: 410, item: 0 },
    [GARAGE_MULTIPLE_CONFIG_NAMESPACE]: { base: POLL_RESPONSE_HEADER_SIZE, item: 140 },
    [SHUTTER_ADJUST_NAMESPACE]: { base: POLL_RESPONSE_HEADER_SIZE, item: 35 },
    [SHUTTER_CONFIG_NAMESPACE]: { base: POLL_RESPONSE_HEADER_SIZE, item: 70 },
    [SHUTTER_POSITION_NAMESPACE]: { base: POLL_RESPONSE_HEADER_SIZE, item: 50 },
    [SHUTTER_STATE_NAMESPACE]: { base: POLL_RESPONSE_HEADER_SIZE, item: 40 }
};

/**
 * Table lookup used by estimate. Missing rows still charge the Multiple
 * envelope rather than packing as free.
 */
export function getResponseSizeParts(namespace: string): PollResponseParts {
    return RESPONSE_SIZE[namespace] ?? { base: POLL_RESPONSE_HEADER_SIZE, item: 0 };
}

function getPayloadItemCount(payload: MerossPayload): number {
    for (const value of Object.values(payload)) {
        if (Array.isArray(value)) {
            return value.length;
        }
    }
    return 1;
}

/**
 * Estimated GETACK bytes so packing can refuse a sub-GET that would overflow
 * the HTTP body. ConsumptionX without a list still reserves
 * {@link CONSUMPTIONX_DEFAULT_DAYS}.
 */
export function estimateResponseSize(
    namespace: string,
    payload: MerossPayload = {}
): number {
    const { base, item } = getResponseSizeParts(namespace);
    if (item === 0) {
        return base;
    }
    if (namespace === CONSUMPTIONX_NAMESPACE && consumptionXDays(payload) === undefined) {
        return base + item * CONSUMPTIONX_DEFAULT_DAYS;
    }
    return base + item * Math.max(getPayloadItemCount(payload), 1);
}

/**
 * Ability `maxCmdNum` is a command count; convert to a byte budget without
 * going below {@link POLL_RESPONSE_SIZE_MIN}, including when the device
 * advertises 0 or 1 commands.
 */
export function getDeviceResponseSizeMax(maxCmdNum: number): number {
    const advertised = maxCmdNum * POLL_RESPONSE_SIZE_PER_CMD;
    return advertised < POLL_RESPONSE_SIZE_MIN ? POLL_RESPONSE_SIZE_MIN : advertised;
}
