import {
    GARAGE_CONFIG_NAMESPACE,
    GARAGE_MULTIPLE_CONFIG_NAMESPACE,
    GARAGE_STATE_NAMESPACE,
    SHUTTER_ADJUST_NAMESPACE,
    SHUTTER_CONFIG_NAMESPACE,
    SHUTTER_POSITION_NAMESPACE,
    SHUTTER_STATE_NAMESPACE,
    decodeGarageConfigGetAck,
    decodeGarageGetAck,
    decodeGarageMultipleConfigGetAck,
    decodeGaragePush,
    decodeShutterConfigGetAck,
    decodeShutterPositionPush,
    decodeShutterStatePush,
    encodeGarageConfigSet,
    encodeGarageMultipleConfigSet,
    encodeGarageSet,
    encodeShutterAdjustSet,
    encodeShutterConfigSet,
    encodeShutterPositionSet,
    type MerossMessage
} from '../protocol';
import type {
    GarageDoorConfig,
    GarageMultipleConfigEntry,
    ShutterAdjustValue,
    ShutterConfig,
    ShutterConfigSetOptions
} from '../protocol';
import type { RoutedRequestOptions } from '../transport/router';

export interface CoverValues {
    open?: boolean;
    position?: number;
    moving?: boolean;
}

/**
 * Transport + channel bind for one cover endpoint. Session supplies this;
 * trait tests inject a fake request/emit pair.
 */
export interface CoverTraitBind {
    uuid: string;
    channel: number;
    /** Garage vs shutter namespaces stay in codecs; the host API is the same. */
    kind: 'garage' | 'shutter';
    /**
     * Ability namespace keys advertised by the device.
     * Optional garage config methods use this to no-op when unsupported.
     */
    namespaces?: ReadonlySet<string>;
    request: (options: Omit<RoutedRequestOptions, 'uuid' | 'ip' | 'encryptionKey'>) => Promise<MerossMessage>;
    emitChange: (values: CoverValues) => void;
}

/**
 * Open/close/position for one enrolled cover. Kind is bound at enrollment.
 */
export class CoverTrait {
    private readonly bind: CoverTraitBind;
    private on: boolean | undefined;
    private position: number | undefined;
    private moving: boolean | undefined;
    private lastGarageConfig: GarageDoorConfig | undefined;
    private lastMultipleConfig: GarageMultipleConfigEntry | undefined;
    private lastShutterConfig: ShutterConfig | undefined;

    constructor(bind: CoverTraitBind) {
        this.bind = bind;
    }

    private has(namespace: string): boolean {
        return this.bind.namespaces?.has(namespace) ?? false;
    }

    /** Undefined until poller GETACK or PUSH fills it. */
    isOpen(): boolean | undefined {
        return this.on;
    }

    /** Shutter only. Undefined for garage or until GETACK/PUSH fills it. */
    getPosition(): number | undefined {
        return this.position;
    }

    async open(): Promise<{ open: boolean }> {
        if (this.bind.kind === 'garage') {
            return { open: await this.setGarage(true) };
        }
        await this.bind.request({
            namespace: SHUTTER_POSITION_NAMESPACE,
            method: 'SET',
            payload: encodeShutterPositionSet({ channel: this.bind.channel, position: 100 })
        });
        this.applyShutter(100);
        return { open: true };
    }

    async close(): Promise<{ open: boolean }> {
        if (this.bind.kind === 'garage') {
            return { open: await this.setGarage(false) };
        }
        await this.bind.request({
            namespace: SHUTTER_POSITION_NAMESPACE,
            method: 'SET',
            payload: encodeShutterPositionSet({ channel: this.bind.channel, position: 0 })
        });
        this.applyShutter(0);
        return { open: false };
    }

    /**
     * No-op for garage; firmware has no stop.
     */
    async stop(): Promise<void> {
        if (this.bind.kind === 'garage') {
            return;
        }
        await this.bind.request({
            namespace: SHUTTER_POSITION_NAMESPACE,
            method: 'SET',
            payload: encodeShutterPositionSet({ channel: this.bind.channel, position: -1 })
        });
    }

