import type { CloudDevice, CloudSubDevice } from '../cloud';
import type { TraitName } from '../endpoint';
import type { ClassHint, InventoryRow } from '../inventory';
import type {
    SystemFirmwareState,
    SystemHardwareState,
    SystemTimeState
} from '../protocol/codecs/system';
import type { MerossPayload } from '../protocol/message';
import { abilityMaxCmdNum, decodeAbilityGetAck } from '../protocol/codecs/ability';
import type { AbilityMap } from '../protocol/codecs/ability';
import { decodeSystemAllGetAck, getDigestNamespaces } from '../protocol/codecs/system-all';
import type { SystemAll } from '../protocol/codecs/system-all';
import {
    enrollAlarmStandalone,
    enrollBoardAlarmExtra,
    enrollHubAlarmExtra
} from '../traits/alarm';
import { enrollCover } from '../traits/cover';
import { enrollDiffuser } from '../traits/diffuser';
import {
    enrollBoardDndExtra,
    enrollDndStandalone,
    enrollHubDndExtra
} from '../traits/dnd';
import { enrollBoardEnergyExtra } from '../traits/energy';
import { enrollFan } from '../traits/fan';
import { enrollLight } from '../traits/light';
import { enrollBoardMediaExtra, enrollMediaStandalone } from '../traits/media';
import { enrollPresence } from '../traits/presence';
import { enrollSpray } from '../traits/spray';
import { enrollBoardSystemExtra } from '../traits/system';
import {
    enrollHubUntypedOnoff,
    enrollSwitchLeftover
} from '../traits/switch';
import { enrollBoardTimerExtra } from '../traits/timer';
import { enrollBoardTriggerExtra } from '../traits/trigger';
import type { EnrollBoardContext, EnrollBoardExtraInput } from './enroll-context';

export { ABILITY_NAMESPACE, abilityMaxCmdNum, decodeAbilityGetAck } from '../protocol/codecs/ability';
export type { AbilityMap } from '../protocol/codecs/ability';
export { SYSTEM_ALL_NAMESPACE, decodeSystemAllGetAck } from '../protocol/codecs/system-all';
export type { SystemAll } from '../protocol/codecs/system-all';

const CLIMATE_SUBDEVICES = new Set(['mts100', 'mts100v3', 'mts150', 'mts150p']);
const SENSOR_SUBDEVICES = new Set([
    'ms100', 'ms100f', 'ms120', 'ms130', 'ms200', 'ms400', 'ms405', 'ma151', 'gs559'
]);
const SPRINKLER_SUBDEVICES = new Set(['mst100']);

/** Digest type strings that do not match cloud subDeviceType. */
const HUB_MODEL_ALIASES: Record<string, string> = {
    mst: 'mst100',
    temphum: 'ms100',
    temphumi: 'ms130',
    doorwindow: 'ms200',
    waterleak: 'ms400',
    smokealarm: 'gs559',
    motion: 'ms120'
};

export interface EnrollInput {
    abilityPayload: MerossPayload;
    allPayload: MerossPayload;
    cloud?: CloudDevice;
    subDevices?: CloudSubDevice[];
}

/**
 * One user-visible row plus the ToggleX/hub bind the switch trait will use.
 * Ids are `{uuid}:{channel}` or `{uuid}#{subDeviceId}` so they stay stable across reconnects.
 */
export interface GraphEndpoint {
    id: string;
    uuid: string;
    channel?: number;
    subDeviceId?: string;
    /**
     * Hub child or extra strip outlet. Hosts can group under this id instead of
     * merging those sockets into the parent device.
     */
    parentId?: string;
    name: string;
    model: string;
    classHint: ClassHint;
    traits: readonly TraitName[];
    /** Digest/cloud snapshot so Endpoint can start before the first Online PUSH. */
    online: boolean;
    /** Digest `togglex.onoff` when System.All carried it, so switch has a value before the first PUSH. */
    on?: boolean;
}

