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
    CONFIG_OVERTEMP_NAMESPACE,
    CONFIG_STANDBY_KILLER_NAMESPACE,
    CONSUMPTIONH_NAMESPACE,
    CONSUMPTIONX_NAMESPACE,
    CONTROL_ALARM_NAMESPACE,
    CONTROL_ALERT_CONFIG_NAMESPACE,
    CONTROL_BEEP_NAMESPACE,
    CONTROL_TIMER_NAMESPACE,
    CONTROL_TRIGGER_NAMESPACE,
    DIFFUSER_LIGHT_NAMESPACE,
    DIFFUSER_SPRAY_NAMESPACE,
    DND_MODE_NAMESPACE,
    ELECTRICITY_NAMESPACE,
    ELECTRICITYX_NAMESPACE,
    FAN_NAMESPACE,
    GARAGE_STATE_NAMESPACE,
    LIGHT_NAMESPACE,
    MP3_NAMESPACE,
    PRESENCE_CONFIG_NAMESPACE,
    PRESENCE_STUDY_NAMESPACE,
    SHUTTER_STATE_NAMESPACE,
    SPRAY_NAMESPACE,
    THERMOSTAT_MODEB_NAMESPACE,
    THERMOSTAT_MODEC_NAMESPACE,
    THERMOSTAT_MODE_NAMESPACE,
    TIMERX_NAMESPACE,
    TOGGLE_NAMESPACE,
    TOGGLEX_NAMESPACE,
    TRIGGERX_NAMESPACE
} from '../protocol/namespaces';
import { loadTrait } from '../traits/load';
import type { EnrollBoardContext, EnrollBoardExtraInput } from './enroll-context';
import { HUB_CHILD_RULES } from './hub-child';

export { ABILITY_NAMESPACE, abilityMaxCmdNum, decodeAbilityGetAck } from '../protocol/codecs/ability';
export type { AbilityMap } from '../protocol/codecs/ability';
export { SYSTEM_ALL_NAMESPACE, decodeSystemAllGetAck } from '../protocol/codecs/system-all';
export type { SystemAll } from '../protocol/codecs/system-all';

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
 * First matching digest alias across climate → sensor → sprinkler. A separate
 * pass from model lookup so a later map's alias cannot be mixed into an
 * earlier trait's model test.
 */
function rewriteHubChildAlias(lowered: string): string {
    for (const rule of HUB_CHILD_RULES) {
        const aliased = rule.hubChild.aliases[lowered];
        if (aliased !== undefined) {
            return aliased;
        }
    }
    return lowered;
}

/**
 * Unknown digest types return undefined so enrollHub can fall back to onoff
 * or omit the row. Alias rewrite consults the three hubChild maps before
 * model-set lookup (climate → sensor → sprinkler).
 */
function classifyHubChild(raw: string | undefined): {
    model: string;
    classHint: ClassHint;
    traits: readonly TraitName[];
} | undefined {
    if (!raw) {
        return undefined;
    }
    const model = rewriteHubChildAlias(raw.toLowerCase());
    for (const rule of HUB_CHILD_RULES) {
        if (rule.hubChild.models.has(model)) {
            return {
                model,
                classHint: rule.hubChild.classHint,
                traits: [rule.name]
            };
        }
    }
    return undefined;
}

