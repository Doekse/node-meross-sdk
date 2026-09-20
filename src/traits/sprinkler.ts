import type { TraitAttachArgs } from '../device/enroll-context';
import { SPRINKLER_HUB_CHILD } from '../device/hub-child';
import { CommandError } from '../errors';
import {
    decodeHubExceptionPush,
    decodeHubSubDeviceVersionPush
} from '../protocol/codecs/hub';
import {
    HUB_BATTERY_NAMESPACE,
    decodeBatteryPush
} from '../protocol/codecs/sensor';
import {
    CONTROL_WATER_EVENT_NAMESPACE,
    CONTROL_WATER_NAMESPACE,
    DEVICE_CFG_NAMESPACE,
    WATER_PLAN_NAMESPACE,
    decodeDeviceCfgPush,
    decodeWaterEventPush,
    decodeWaterPlanGetAck,
    decodeWaterPush,
    encodeDeviceCfgSet,
    encodeWaterPlanGet,
    encodeWaterPlanSet,
    encodeWaterSet,
    type WaterControlState,
    type WaterEventState,
    type WaterPlanEntry
} from '../protocol/codecs/water';
import type { MerossMessage } from '../protocol/message';
import {
    HUB_EXCEPTION_NAMESPACE,
    HUB_SUBDEVICE_VERSION_NAMESPACE
} from '../protocol/namespaces';
import {
    DEFAULT,
    SMART_CONFIG,
    subIdList,
    type PollSpec
} from '../poll/spec';
import type { DeviceRequest } from '../request';
import type { HubChildRule, TraitDescriptor } from './descriptor';
import { applyPatch } from './patch';

/** Completed watering cycle from Control.WaterEvent. */
export interface SprinklerCycleSummary {
    /** Actual watering duration in seconds. */
    duration?: number;
    /** Firmware water-consumption counter. */
    waterConsumption?: number;
    /** Unix timestamp when the cycle completed. */
    timestamp?: number;
}

export interface SprinklerValues {
    on?: boolean;
    /** Watering duration in seconds. */
    duration?: number;
    battery?: number;
    fault?: number;
    firmwareVersion?: string;
    hardwareVersion?: string;
    /** Most recent completed cycle from Control.WaterEvent. */
    lastCycle?: SprinklerCycleSummary;
}

export type SprinklerScheduleEntry = WaterPlanEntry;

/**
 * Transport + sub-device bind for a hub sprinkler child. Session supplies this;
 * trait tests inject a fake request/emit pair.
 */
export interface SprinklerTraitBind {
    subDeviceId: string;
    /** Ability keys; DeviceCfg, Battery, WaterPlan, and WaterEvent no-op when absent. */
    namespaces?: ReadonlySet<string>;
    request: DeviceRequest;
    emitChange: (values: SprinklerValues) => void;
}

/**
 * Hub child sprinkler (MST100). On/off uses Control.Water onoff 1/2; default
 * duration lives in DeviceCfg mstCfg.dura. Schedules use Config.WaterPlan when
 * the hub actually answers (many reply error 5000). Completed cycles arrive as
 * Control.WaterEvent PUSH.
 */
export class SprinklerTrait {
    private readonly bind: SprinklerTraitBind;
    private readonly namespaces: ReadonlySet<string>;
    private last: SprinklerValues = {};

    constructor(bind: SprinklerTraitBind) {
        this.bind = bind;
        this.namespaces = bind.namespaces ?? new Set();
    }

    /** Undefined until poller GETACK or PUSH fills it. */
    isOn(): boolean | undefined {
        return this.last.on;
    }

    /** Default watering duration from DeviceCfg. Undefined until GETACK or PUSH fills it. */
    getDuration(): number | undefined {
        return this.last.duration;
    }

    /**
     * Uses Control.Water, never Hub.ToggleX (firmware onoff is 1/2).
     */
    async setOn(on: boolean): Promise<{ on: boolean }> {
        await this.bind.request({
            namespace: CONTROL_WATER_NAMESPACE,
            method: 'SET',
            payload: encodeWaterSet({ subId: this.bind.subDeviceId, on })
        });
        this.applyChange({ on });
        return { on };
    }

    /**
     * Writes DeviceCfg `mstCfg.dura`. No-op when DeviceCfg is absent.
     */
    async setDuration(seconds: number): Promise<{ duration: number }> {
        if (!this.has(DEVICE_CFG_NAMESPACE)) {
            return { duration: seconds };
        }
        await this.bind.request({
            namespace: DEVICE_CFG_NAMESPACE,
            method: 'SET',
            payload: encodeDeviceCfgSet({ subId: this.bind.subDeviceId, duration: seconds })
        });
        this.applyChange({ duration: seconds });
        return { duration: seconds };
    }

    /**
     * On-demand only (never Digest.WaterPlan). Returns `undefined` when the
     * namespace is absent or the hub replies with error 5000.
     */
    async getSchedule(): Promise<SprinklerScheduleEntry[] | undefined> {
        if (!this.has(WATER_PLAN_NAMESPACE)) {
            return undefined;
        }
        try {
            const reply = await this.bind.request({
                namespace: WATER_PLAN_NAMESPACE,
                method: 'GET',
                payload: encodeWaterPlanGet({ subId: this.bind.subDeviceId })
            });
            return decodeWaterPlanGetAck(reply.payload)
                .filter((entry) => entry.subId === this.bind.subDeviceId)
                .map(cloneScheduleEntry);
        } catch (error) {
            if (isUnsupportedWaterPlan(error)) {
                return undefined;
            }
            throw error;
        }
    }

