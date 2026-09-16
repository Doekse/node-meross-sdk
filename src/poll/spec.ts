import type { TraitName } from '../endpoint';
import type { MerossPayload } from '../protocol/message';
import { TOGGLEX_ALL_CHANNELS } from '../protocol/codecs/togglex';

/**
 * How a namespace is scheduled. Traits register jobs; the poller owns the
 * timer so each trait does not run its own interval.
 *
 * `digest` jobs GET only as the System.All fallback, never alongside All
 * and never while MQTT is carrying PUSH.
 */
export type PollStrategy = 'default' | 'digest' | 'smart' | 'once' | 'all';

/**
 * Firmware heartbeat window. HTTP is also probed on this interval while MQTT
 * is current, so a dropped LAN path is noticed even while PUSH is still
 * arriving.
 */
export const SYSTEM_ALL_PERIOD_MS = 295_000;

/** Watt-hour totals do not need the instantaneous electricity period. */
export const ENERGY_PERIOD_MS = 55_000;

/** Consumption over cloud MQTT so daily totals do not fill the broker budget. */
export const ENERGY_CLOUD_PERIOD_MS = 600_000;

/** Live power / presence: due on every LAN tick. */
export const SENSOR_FAST_PERIOD_MS = 0;

/** Live sensors when the request rides cloud MQTT. */
export const SENSOR_FAST_CLOUD_PERIOD_MS = 180_000;

/** Config and slowly changing sensors on LAN. */
export const SENSOR_SLOW_PERIOD_MS = 300_000;

/** Slowly changing sensors over cloud MQTT. */
export const SENSOR_SLOW_CLOUD_PERIOD_MS = 600_000;

/** Config GETs over cloud MQTT; the slowest period, as they rarely change. */
export const CLOUDMQTT_PERIOD_MS = 1_195_000;

/** Hub battery percent barely moves; about once an hour is enough. */
export const HUB_BATTERY_PERIOD_MS = 3_600_000;

/**
 * Control.Multiple's envelope is counted before any sub-GETACK so the HTTP
 * ~3000-byte ceiling is not spent twice.
 */
export const POLL_RESPONSE_HEADER_SIZE = 300;

export interface PollPeriods {
    readonly strategy: PollStrategy;
    readonly periodMs: number;
    readonly periodCloudMs: number;
}

/**
 * GET body grammar. Omitted payload is `{}`.
 * `dict` — `{ key: { channel } }` or `{ key: {} }` when channel is omitted.
 * `list` without `by` — `{ key: [] }` (Light.Effect catalog).
 * `list` with `by` — `{ key: [{ channel | id | subId }] }` from enrolled endpoints.
 * `either` — hub children (`subId`) when present, otherwise board channels.
 */
export type PayloadSpec =
    | { readonly dict: string; readonly channel?: number }
    | {
        readonly list: string;
        readonly by?: 'channel' | 'id' | 'subId' | 'either';
        readonly for?: TraitName;
        readonly data?: readonly string[];
        readonly dataId?: readonly string[];
    };

/**
 * Per-namespace GET schedule and packing estimate. Trait descriptors own a
 * subset of keys; {@link buildPollJobs} concatenates them into one table.
 */
export interface PollSpec extends PollPeriods {
    readonly skipIf?: string;
    readonly payload?: PayloadSpec;
    readonly method?: 'GET' | 'PUSH';
    readonly calibrate?: (payload: MerossPayload) => number | undefined;
    /**
     * GETACK bytes. Omitted `base` is {@link POLL_RESPONSE_HEADER_SIZE} and
     * omitted `item` is 0, so packing still charges the Multiple envelope
     * instead of treating the namespace as free.
     */
    readonly base?: number;
    readonly item?: number;
}

export const DEFAULT: PollPeriods = {
    strategy: 'default',
    periodMs: 0,
    periodCloudMs: CLOUDMQTT_PERIOD_MS
};