    /**
     * Host range is `0..1`. No-op for garage.
     */
    async setPosition(position: number): Promise<{ position: number }> {
        if (this.bind.kind === 'garage') {
            return { position };
        }
        const clamped = Number.isFinite(position) ? Math.min(1, Math.max(0, position)) : 0;
        const wire = Math.round(clamped * 100);
        await this.bind.request({
            namespace: SHUTTER_POSITION_NAMESPACE,
            method: 'SET',
            payload: encodeShutterPositionSet({ channel: this.bind.channel, position: wire })
        });
        this.applyShutter(wire);
        return { position: this.position ?? clamped };
    }

    /**
     * Undefined until poller GETACK or PUSH fills it.
     * Prefers MultipleConfig when both namespaces are advertised.
     */
    getConfig(): GarageMultipleConfigEntry | GarageDoorConfig | undefined {
        if (this.bind.kind !== 'garage') {
            return undefined;
        }
        if (this.has(GARAGE_MULTIPLE_CONFIG_NAMESPACE)) {
            return this.lastMultipleConfig && { ...this.lastMultipleConfig };
        }
        if (this.has(GARAGE_CONFIG_NAMESPACE)) {
            return this.lastGarageConfig && { ...this.lastGarageConfig };
        }
        return undefined;
    }

    /**
     * Uses MultipleConfig (MSG200) when advertised, else Config (MSG100).
     * No-op on shutters or when neither namespace is available.
     */
    async setConfig(
        config: Partial<GarageDoorConfig> | GarageMultipleConfigEntry
    ): Promise<void> {
        if (this.bind.kind !== 'garage') {
            return;
        }
        if (this.has(GARAGE_MULTIPLE_CONFIG_NAMESPACE)) {
            const entry = {
                ...(config as GarageMultipleConfigEntry),
                channel: this.bind.channel
            };
            await this.bind.request({
                namespace: GARAGE_MULTIPLE_CONFIG_NAMESPACE,
                method: 'SET',
                payload: encodeGarageMultipleConfigSet(entry)
            });
            this.lastMultipleConfig = { ...this.lastMultipleConfig, ...entry };
            return;
        }
        if (this.has(GARAGE_CONFIG_NAMESPACE)) {
            const patch = config as Partial<GarageDoorConfig>;
            await this.bind.request({
                namespace: GARAGE_CONFIG_NAMESPACE,
                method: 'SET',
                payload: encodeGarageConfigSet(patch)
            });
            if (this.lastGarageConfig !== undefined) {
                this.lastGarageConfig = { ...this.lastGarageConfig, ...patch };
            }
        }
    }

    /**
     * Undefined until poller GETACK or PUSH fills it, or when the kind is garage.
     */
    getShutterConfig(): ShutterConfig | undefined {
        if (this.bind.kind !== 'shutter' || !this.has(SHUTTER_CONFIG_NAMESPACE)) {
            return undefined;
        }
        return this.lastShutterConfig && { ...this.lastShutterConfig };
    }

    /**
     * No-op on garages or when RollerShutter.Config is not advertised.
     */
    async setTravelTimes(options: Omit<ShutterConfigSetOptions, 'channel'>): Promise<void> {
        if (this.bind.kind !== 'shutter' || !this.has(SHUTTER_CONFIG_NAMESPACE)) {
            return;
        }
        const next = { ...options, channel: this.bind.channel };
        await this.bind.request({
            namespace: SHUTTER_CONFIG_NAMESPACE,
            method: 'SET',
            payload: encodeShutterConfigSet(next)
        });
        this.lastShutterConfig = { ...this.lastShutterConfig, ...next };
    }

    /**
     * No-op on garages or when RollerShutter.Adjust is not advertised.
     *
     * Stage semantics follow the firmware:
     * - `stop` — abort calibration (value 0)
     * - `auto` — start automatic calibration (value 1)
     * - `manualClosed` — start stage 1: move to fully closed (value 2)
     * - `manualClosedStop` — stop stage 1, begin stage 2: move to fully open (value 3)
     * - `manualOpenStop` — stop stage 2 (value 4)
     */
    async calibrate(
        stage: 'stop' | 'auto' | 'manualClosed' | 'manualClosedStop' | 'manualOpenStop'
    ): Promise<void> {
        if (this.bind.kind !== 'shutter' || !this.has(SHUTTER_ADJUST_NAMESPACE)) {
            return;
        }
        const valueMap: Record<typeof stage, ShutterAdjustValue> = {
            stop: 0,
            auto: 1,
            manualClosed: 2,
            manualClosedStop: 3,
            manualOpenStop: 4
        };
        await this.bind.request({
            namespace: SHUTTER_ADJUST_NAMESPACE,
            method: 'SET',
            payload: encodeShutterAdjustSet(this.bind.channel, valueMap[stage])
        });
    }

