import type { CloudDevice, CloudSubDevice } from '../cloud';
import type { TraitName } from '../endpoint';
import type { ClassHint, InventoryRow } from '../inventory';
import type { MerossPayload } from '../protocol/message';
import { abilityMaxCmdNum, decodeAbilityGetAck } from './ability';
import type { AbilityMap } from './ability';
import { decodeSystemAllGetAck } from './system-all';
import type { SystemAll } from './system-all';

export { ABILITY_NAMESPACE, abilityMaxCmdNum, decodeAbilityGetAck } from './ability';
export type { AbilityMap } from './ability';
export { SYSTEM_ALL_NAMESPACE, decodeSystemAllGetAck } from './system-all';
export type { SystemAll } from './system-all';

const CLIMATE_SUBDEVICES = new Set(['mts100', 'mts100v3', 'mts150', 'mts150p']);

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
    const energy = 'Appliance.Control.Electricity' in ability
        || 'Appliance.Control.ElectricityX' in ability
        || 'Appliance.Control.ConsumptionX' in ability;
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
 * Collects enrolled boards so Session can project pairing rows without
 * talking to MQTT.
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
            device.endpoints.map((endpoint) => ({
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
    const add = (channel: number, classHint: ClassHint, traits: TraitName[]): void => {
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
            online
        });
        taken.add(channel);
    };

    const lightChannels = all.digest.light.length > 0 ? all.digest.light : ('Appliance.Control.Light' in ability ? [0] : []);
    for (const channel of lightChannels) {
        add(channel, 'light', ['light']);
    }

    const coverChannels = all.digest.garageDoor.length > 0
        ? all.digest.garageDoor
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

    let toggleChannels = all.digest.togglex;
    if (toggleChannels.length === 0 && cloud?.channels?.length) {
        toggleChannels = cloud.channels.map((_, index) => index);
    }
    if (
        toggleChannels.length === 0
        && ('Appliance.Control.ToggleX' in ability || 'Appliance.Control.Toggle' in ability)
    ) {
        toggleChannels = [0];
    }
    // Channel 0 is "all outlets" on strips (3+ channels). 2-gang walls keep 0 and 1.
    if (toggleChannels.length >= 3 && toggleChannels.includes(0)) {
        toggleChannels = toggleChannels.filter((channel) => channel !== 0);
    }
    for (const channel of toggleChannels) {
        add(channel, 'socket', ['switch']);
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

    const byId = new Map<string, { model?: string; name?: string; online: boolean }>();
    for (const sub of all.digest.hub?.subdevice ?? []) {
        byId.set(sub.id, { model: sub.model, online: sub.status === 1 });
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
        const subModel = sub.model || model;
        const classHint: ClassHint = CLIMATE_SUBDEVICES.has(subModel.toLowerCase()) ? 'climate' : 'sensor';
        endpoints.push({
            id: `${uuid}#${subDeviceId}`,
            uuid,
            subDeviceId,
            parentId: uuid,
            name: sub.name || subModel,
            model: subModel,
            classHint,
            traits: classHint === 'climate' ? ['climate'] : [],
            online: sub.online
        });
    }
    return endpoints;
}
