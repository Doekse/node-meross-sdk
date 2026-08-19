import type { CloudDevice, CloudSubDevice } from '../cloud';
import type { TraitName } from '../endpoint';
import type { ClassHint, InventoryRow } from '../inventory';
import { CONSUMPTIONH_NAMESPACE } from '../protocol/codecs/consumptionh';
import { CONSUMPTIONX_NAMESPACE } from '../protocol/codecs/consumptionx';
import { ELECTRICITY_NAMESPACE, ELECTRICITYX_NAMESPACE } from '../protocol/codecs/electricity';
import { TOGGLEX_NAMESPACE } from '../protocol/codecs/togglex';
import type { MerossPayload } from '../protocol/message';
import { abilityMaxCmdNum, decodeAbilityGetAck } from './ability';
import type { AbilityMap } from './ability';
import { decodeSystemAllGetAck } from './system-all';
import type { DigestToggle, SystemAll } from './system-all';

export { ABILITY_NAMESPACE, abilityMaxCmdNum, decodeAbilityGetAck } from './ability';
export type { AbilityMap } from './ability';
export { SYSTEM_ALL_NAMESPACE, decodeSystemAllGetAck } from './system-all';
export type { SystemAll } from './system-all';

const CLIMATE_SUBDEVICES = new Set(['mts100', 'mts100v3', 'mts150', 'mts150p']);
const SENSOR_SUBDEVICES = new Set([
    'ms100', 'ms100f', 'ms130', 'ms200', 'ms400', 'ms405', 'ma151', 'gs559'
]);
const SPRINKLER_SUBDEVICES = new Set(['mst100']);

/** meross_lan digest keys that differ from cloud subDeviceType strings. */
const HUB_MODEL_ALIASES: Record<string, string> = {
    mst: 'mst100',
    temphum: 'ms100',
    temphumi: 'ms130',
    doorwindow: 'ms200',
    waterleak: 'ms400',
    smokealarm: 'gs559'
};

export interface EnrollInput {
    abilityPayload: MerossPayload;
    allPayload: MerossPayload;
    cloud?: CloudDevice;
    subDevices?: CloudSubDevice[];
}

/**
 * One Homey-facing row plus the ToggleX/hub bind the switch trait will use.
 * Ids are `{uuid}:{channel}` or `{uuid}#{subDeviceId}` so storeData stays stable.
 */
export interface GraphEndpoint {
    id: string;
    uuid: string;
    channel?: number;
    subDeviceId?: string;
    parentId?: string;
    name: string;
    model: string;
    classHint: ClassHint;
    traits: readonly TraitName[];
    online: boolean;
    /** Digest `togglex.onoff` when System.All carried it; switch uses this as the first tile value. */
    on?: boolean;
}

/**
 * Physical board after Ability + System.All enrollment. Session keeps this
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
    online: boolean;
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
    const energy = ELECTRICITY_NAMESPACE in ability
        || ELECTRICITYX_NAMESPACE in ability
        || CONSUMPTIONX_NAMESPACE in ability
        || CONSUMPTIONH_NAMESPACE in ability;
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
        endpoints: isHub
            ? enrollHub(uuid, name, model, online, all, input.subDevices ?? [])
            : enrollBoard(uuid, name, model, online, energy, ability, all, input.cloud)
    };
}

/**
 * Collects protocol-enrolled boards so Session can project pairing rows.
 */
export class DeviceGraph {
    private readonly physical = new Map<string, PhysicalDevice>();

    enroll(input: EnrollInput): PhysicalDevice {
        const device = enrollPhysicalDevice(input);
        this.physical.set(device.uuid, device);
        return device;
    }

    getPhysical(uuid: string): PhysicalDevice | undefined {
        return this.physical.get(uuid);
    }

    getEndpoint(id: string): GraphEndpoint | undefined {
        for (const device of this.physical.values()) {
            const endpoint = device.endpoints.find((entry) => entry.id === id);
            if (endpoint) {
                return endpoint;
            }
        }
        return undefined;
    }

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
                    online: endpoint.online,
                    ...(endpoint.parentId ? { parentId: endpoint.parentId } : {})
                }))
        );
    }
}

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