    handlePush(message: MerossMessage): void {
        const uuid = message.header.uuid
            ?? /^\/appliance\/([^/]+)\//.exec(message.header.from)?.[1];
        if (!uuid || uuid !== this.bind.uuid) {
            return;
        }

        const ns = message.header.namespace;
        if (this.bind.kind === 'garage') {
            if (ns === GARAGE_STATE_NAMESPACE) {
                for (const entry of decodeGaragePush(message.payload)) {
                    if (entry.channel === this.bind.channel) {
                        this.applyGarage(entry.open);
                        if (this.moving === true) {
                            this.applyMoving(false);
                        }
                    }
                }
                return;
            }
            if (ns === GARAGE_MULTIPLE_CONFIG_NAMESPACE && this.has(ns)) {
                const entry = decodeGarageMultipleConfigGetAck(message.payload)
                    .find((e) => e.channel === this.bind.channel);
                if (entry) {
                    this.lastMultipleConfig = entry;
                }
                return;
            }
            if (ns === GARAGE_CONFIG_NAMESPACE && this.has(ns)) {
                this.lastGarageConfig = decodeGarageConfigGetAck(message.payload);
            }
            return;
        }

        if (this.bind.kind !== 'shutter') {
            return;
        }
        if (ns === SHUTTER_POSITION_NAMESPACE) {
            for (const entry of decodeShutterPositionPush(message.payload)) {
                if (entry.channel === this.bind.channel) {
                    this.applyShutter(entry.position);
                }
            }
            return;
        }
        if (ns === SHUTTER_STATE_NAMESPACE) {
            for (const entry of decodeShutterStatePush(message.payload)) {
                if (entry.channel === this.bind.channel) {
                    this.applyMoving(entry.state !== 0);
                }
            }
            return;
        }
        if (ns === SHUTTER_CONFIG_NAMESPACE && this.has(ns)) {
            const entry = decodeShutterConfigGetAck(message.payload)
                .find((e) => e.channel === this.bind.channel);
            if (entry) {
                this.lastShutterConfig = entry;
            }
        }
    }

    /**
     * SETACK `open` is the current state, not the command. `execute` 1 with
     * a different `open` means the door is still travelling.
     */
    private async setGarage(open: boolean): Promise<boolean> {
        const reply = await this.bind.request({
            namespace: GARAGE_STATE_NAMESPACE,
            method: 'SET',
            payload: encodeGarageSet({ channel: this.bind.channel, open })
        });
        for (const entry of decodeGarageGetAck(reply.payload)) {
            if (entry.channel !== this.bind.channel) {
                continue;
            }
            this.applyGarage(entry.open);
            const moving = entry.execute === true && entry.open !== open;
            if (moving || this.moving === true) {
                this.applyMoving(moving);
            }
        }
        return this.on ?? open;
    }

    private applyGarage(open: boolean): void {
        if (this.on === open) {
            return;
        }
        this.on = open;
        this.bind.emitChange({ open });
    }

    private applyShutter(wirePosition: number): void {
        if (wirePosition === -1) {
            return;
        }
        const patch: CoverValues = {};
        const hostPosition = wirePosition / 100;
        const open = wirePosition === 100;
        if (this.position !== hostPosition) {
            this.position = hostPosition;
            patch.position = hostPosition;
        }
        if (this.on !== open) {
            this.on = open;
            patch.open = open;
        }
        if (Object.keys(patch).length > 0) {
            this.bind.emitChange(patch);
        }
    }

    private applyMoving(moving: boolean): void {
        if (this.moving === moving) {
            return;
        }
        this.moving = moving;
        this.bind.emitChange({ moving });
    }
}
