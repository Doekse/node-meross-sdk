import type { TraitName } from '../device/endpoint';
import { EMPTY_LIST, EMPTY_PAYLOAD, type MerossPayload } from '../protocol/message';
import type { AbilityMap } from '../protocol/codecs/ability';
import { CONSUMPTIONX_NAMESPACE } from '../protocol/namespaces';
import { TRAIT_CATALOGS } from '../traits/catalog';
import type { PollJob } from './poller';
import {
    POLL_RESPONSE_HEADER_SIZE,
    type PayloadSpec,
    type PollSpec
} from './spec';

export {
    CLOUDMQTT_PERIOD_MS,
    ENERGY_CLOUD_PERIOD_MS,
    ENERGY_PERIOD_MS,
    HUB_BATTERY_PERIOD_MS,
    POLL_RESPONSE_HEADER_SIZE,
    SENSOR_FAST_CLOUD_PERIOD_MS,
    SENSOR_FAST_PERIOD_MS,
    SENSOR_SLOW_CLOUD_PERIOD_MS,
    SENSOR_SLOW_PERIOD_MS,
    SYSTEM_ALL_PERIOD_MS
} from './spec';

/**
 * Channel, sub-device, and traits used to pack LIST GET payloads.
 * meross_lan `polling_request_channels` is device-scoped; `digestNamespaces` is
 * not on this type (physical-device scoped, already a separate
 * {@link buildPollJobs} argument); `model` is hub chunking (later).
 */
export interface PollTarget {
    readonly channel?: number;
    readonly subDeviceId?: string;
    readonly traits: readonly TraitName[];
}

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

interface PollResponseParts {
    readonly base: number;
    readonly item: number;
}

interface PollRow {
    readonly namespace: string;
    readonly spec: PollSpec;
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

function pollRows(): PollRow[] {
    const rows: PollRow[] = [];
    for (const catalog of Object.values(TRAIT_CATALOGS)) {
        for (const [namespace, spec] of Object.entries(catalog.poll)) {
            rows.push({ namespace, spec });
        }
    }
    rows.sort((left, right) => left.spec.order - right.spec.order);
    return rows;
}

const POLL_ROWS = pollRows();
const POLL_SPECS = new Map(POLL_ROWS.map((row) => [row.namespace, row.spec]));

/**
 * Catalog poll row for a namespace. Unknown namespaces stay undefined
 * without loading a trait class module.
 */
export function pollSpec(namespace: string): PollSpec | undefined {
    return POLL_SPECS.get(namespace);
}

/**
 * Table lookup used by packing. Missing rows still charge the Multiple
 * envelope rather than packing as free.
 */
export function getResponseSizeParts(namespace: string): PollResponseParts {
    const spec = pollSpec(namespace);
    return {
        base: spec?.base ?? POLL_RESPONSE_HEADER_SIZE,
        item: spec?.item ?? 0
    };
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
    payload: MerossPayload = EMPTY_PAYLOAD
): number {
    const { base, item } = getResponseSizeParts(namespace);
    if (item === 0) {
        return base;
    }
    // Avoid importing consumptionx.ts; a missing list still reserves a month.
    if (namespace === CONSUMPTIONX_NAMESPACE && !Array.isArray(payload.consumptionx)) {
        return base + item * CONSUMPTIONX_DEFAULT_DAYS;
    }
    return base + item * Math.max(getPayloadItemCount(payload), 1);
}

/**
 * Builds the device poll table from Ability. LIST payloads come from enrolled
 * endpoints so a strip or hub issues one GET per namespace. Unadvertised
 * namespaces never load their trait class module.
 */
export function buildPollJobs(
    ability: AbilityMap,
    endpoints: readonly PollTarget[],
    digestNamespaces?: ReadonlySet<string>
): PollJob[] {
    const jobs: PollJob[] = [];
    for (const { namespace, spec } of POLL_ROWS) {
        if (!(namespace in ability)) {
            continue;
        }
        if (spec.skipIf !== undefined && spec.skipIf in ability) {
            continue;
        }
        const inDigest = digestNamespaces?.has(namespace);
        jobs.push({
            namespace,
            strategy: inDigest ? 'digest' : spec.strategy,
            periodMs: inDigest ? 0 : spec.periodMs,
            periodCloudMs: spec.periodCloudMs,
            payload: spec.payload ? encodePayload(spec.payload, endpoints) : EMPTY_PAYLOAD,
            ...(spec.method ? { method: spec.method } : {}),
            ...(spec.calibrate ? { calibrate: spec.calibrate } : {})
        });
    }
    return jobs;
}

function encodePayload(spec: PayloadSpec, endpoints: readonly PollTarget[]): MerossPayload {
    if ('dict' in spec) {
        return {
            [spec.dict]: spec.channel === undefined ? EMPTY_PAYLOAD : { channel: spec.channel }
        };
    }
    return { [spec.list]: encodeList(spec, endpoints) };
}

function encodeList(
    spec: Extract<PayloadSpec, { list: string }>,
    endpoints: readonly PollTarget[]
): readonly unknown[] {
    if (spec.by === undefined) {
        return EMPTY_LIST;
    }

    const trait = spec.for;
    const picked = trait === undefined
        ? [...endpoints]
        : endpoints.filter((endpoint) => endpoint.traits.includes(trait));
    const withId = picked.filter((endpoint) => endpoint.subDeviceId);
    const withChannel = picked.filter((endpoint) => endpoint.channel !== undefined);

    switch (spec.by) {
        case 'id':
            return withId.map((endpoint) => ({ id: endpoint.subDeviceId }));
        case 'subId':
            return withId.map((endpoint) => ({
                subId: endpoint.subDeviceId,
                channel: 0
            }));
        case 'either':
            if (withId.length > 0) {
                const hub = spec.dataId ? preferTrait(withId, 'sensor') : withId;
                return hub.map((endpoint) => ({
                    channel: 0,
                    subId: endpoint.subDeviceId,
                    ...(spec.dataId ? { data: spec.dataId } : {})
                }));
            }
            return encodeChannelItems(spec, withChannel);
        case 'channel':
            return encodeChannelItems(spec, withChannel);
        default: {
            const _exhaustive: never = spec.by;
            return _exhaustive;
        }
    }
}

/** Board-channel LIST rows; shared by `channel` and hub-less `either`. */
function encodeChannelItems(
    spec: Extract<PayloadSpec, { list: string }>,
    endpoints: readonly PollTarget[]
): unknown[] {
    const targets = spec.data ? preferTrait(endpoints, 'presence') : endpoints;
    return targets.map((endpoint) => ({
        channel: endpoint.channel,
        ...(spec.data ? { data: spec.data } : {})
    }));
}

/**
 * LatestX is shared by MS600 (presence) and MS130 (hub sensor). Prefer the
 * matching trait so a mixed hub does not GET LatestX for MTS100 children.
 */
function preferTrait(
    endpoints: readonly PollTarget[],
    trait: TraitName
): PollTarget[] {
    const matched = endpoints.filter((endpoint) => endpoint.traits.includes(trait));
    return matched.length > 0 ? matched : [...endpoints];
}