    /**
     * No-op when the namespace is absent. Entries should carry this trait's `subId`.
     */
    async setSchedule(
        entries: SprinklerScheduleEntry[]
    ): Promise<SprinklerScheduleEntry[] | undefined> {
        if (!this.has(WATER_PLAN_NAMESPACE)) {
            return undefined;
        }
        const payload = entries.map((entry) => ({
            ...cloneScheduleEntry(entry),
            subId: entry.subId || this.bind.subDeviceId
        }));
        await this.bind.request({
            namespace: WATER_PLAN_NAMESPACE,
            method: 'SET',
            payload: encodeWaterPlanSet(payload)
        });
        return payload;
    }

    handlePush(message: MerossMessage): void {
        const ns = message.header.namespace;
        const payload = message.payload;
        const subId = this.bind.subDeviceId;

        if (ns === CONTROL_WATER_NAMESPACE) {
            for (const entry of decodeWaterPush(payload)) {
                if (entry.subId === subId) {
                    this.applyChange(waterPatch(entry));
                }
            }
            return;
        }
        if (ns === CONTROL_WATER_EVENT_NAMESPACE && this.has(ns)) {
            for (const entry of decodeWaterEventPush(payload)) {
                if (entry.subId === subId) {
                    this.applyChange({ lastCycle: cycleSummary(entry) });
                }
            }
            return;
        }
        if (ns === DEVICE_CFG_NAMESPACE && this.has(ns)) {
            for (const entry of decodeDeviceCfgPush(payload)) {
                if (entry.subId === subId && entry.duration !== undefined) {
                    this.applyChange({ duration: entry.duration });
                }
            }
            return;
        }
        if (ns === HUB_BATTERY_NAMESPACE && this.has(ns)) {
            for (const entry of decodeBatteryPush(payload)) {
                if (entry.id === subId && entry.battery !== undefined) {
                    this.applyChange({ battery: entry.battery });
                }
            }
            return;
        }
        if (ns === HUB_EXCEPTION_NAMESPACE && this.has(ns)) {
            for (const entry of decodeHubExceptionPush(payload)) {
                if (entry.id === subId) {
                    this.applyChange({ fault: entry.code });
                }
            }
            return;
        }
        if (ns === HUB_SUBDEVICE_VERSION_NAMESPACE && this.has(ns)) {
            for (const entry of decodeHubSubDeviceVersionPush(payload)) {
                if (entry.id === subId) {
                    const patch: SprinklerValues = {};
                    if (entry.firmware !== undefined) {
                        patch.firmwareVersion = entry.firmware;
                    }
                    if (entry.hardware !== undefined) {
                        patch.hardwareVersion = entry.hardware;
                    }
                    this.applyChange(patch);
                }
            }
        }
    }

    private applyChange(patch: SprinklerValues): void {
        applyPatch(this.last, patch, this.bind.emitChange);
    }

    private has(namespace: string): boolean {
        return this.namespaces.has(namespace);
    }
}

function waterPatch(entry: WaterControlState): SprinklerValues {
    const patch: SprinklerValues = { on: entry.on };
    if (entry.duration !== undefined) {
        patch.duration = entry.duration;
    }
    return patch;
}

function cycleSummary(entry: WaterEventState): SprinklerCycleSummary {
    const summary: SprinklerCycleSummary = {};
    if (entry.duration !== undefined) {
        summary.duration = entry.duration;
    }
    if (entry.waterConsumption !== undefined) {
        summary.waterConsumption = entry.waterConsumption;
    }
    if (entry.timestamp !== undefined) {
        summary.timestamp = entry.timestamp;
    }
    return summary;
}

function cloneScheduleEntry(entry: SprinklerScheduleEntry): SprinklerScheduleEntry {
    return {
        subId: entry.subId,
        channel: entry.channel,
        schedule: { ...entry.schedule }
    };
}

/** Hubs often advertise WaterPlan but reject every GET with firmware error 5000. */
function isUnsupportedWaterPlan(error: unknown): boolean {
    return error instanceof CommandError && error.deviceCode === 5000;
}

export const SprinklerDescriptor: TraitDescriptor & {
    readonly name: 'sprinkler';
    readonly hubChild: HubChildRule;
    attach(args: TraitAttachArgs<SprinklerValues>): SprinklerTrait | undefined;
} = {
    name: 'sprinkler',
    hubChild: SPRINKLER_HUB_CHILD,
    push: [
        CONTROL_WATER_NAMESPACE,
        CONTROL_WATER_EVENT_NAMESPACE,
        DEVICE_CFG_NAMESPACE,
        HUB_BATTERY_NAMESPACE,
        HUB_EXCEPTION_NAMESPACE,
        HUB_SUBDEVICE_VERSION_NAMESPACE
    ],
    poll: {
        [CONTROL_WATER_NAMESPACE]: {
            ...DEFAULT,
            payload: subIdList('control', 'sprinkler')
        },
        [DEVICE_CFG_NAMESPACE]: {
            ...SMART_CONFIG,
            payload: subIdList('config', 'sprinkler')
        }
    } satisfies Record<string, PollSpec>,
    attach(args: TraitAttachArgs<SprinklerValues>): SprinklerTrait | undefined {
        if (!args.graphEndpoint.subDeviceId) {
            return undefined;
        }
        return new SprinklerTrait({
            subDeviceId: args.graphEndpoint.subDeviceId,
            namespaces: args.namespaces,
            request: args.request,
            emitChange: args.emitChange
        });
    }
};
