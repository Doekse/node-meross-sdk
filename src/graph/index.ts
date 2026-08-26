import type { CloudDevice, CloudSubDevice } from '../cloud';
import type { TraitName } from '../endpoint';
import type { ClassHint, InventoryRow } from '../inventory';
import { CONSUMPTIONH_NAMESPACE } from '../protocol/codecs/consumptionh';
import { CONSUMPTIONX_NAMESPACE } from '../protocol/codecs/consumptionx';
import { ELECTRICITY_NAMESPACE, ELECTRICITYX_NAMESPACE } from '../protocol/codecs/electricity';
import type {
    SystemFirmwareState,
    SystemHardwareState,
    SystemTimeState
} from '../protocol/codecs/system';
import { TIMERX_NAMESPACE } from '../protocol/codecs/timerx';
import { TRIGGERX_NAMESPACE } from '../protocol/codecs/triggerx';
import { TOGGLEX_NAMESPACE } from '../protocol/codecs/togglex';
import type { MerossPayload } from '../protocol/message';
import { abilityMaxCmdNum, decodeAbilityGetAck } from './ability';
import type { AbilityMap } from './ability';
import { decodeSystemAllGetAck } from './system-all';
import type { DigestToggle, SystemAll } from './system-all';

export { ABILITY_NAMESPACE, abilityMaxCmdNum, decodeAbilityGetAck } from './ability';
export type { AbilityMap } from './ability';
export {
    CLOUDMQTT_PERIOD_MS,
    DEFAULT_POLL_INTERVAL_MS,
    DevicePoller,
    ENERGY_CLOUD_PERIOD_MS,
    ENERGY_PERIOD_MS,
    HUB_BATTERY_PERIOD_MS,
    SENSOR_FAST_CLOUD_PERIOD_MS,
    SENSOR_FAST_PERIOD_MS,
    SENSOR_SLOW_CLOUD_PERIOD_MS,
    SENSOR_SLOW_PERIOD_MS,
    SYSTEM_ALL_PERIOD_MS
} from './poller';
export type { DevicePollerOptions, PollJob, PollStrategy } from './poller';
export { buildPollJobs } from './poll-jobs';
export type { PollEndpoint } from './poll-jobs';
export { SYSTEM_ALL_NAMESPACE, decodeSystemAllGetAck } from './system-all';
export type { SystemAll } from './system-all';

const CLIMATE_SUBDEVICES = new Set(['mts100', 'mts100v3', 'mts150', 'mts150p']);
const SENSOR_SUBDEVICES = new Set([
    'ms100', 'ms100f', 'ms130', 'ms200', 'ms400', 'ms405', 'ma151', 'gs559'
]);
const SPRINKLER_SUBDEVICES = new Set(['mst100']);

/** Digest type strings that do not match cloud subDeviceType. */
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
    /** Digest/cloud snapshot so DeviceAvailability can start before the first Online PUSH. */
    online: boolean;
    /**
     * System.All board snapshot so SystemTrait can start before the first poll.
     * Standalone Firmware/Hardware GETs stay a fallback when All omitted fields.
     */
    system: {
        firmware: SystemFirmwareState;
        hardware: SystemHardwareState;
        time?: SystemTimeState;
    };
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
    const boardEnergy = ELECTRICITY_NAMESPACE in ability || CONSUMPTIONX_NAMESPACE in ability;
    const channelEnergy = ELECTRICITYX_NAMESPACE in ability || CONSUMPTIONH_NAMESPACE in ability;
    const hasDnd = 'Appliance.System.DNDMode' in ability;
    const hasAlarm = 'Appliance.Control.Alarm' in ability;
    const hasTimerX = TIMERX_NAMESPACE in ability;
    const hasTriggerX = TRIGGERX_NAMESPACE in ability;
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
        endpoints: isHub
            ? enrollHub(uuid, name, model, online, hasDnd, hasAlarm, all, input.subDevices ?? [])
            : enrollBoard(
                uuid, name, model, online, boardEnergy, channelEnergy, hasDnd, hasTimerX, hasTriggerX,
                ability, all, input.cloud
            )
    };
}

/**
 * Collects protocol-enrolled boards so Session can project inventory rows.
 */
export class DeviceGraph {
    private readonly physical = new Map<string, PhysicalDevice>();