export const ONCE: PollPeriods = {
    strategy: 'once',
    periodMs: 0,
    periodCloudMs: 0
};

export const SMART_FAST: PollPeriods = {
    strategy: 'smart',
    periodMs: SENSOR_FAST_PERIOD_MS,
    periodCloudMs: SENSOR_FAST_CLOUD_PERIOD_MS
};

/** LatestX stays every LAN tick; over MQTT it uses the config cloud period. */
export const SMART_FAST_MQTT: PollPeriods = {
    strategy: 'smart',
    periodMs: SENSOR_FAST_PERIOD_MS,
    periodCloudMs: CLOUDMQTT_PERIOD_MS
};

/** Latest is live on LAN; over MQTT it can wait with other slow sensors. */
export const SMART_FAST_SLOW_CLOUD: PollPeriods = {
    strategy: 'smart',
    periodMs: SENSOR_FAST_PERIOD_MS,
    periodCloudMs: SENSOR_SLOW_CLOUD_PERIOD_MS
};

export const SMART_SLOW: PollPeriods = {
    strategy: 'smart',
    periodMs: SENSOR_SLOW_PERIOD_MS,
    periodCloudMs: SENSOR_SLOW_CLOUD_PERIOD_MS
};

export const SMART_CONFIG: PollPeriods = {
    strategy: 'smart',
    periodMs: SENSOR_SLOW_PERIOD_MS,
    periodCloudMs: CLOUDMQTT_PERIOD_MS
};

export const SMART_ENERGY: PollPeriods = {
    strategy: 'smart',
    periodMs: ENERGY_PERIOD_MS,
    periodCloudMs: ENERGY_CLOUD_PERIOD_MS
};

export const SMART_CLOUDMQTT: PollPeriods = {
    strategy: 'smart',
    periodMs: CLOUDMQTT_PERIOD_MS,
    periodCloudMs: CLOUDMQTT_PERIOD_MS
};

export const SMART_BATTERY: PollPeriods = {
    strategy: 'smart',
    periodMs: HUB_BATTERY_PERIOD_MS,
    periodCloudMs: CLOUDMQTT_PERIOD_MS
};

export const SMART_ALL: PollPeriods = {
    strategy: 'smart',
    periodMs: SYSTEM_ALL_PERIOD_MS,
    periodCloudMs: CLOUDMQTT_PERIOD_MS
};

export const ALL_CHANNELS = { dict: 'togglex', channel: TOGGLEX_ALL_CHANNELS } as const;

/**
 * Builds a channel-keyed LIST GET body. Omit `trait` when every enrolled
 * channel should appear (shared Hub / Config namespaces).
 */
export function channelList(list: string, trait?: TraitName): PayloadSpec {
    if (trait === undefined) {
        return { list, by: 'channel' };
    }
    return { list, by: 'channel', for: trait };
}

/**
 * Builds an id-keyed LIST GET body for hub children. Omit `trait` when the
 * GET must include mixed child traits (ToggleX / Battery / Version).
 */
export function idList(list: string, trait?: TraitName): PayloadSpec {
    if (trait === undefined) {
        return { list, by: 'id' };
    }
    return { list, by: 'id', for: trait };
}

/**
 * Builds a subId-keyed LIST GET body for hub children that require channel 0.
 */
export function subIdList(list: string, trait: TraitName): PayloadSpec {
    return { list, by: 'subId', for: trait };
}

/**
 * Estimated GETACK bytes from base/item without consulting the POLL table.
 * Trait calibrate hooks use this so energy cannot import jobs.
 */
export function pollSpecSize(spec: Pick<PollSpec, 'base' | 'item'>, itemCount: number): number {
    const base = spec.base ?? POLL_RESPONSE_HEADER_SIZE;
    const item = spec.item ?? 0;
    if (item === 0) {
        return base;
    }
    return base + item * itemCount;
}