/**
 * Physical device after Ability + System.All enrollment. Session keeps this
 * for LAN IP / Multiple packing; inventory only sees {@link GraphEndpoint}.
 */
export interface PhysicalDevice {
    uuid: string;
    model: string;
    name: string;
    ability: AbilityMap;
    maxCmdNum: number;
    innerIp?: string;
    macAddress?: string;
    /** Digest/cloud snapshot so DeviceAvailability can start before the first Online PUSH. */
    online: boolean;
    /**
     * System.All device snapshot so SystemTrait can start before the first poll.
     * Standalone Firmware/Hardware GETs stay a fallback when All omitted fields.
     */
    system: {
        firmware: SystemFirmwareState;
        hardware: SystemHardwareState;
        time?: SystemTimeState;
    };
    /**
     * Namespaces carried in the System.All digest so DevicePoller GETs them
     * only as the All fallback, not beside it.
     */
    digestNamespaces: ReadonlySet<string>;
    endpoints: readonly GraphEndpoint[];
}

/**
 * Turns Ability + System.All into stable endpoint ids. Cloud rows only fill
 * names; digest/ability win on payload shape.
 */
export function enrollPhysicalDevice(input: EnrollInput): PhysicalDevice {
    const ability = decodeAbilityGetAck(input.abilityPayload);
    const all = decodeSystemAllGetAck(input.allPayload);
    const uuid = all.hardware.uuid;
    const model = input.cloud?.deviceType || all.hardware.type;
    const name = input.cloud?.devName || all.hardware.type;
    const online = all.online.status === 1 || input.cloud?.onlineStatus === 1;
    const isHub = 'Appliance.Hub.SubdeviceList' in ability || all.digest.hub !== undefined;

    return {
        uuid,
        model,
        name,
        ability,
        maxCmdNum: abilityMaxCmdNum(ability),
        innerIp: all.firmware.innerIp,
        macAddress: all.hardware.macAddress,
        online,
        system: {
            firmware: all.firmware,
            hardware: all.hardware,
            ...(all.time ? { time: all.time } : {})
        },
        digestNamespaces: getDigestNamespaces(all.digest),
        endpoints: isHub
            ? enrollHub(uuid, name, model, online, ability, all, input.subDevices ?? [])
            : enrollBoard(uuid, name, model, online, ability, all, input.cloud)
    };
}

/** Order-insensitive, because neither abilities nor traits carry an order. */
function sameMembers(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) {
        return false;
    }
    const seen = new Set(a);
    return b.every((value) => seen.has(value));
}

/**
 * Whether two enrollments are interchangeable. Traits capture an ability
 * snapshot and a channel at construction. A change to abilities, digest
 * membership, or endpoint traits needs the device's endpoints rebuilt against
 * the new shape.
 */
function sameShape(a: PhysicalDevice, b: PhysicalDevice): boolean {
    if (!sameMembers(Object.keys(a.ability), Object.keys(b.ability))) {
        return false;
    }
    if (!sameMembers([...a.digestNamespaces], [...b.digestNamespaces])) {
        return false;
    }
    if (a.endpoints.length !== b.endpoints.length) {
        return false;
    }
    const byId = new Map(a.endpoints.map((endpoint) => [endpoint.id, endpoint]));
    return b.endpoints.every((endpoint) => {
        const previous = byId.get(endpoint.id);
        return previous !== undefined && sameMembers(previous.traits, endpoint.traits);
    });
}

export interface EnrollResult {
    device: PhysicalDevice;
    /** True when the caller must rebuild this device's endpoints. */
    reshaped: boolean;
}

/**
 * Collects protocol-enrolled devices so Session can project inventory rows.
 */
export class DeviceGraph {
    private readonly physical = new Map<string, PhysicalDevice>();