    /**
     * Replaces the board for this uuid so a later Ability/System.All refresh
     * keeps the same physical entry.
     */
    enroll(input: EnrollInput): PhysicalDevice {
        const device = enrollPhysicalDevice(input);
        this.physical.set(device.uuid, device);
        return device;
    }

    /**
     * Session needs the board (LAN IP, ability, maxCmdNum), not the inventory row.
     */
    getPhysical(uuid: string): PhysicalDevice | undefined {
        return this.physical.get(uuid);
    }

    /**
     * Inventory ids are `{uuid}:{channel}` or `{uuid}#{subDeviceId}`; lookup
     * walks boards because those ids are not the physical map key.
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
    boardEnergy: boolean,
    channelEnergy: boolean,
    hasDnd: boolean,
    hasTimerX: boolean,
    hasTriggerX: boolean,
    ability: AbilityMap,
    all: SystemAll,
    cloud: CloudDevice | undefined
): GraphEndpoint[] {
    const endpoints: GraphEndpoint[] = [];
    const taken = new Set<number>();
    const hasMp3 = 'Appliance.Control.Mp3' in ability;
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
        // Board diagnostics live on channel 0 / hub root only.
        if (channel === 0 && !traits.includes('system')) {
            extra.push('system');
        }
        if (
            (channelEnergy && classHint === 'socket')
            || (boardEnergy && classHint !== 'cover' && parentId === undefined)
        ) {
            extra.push('energy');
        }
        if (hasMp3 && channel === 0 && !traits.includes('media')) {
            extra.push('media');
        }
        if (hasDnd && channel === 0 && !traits.includes('dnd')) {
            extra.push('dnd');
        }
        // ToggleX-shaped TimerX extend only; cover/climate/humidifier/speaker use other extend objects.
        if (
            hasTimerX
            && (classHint === 'socket' || classHint === 'light' || classHint === 'fan')
            && !traits.includes('timer')
            && !traits.includes('media')
            && !extra.includes('media')
        ) {
            extra.push('timer');
        }
        // Same board endpoints as timer (socket/light/fan); skip media speakers.
        if (
            hasTriggerX
            && (classHint === 'socket' || classHint === 'light' || classHint === 'fan')
            && !traits.includes('trigger')
            && !traits.includes('media')
            && !extra.includes('media')
        ) {
            extra.push('trigger');
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

    const diffuserChannels = new Set<number>([
        ...(all.digest.diffuser?.light ?? []),
        ...(all.digest.diffuser?.spray ?? [])
    ]);
    if (
        diffuserChannels.size === 0
        && ('Appliance.Control.Diffuser.Light' in ability || 'Appliance.Control.Diffuser.Spray' in ability)
    ) {
        diffuserChannels.add(0);
    }
    for (const channel of diffuserChannels) {
        add(channel, 'humidifier', ['diffuser']);
    }

    const sprayChannels = all.digest.spray.length > 0
        ? all.digest.spray
        : ('Appliance.Control.Spray' in ability ? [0] : []);
    for (const channel of sprayChannels) {
        add(channel, 'humidifier', ['spray']);
    }

    const fanChannels = all.digest.fan.length > 0
        ? all.digest.fan
        : ('Appliance.Control.Fan' in ability ? [0] : []);
    for (const channel of fanChannels) {
        add(channel, 'fan', ['fan']);
    }

    if (hasMp3 && !taken.has(0)) {
        add(0, 'speaker', ['media']);
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
    if (all.digest.garageDoor.some((channel) => channel !== 0)) {
        toggles = toggles.filter((entry) => entry.channel !== 0);
    }
    const masterId = `${uuid}:0`;
    const isStrip = toggles.length >= 3 && toggles.some((entry) => entry.channel === 0);
    for (const entry of toggles) {
        add(
            entry.channel,
            'socket',
            ['switch'],
            entry.on,
            isStrip && entry.channel !== 0 ? masterId : undefined
        );
    }

    if (hasDnd && !taken.has(0)) {
        add(0, 'socket', ['dnd']);
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
    hasDnd: boolean,
    hasAlarm: boolean,
    all: SystemAll,
    cloudSubs: CloudSubDevice[]
): GraphEndpoint[] {
    const hubTraits: TraitName[] = ['system'];
    if (hasAlarm) {
        hubTraits.push('alarm');
    }
    if (hasDnd) {
        hubTraits.push('dnd');
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
