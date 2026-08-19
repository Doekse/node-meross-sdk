import {
    CONTROL_WATER_NAMESPACE,
    DEVICE_CFG_NAMESPACE,
    HUB_BATTERY_NAMESPACE,
    decodeBatteryGetAck,
    decodeBatteryPush,
    decodeDeviceCfgGetAck,
    decodeDeviceCfgPush,
    decodeWaterGetAck,
    decodeWaterPush,
    encodeBatteryGet,
    encodeDeviceCfgGet,
    encodeDeviceCfgSet,
    encodeWaterGet,
    encodeWaterSet,
    type MerossMessage,
    type WaterControlState
} from '../protocol';
import type { RoutedRequestOptions } from '../transport/router';

export interface SprinklerValues {
    on?: boolean;
    /** Watering duration in seconds. */
    duration?: number;
    battery?: number;
}

/**
 * Transport + sub-device bind for a hub sprinkler child. Session supplies this;
 * trait tests inject a fake request/emit pair.
 */
export interface SprinklerTraitBind {
    uuid: string;
    subDeviceId: string;
    /** Ability keys; DeviceCfg and Battery no-op when absent. */
    namespaces?: ReadonlySet<string>;
    request: (options: Omit<RoutedRequestOptions, 'uuid' | 'ip' | 'encryptionKey'>) => Promise<MerossMessage>;
    emitChange: (values: SprinklerValues) => void;
}

/**
 * Hub child sprinkler (MST100). On/off uses Control.Water onoff 1/2; default
 * duration lives in DeviceCfg mstCfg.dura.
 */
export class SprinklerTrait {
    private readonly bind: SprinklerTraitBind;
    private readonly namespaces: ReadonlySet<string>;
    private last: SprinklerValues = {};

    constructor(bind: SprinklerTraitBind) {
        this.bind = bind;
        this.namespaces = bind.namespaces ?? new Set();
    }

    /** Fetches initial state. Idempotent; Session calls this once and does not await it. */
    start(): void {
        void this.pollInitial();
    }

    /** Last known on/off. Undefined until initial GET or PUSH fills it. */
    isOn(): boolean | undefined {
        return this.last.on;
    }

    /** Last known default watering duration in seconds. */
    getDuration(): number | undefined {
        return this.last.duration;
    }

    /**
     * Turns watering on or off via Control.Water. Never uses Hub.ToggleX.
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
     * Sets the default watering duration in seconds via DeviceCfg mstCfg.dura.
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
     * Applies a firmware PUSH for this endpoint.
     */
    handlePush(message: MerossMessage): void {
        const uuid = message.header.uuid
            ?? /^\/appliance\/([^/]+)\//.exec(message.header.from)?.[1];
        if (!uuid || uuid !== this.bind.uuid) {
            return;
        }
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
        }
    }

    private applyChange(patch: SprinklerValues): void {
        const next: SprinklerValues = {};
        for (const key of Object.keys(patch) as Array<keyof SprinklerValues>) {
            const value = patch[key];
            if (value === undefined || this.last[key] === value) {
                continue;
            }
            (this.last as Record<string, unknown>)[key] = value;
            (next as Record<string, unknown>)[key] = value;
        }
        if (Object.keys(next).length > 0) {
            this.bind.emitChange(next);
        }
    }

    private has(namespace: string): boolean {
        return this.namespaces.has(namespace);
    }

    private async pollInitial(): Promise<void> {
        try {
            await this.pollHub();
        } catch {
            // Next PUSH or setter call will recover.
        }
    }

    private async pollHub(): Promise<void> {
        const subId = this.bind.subDeviceId;
        const waterAck = await this.bind.request({
            namespace: CONTROL_WATER_NAMESPACE,
            method: 'GET',
            payload: encodeWaterGet({ subId })
        });
        const water = decodeWaterGetAck(waterAck.payload).find((entry) => entry.subId === subId);
        if (water) {
            this.applyChange(waterPatch(water));
        }

        if (this.has(DEVICE_CFG_NAMESPACE)) {
            const cfgAck = await this.bind.request({
                namespace: DEVICE_CFG_NAMESPACE,
                method: 'GET',
                payload: encodeDeviceCfgGet({ subId })
            });
            const cfg = decodeDeviceCfgGetAck(cfgAck.payload).find((entry) => entry.subId === subId);
            if (cfg?.duration !== undefined) {
                this.applyChange({ duration: cfg.duration });
            }
        }

        if (this.has(HUB_BATTERY_NAMESPACE)) {
            const batteryAck = await this.bind.request({
                namespace: HUB_BATTERY_NAMESPACE,
                method: 'GET',
                payload: encodeBatteryGet(subId)
            });
            const battery = decodeBatteryGetAck(batteryAck.payload).find((entry) => entry.id === subId);
            if (battery?.battery !== undefined) {
                this.applyChange({ battery: battery.battery });
            }
        }
    }
}

function waterPatch(entry: WaterControlState): SprinklerValues {
    const patch: SprinklerValues = { on: entry.on };
    if (entry.duration !== undefined) {
        patch.duration = entry.duration;
    }
    return patch;
}