    /**
     * An unchanged shape refreshes the stored device in place and keeps its
     * object identity, because Session's pollers and availability probes read
     * live fields (innerIp, maxCmdNum) straight off it.
     */
    enroll(input: EnrollInput): EnrollResult {
        const device = enrollPhysicalDevice(input);
        const existing = this.physical.get(device.uuid);
        if (!existing || !sameShape(existing, device)) {
            this.physical.set(device.uuid, device);
            return { device, reshaped: true };
        }
        return { device: Object.assign(existing, device), reshaped: false };
    }

    /**
     * Session needs the device (LAN IP, ability, maxCmdNum), not the inventory row.
     */
    getPhysical(uuid: string): PhysicalDevice | undefined {
        return this.physical.get(uuid);
    }

    /** Enrolled device ids, for reconciling against a fresh cloud device list. */
    uuids(): string[] {
        return [...this.physical.keys()];
    }

    /**
     * Drops a device that left the account. Session stops its poller and
     * availability separately; this only clears the projection source.
     */
    remove(uuid: string): void {
        this.physical.delete(uuid);
    }

    /**
     * Inventory ids are `{uuid}:{channel}` or `{uuid}#{subDeviceId}`; lookup
     * walks devices because those ids are not the physical map key.
     */
    getEndpoint(id: string): GraphEndpoint | undefined {
        for (const device of this.physical.values()) {
            const endpoint = device.endpoints.find((entry) => entry.id === id);
            if (endpoint) {
                return endpoint;
            }
        }
        return undefined;
    }

    /**
     * Drops trait-less rows (unclassified hub children). The hub parent stays
     * visible when it carries system / alarm / dnd.
     */
    inventoryRows(): InventoryRow[] {
        return [...this.physical.values()].flatMap((device) =>
            device.endpoints
                .filter((endpoint) => endpoint.traits.length > 0)
                .map((endpoint) => ({
                    id: endpoint.id,
                    name: endpoint.name,
                    model: endpoint.model,
                    classHint: endpoint.classHint,
                    traits: [...endpoint.traits],
                    ...(endpoint.parentId ? { parentId: endpoint.parentId } : {})
                }))
        );
    }
}

/**
 * Unknown digest types return undefined so enrollHub can fall back to onoff
 * or omit the row.
 */
function classifyHubChild(raw: string | undefined): {
    model: string;
    classHint: ClassHint;
    traits: readonly TraitName[];
} | undefined {
    if (!raw) {
        return undefined;
    }
    const lowered = raw.toLowerCase();
    const model = HUB_MODEL_ALIASES[lowered] ?? lowered;
    if (CLIMATE_SUBDEVICES.has(model)) {
        return { model, classHint: 'climate', traits: ['climate'] };
    }
    if (SENSOR_SUBDEVICES.has(model)) {
        return { model, classHint: 'sensor', traits: ['sensor'] };
    }
    if (SPRINKLER_SUBDEVICES.has(model)) {
        return { model, classHint: 'sprinkler', traits: ['sprinkler'] };
    }
    return undefined;
}

/**
 * Extra strip sockets get parentId because firmware channel 0 is the "all
 * outlets" switch; two-gang walls keep 0 and 1 independent so neither is a
 * parent. Classic Electricity stays on the master because it reports the
 * whole board; ElectricityX/ConsumptionH also land on children because those
 * namespaces are per outlet. MSG200 ToggleX 0 is omitted because the doors
 * live on 1-n.
 */