/**
 * Extra strip sockets get parentId because firmware channel 0 is the "all
 * outlets" switch; two-gang walls keep 0 and 1 independent so neither is a
 * parent. Classic Electricity stays on the master because it reports the
 * whole board; ElectricityX/ConsumptionH also land on children because those
 * namespaces are per outlet. MSG200 ToggleX 0 is omitted because the doors
 * live on 1-n. Ability/digest gates run before each loadTrait so unused
 * trait modules stay unloaded; extra helpers still apply their own
 * channel/classHint rules.
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
    // Once per board so add() does not loadTrait on leftover channels when
    // Ability never advertised that extra.
    const hasEnergy = ELECTRICITY_NAMESPACE in ability
        || CONSUMPTIONX_NAMESPACE in ability
        || ELECTRICITYX_NAMESPACE in ability
        || CONSUMPTIONH_NAMESPACE in ability;
    const hasMedia = MP3_NAMESPACE in ability;
    const hasDnd = DND_MODE_NAMESPACE in ability;
    const hasOverTemp = CONFIG_OVERTEMP_NAMESPACE in ability;
    const hasAlert = CONTROL_ALERT_CONFIG_NAMESPACE in ability;
    const hasStandbyKiller = CONFIG_STANDBY_KILLER_NAMESPACE in ability;
    const hasAlarm = CONTROL_ALARM_NAMESPACE in ability || CONTROL_BEEP_NAMESPACE in ability;
    const hasTimer = TIMERX_NAMESPACE in ability || CONTROL_TIMER_NAMESPACE in ability;
    const hasTrigger = TRIGGERX_NAMESPACE in ability || CONTROL_TRIGGER_NAMESPACE in ability;
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
        if (channel === 0) {
            extra.push(...loadTrait('system').enrollBoardSystemExtra(input));
        }
        if (hasEnergy) {
            extra.push(...loadTrait('energy').enrollBoardEnergyExtra(input));
        }
        if (hasMedia) {
            extra.push(...loadTrait('media').enrollBoardMediaExtra(input));
        }
        if (hasDnd) {
            extra.push(...loadTrait('dnd').enrollBoardDndExtra(input));
        }
        if (hasOverTemp) {
            extra.push(...loadTrait('overtemp').enrollBoardOverTempExtra(input));
        }
        if (hasAlert) {
            extra.push(...loadTrait('alert').enrollBoardAlertExtra(input));
        }
        if (hasStandbyKiller) {
            extra.push(...loadTrait('standbykiller').enrollBoardStandbyKillerExtra(input));
        }
        if (hasAlarm) {
            extra.push(...loadTrait('alarm').enrollBoardAlarmExtra(input));
        }
        if (hasTimer) {
            extra.push(...loadTrait('timer').enrollBoardTimerExtra(input));
        }
        if (hasTrigger) {
            extra.push(...loadTrait('trigger').enrollBoardTriggerExtra(input));
        }
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

    if (all.digest.light.length > 0 || LIGHT_NAMESPACE in ability) {
        loadTrait('light').enrollLight(ctx);
    }
    if (
        all.digest.garageDoor.length > 0
        || all.digest.rollerShutter.length > 0
        || GARAGE_STATE_NAMESPACE in ability
        || SHUTTER_STATE_NAMESPACE in ability
    ) {
        loadTrait('cover').enrollCover(ctx);
    }
    if (
        THERMOSTAT_MODE_NAMESPACE in ability
        || THERMOSTAT_MODEB_NAMESPACE in ability
        || THERMOSTAT_MODEC_NAMESPACE in ability
        || all.digest.thermostat
    ) {
        loadTrait('climate').enrollClimate(ctx);
    }
    if (PRESENCE_CONFIG_NAMESPACE in ability || PRESENCE_STUDY_NAMESPACE in ability) {
        loadTrait('presence').enrollPresence(ctx);
    }
    if (
        all.digest.diffuser
        || DIFFUSER_LIGHT_NAMESPACE in ability
        || DIFFUSER_SPRAY_NAMESPACE in ability
    ) {
        loadTrait('diffuser').enrollDiffuser(ctx);
    }
    if (all.digest.spray.length > 0 || SPRAY_NAMESPACE in ability) {
        loadTrait('spray').enrollSpray(ctx);
    }
    if (all.digest.fan.length > 0 || FAN_NAMESPACE in ability) {
        loadTrait('fan').enrollFan(ctx);
    }

    if (hasMedia) {
        loadTrait('media').enrollMediaStandalone(ctx);
    }

    if (
        all.digest.togglex.length > 0
        || (cloud?.channels?.length ?? 0) > 0
        || TOGGLEX_NAMESPACE in ability
        || TOGGLE_NAMESPACE in ability
        || all.digest.garageDoor.some((door) => door.channel !== 0)
    ) {
        loadTrait('switch').enrollSwitchLeftover(ctx);
    }

    if (hasDnd) {
        loadTrait('dnd').enrollDndStandalone(ctx);
    }
    if (hasOverTemp) {
        loadTrait('overtemp').enrollOverTempStandalone(ctx);
    }
    if (hasAlarm) {
        loadTrait('alarm').enrollAlarmStandalone(ctx);
    }

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
    const hubTraits: TraitName[] = ['system'];
    if (CONTROL_ALARM_NAMESPACE in ability || CONTROL_BEEP_NAMESPACE in ability) {
        hubTraits.push(...loadTrait('alarm').enrollHubAlarmExtra(ability));
    }
    if (DND_MODE_NAMESPACE in ability) {
        hubTraits.push(...loadTrait('dnd').enrollHubDndExtra(ability));
    }
    if (CONFIG_OVERTEMP_NAMESPACE in ability) {
        hubTraits.push(...loadTrait('overtemp').enrollHubOverTempExtra(ability));
    }
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
        // Unknown SKUs without digest onoff stay trait-less; skip loadTrait.
        if (sub.on !== undefined) {
            const untyped = loadTrait('switch').enrollHubUntypedOnoff({
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
    }
    return endpoints;
}