function enrollBoard(
    uuid: string,
    name: string,
    model: string,
    online: boolean,
    energy: boolean,
    ability: AbilityMap,
    all: SystemAll,
    cloud: CloudDevice | undefined
): GraphEndpoint[] {
    const endpoints: GraphEndpoint[] = [];
    const taken = new Set<number>();
    const add = (channel: number, classHint: ClassHint, traits: TraitName[], on?: boolean): void => {
        if (taken.has(channel)) {
            return;
        }
        const entry = cloud?.channels?.[channel];
        const named = entry && typeof entry === 'object'
            ? (entry as { devName?: unknown }).devName
            : undefined;
        endpoints.push({
            id: `${uuid}:${channel}`,
            uuid,
            channel,
            name: typeof named === 'string' && named
                ? named
                : (channel === 0 ? name : `${name} ${channel}`),
            model,
            classHint,
            traits: energy && classHint !== 'cover' ? [...traits, 'energy'] : traits,
            online,
            on
        });
        taken.add(channel);
    };

    const lightChannels = all.digest.light.length > 0 ? all.digest.light : ('Appliance.Control.Light' in ability ? [0] : []);
    for (const channel of lightChannels) {
        add(channel, 'light', ['light']);
    }

    const coverChannels = all.digest.garageDoor.length > 0
        ? all.digest.garageDoor
        : all.digest.rollerShutter.length > 0
            ? all.digest.rollerShutter
            : ('Appliance.GarageDoor.State' in ability || 'Appliance.RollerShutter.State' in ability ? [0] : []);
    for (const channel of coverChannels) {
        add(channel, 'cover', ['cover']);
    }

    if (
        'Appliance.Control.Thermostat.Mode' in ability
        || 'Appliance.Control.Thermostat.ModeB' in ability
        || 'Appliance.Control.Thermostat.ModeC' in ability
        || all.digest.thermostat
    ) {
        add(0, 'climate', ['climate']);
    }

    if ('Appliance.Control.Presence.Config' in ability || 'Appliance.Control.Presence.Study' in ability) {
        add(0, 'sensor', ['presence']);
    }

    for (const channel of all.digest.spray) {
        taken.add(channel);
    }
    for (const channel of all.digest.fan) {
        taken.add(channel);
    }
    if (all.digest.diffuser) {
        for (const channel of all.digest.diffuser.light) {
            taken.add(channel);
        }
        for (const channel of all.digest.diffuser.spray) {
            taken.add(channel);
        }
    }
    if (
        'Appliance.Control.Spray' in ability
        || 'Appliance.Control.Diffuser.Light' in ability
        || 'Appliance.Control.Diffuser.Spray' in ability
        || 'Appliance.Control.Fan' in ability
        || 'Appliance.Control.Mp3' in ability
    ) {
        taken.add(0);
    }

    let toggles: DigestToggle[] = all.digest.togglex;
    if (toggles.length === 0 && cloud?.channels?.length) {
        toggles = cloud.channels.map((_, channel) => ({ channel }));
    }
    if (
        toggles.length === 0
        && (TOGGLEX_NAMESPACE in ability || 'Appliance.Control.Toggle' in ability)
    ) {
        toggles = [{ channel: 0 }];
    }
    // Channel 0 is "all outlets" on strips (3+ channels). 2-gang walls keep 0 and 1.
    if (toggles.length >= 3 && toggles.some((entry) => entry.channel === 0)) {
        toggles = toggles.filter((entry) => entry.channel !== 0);
    }
    for (const entry of toggles) {
        add(entry.channel, 'socket', ['switch'], entry.on);
    }

    return endpoints;
}

function enrollHub(
    uuid: string,
    name: string,
    model: string,
    online: boolean,
    all: SystemAll,
    cloudSubs: CloudSubDevice[]
): GraphEndpoint[] {
    const endpoints: GraphEndpoint[] = [{
        id: uuid,
        uuid,
        name,
        model,
        classHint: 'hub',
        traits: [],
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
        if (sub.on === undefined) {
            continue;
        }
        endpoints.push({
            id: `${uuid}#${subDeviceId}`,
            uuid,
            subDeviceId,
            parentId: uuid,
            name: sub.name || subDeviceId,
            model: sub.model || subDeviceId,
            classHint: 'socket',
            traits: ['switch'],
            online: sub.online,
            on: sub.on
        });
    }
    return endpoints;
}