function enrollBoard(
    uuid: string,
    name: string,
    model: string,
    online: boolean,
    ability: AbilityMap,
    all: SystemAll,
    cloud: CloudDevice | undefined
): GraphEndpoint[] {
    const endpoints: GraphEndpoint[] = [];
    const taken = new Set<number>();
    const add = (
        channel: number,
        classHint: ClassHint,
        traits: TraitName[],
        on?: boolean,
        parentId?: string
    ): void => {
        if (taken.has(channel)) {
            return;
        }
        const entry = cloud?.channels?.[channel];
        const named = entry && typeof entry === 'object'
            ? (entry as { devName?: unknown }).devName
            : undefined;
        const extra: TraitName[] = [];
        const input: EnrollBoardExtraInput = {
            channel,
            classHint,
            traits,
            extra,
            parentId,
            ability
        };
        extra.push(...enrollBoardSystemExtra(input));
        extra.push(...enrollBoardEnergyExtra(input));
        extra.push(...enrollBoardMediaExtra(input));
        extra.push(...enrollBoardDndExtra(input));
        extra.push(...enrollBoardAlarmExtra(input));
        extra.push(...enrollBoardTimerExtra(input));
        extra.push(...enrollBoardTriggerExtra(input));
        endpoints.push({
            id: `${uuid}:${channel}`,
            uuid,
            channel,
            ...(parentId ? { parentId } : {}),
            name: typeof named === 'string' && named
                ? named
                : (channel === 0 ? name : `${name} ${channel}`),
            model,
            classHint,
            traits: [...traits, ...extra],
            online,
            on
        });
        taken.add(channel);
    };
    const ctx: EnrollBoardContext = {
        uuid,
        name,
        model,
        online,
        ability,
        all,
        cloud,
        taken,
        add
    };

    enrollLight(ctx);
    enrollCover(ctx);

    if (
        'Appliance.Control.Thermostat.Mode' in ability
        || 'Appliance.Control.Thermostat.ModeB' in ability
        || 'Appliance.Control.Thermostat.ModeC' in ability
        || all.digest.thermostat
    ) {
        add(0, 'climate', ['climate']);
    }

    enrollPresence(ctx);
    enrollDiffuser(ctx);
    enrollSpray(ctx);
    enrollFan(ctx);

    enrollMediaStandalone(ctx);

    enrollSwitchLeftover(ctx);

    enrollDndStandalone(ctx);
    enrollAlarmStandalone(ctx);

    return endpoints;
}

/**
 * parentId is the hub uuid so hosts can group children without treating the
 * board as the only user-visible device.
 */
function enrollHub(
    uuid: string,
    name: string,
    model: string,
    online: boolean,
    ability: AbilityMap,
    all: SystemAll,
    cloudSubs: CloudSubDevice[]
): GraphEndpoint[] {
    const hubTraits: TraitName[] = [
        'system',
        ...enrollHubAlarmExtra(ability),
        ...enrollHubDndExtra(ability)
    ];
    const endpoints: GraphEndpoint[] = [{
        id: uuid,
        uuid,
        name,
        model,
        classHint: 'hub',
        traits: hubTraits,
        online
    }];

    const byId = new Map<string, { model?: string; name?: string; online: boolean; on?: boolean }>();
    for (const sub of all.digest.hub?.subdevice ?? []) {
        byId.set(sub.id, { model: sub.model, online: sub.status === 1, on: sub.on });
    }
    for (const sub of cloudSubs) {
        const existing = byId.get(sub.subDeviceId);
        if (existing) {
            existing.model = sub.subDeviceType || existing.model;
            existing.name = sub.subDeviceName || existing.name;
        } else {
            byId.set(sub.subDeviceId, {
                model: sub.subDeviceType,
                name: sub.subDeviceName,
                online
            });
        }
    }

    for (const [subDeviceId, sub] of byId) {
        const child = classifyHubChild(sub.model);
        if (child) {
            endpoints.push({
                id: `${uuid}#${subDeviceId}`,
                uuid,
                subDeviceId,
                parentId: uuid,
                name: sub.name || child.model,
                model: child.model,
                classHint: child.classHint,
                traits: child.traits,
                online: sub.online
            });
            continue;
        }
        const untyped = enrollHubUntypedOnoff({
            uuid,
            subDeviceId,
            name: sub.name,
            model: sub.model,
            online: sub.online,
            on: sub.on
        });
        if (untyped) {
            endpoints.push(untyped);
        }
    }
    return endpoints;
}
