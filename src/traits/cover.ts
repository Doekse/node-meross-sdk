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
    decodeShutterPositionGetAck,
    decodeShutterPositionPush,
    decodeShutterStatePush,
    encodeGarageConfigGet,
    encodeGarageConfigSet,
    encodeGarageGet,
    encodeGarageMultipleConfigGet,
    encodeGarageMultipleConfigSet,
    encodeGarageSet,
    encodeShutterAdjustSet,
    encodeShutterConfigGet,
    encodeShutterConfigSet,
    encodeShutterPositionGet,
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

    constructor(bind: CoverTraitBind) {
        this.bind = bind;
    }

    /** Mirrors other traits by guarding optional namespace behavior. */
    private has(namespace: string): boolean {
        return this.bind.namespaces?.has(namespace) ?? false;
    }

    /** Polls initial state. Idempotent; Session calls this once and does not await it. */
    start(): void {
        void this.pollInitial();
    }

    /** Last known open/closed. Undefined until initial GET or PUSH fills it. */
    isOpen(): boolean | undefined {
        return this.on;
    }

    /** Last known position in `0..1`. Shutter only. */
    getPosition(): number | undefined {
        return this.position;
    }

    /**
     * Opens the bound channel.
     */
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

    /**
     * Closes the bound channel.
     */
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
     * Stops a moving shutter. No-op for garage; firmware has no stop.
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
     * Sets position in `0..1`. Shutter only; no-op for garage.
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
     * Retrieves the garage door config from the device.
     * Prefers MultipleConfig (MSG200) when advertised, falls back to Config (MSG100).
     * Returns `undefined` when unsupported or when no entry exists for this channel.
     */
    async getConfig(): Promise<GarageMultipleConfigEntry | GarageDoorConfig | undefined> {
        if (this.bind.kind !== 'garage') {
            return undefined;
        }
        if (this.has(GARAGE_MULTIPLE_CONFIG_NAMESPACE)) {
            const reply = await this.bind.request({
                namespace: GARAGE_MULTIPLE_CONFIG_NAMESPACE,
                method: 'GET',
                payload: encodeGarageMultipleConfigGet()
            });
            const entries = decodeGarageMultipleConfigGetAck(reply.payload);
            return entries.find((e) => e.channel === this.bind.channel);
        }
        if (this.has(GARAGE_CONFIG_NAMESPACE)) {
            const reply = await this.bind.request({
                namespace: GARAGE_CONFIG_NAMESPACE,
                method: 'GET',
                payload: encodeGarageConfigGet()
            });
            return decodeGarageConfigGetAck(reply.payload);
        }
        return undefined;
    }

    /**
     * Writes garage door config back to the device.
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
            const entry = config as GarageMultipleConfigEntry;
            await this.bind.request({
                namespace: GARAGE_MULTIPLE_CONFIG_NAMESPACE,
                method: 'SET',
                payload: encodeGarageMultipleConfigSet({
                    ...entry,
                    channel: this.bind.channel
                })
            });
            return;
        }
        if (this.has(GARAGE_CONFIG_NAMESPACE)) {
            await this.bind.request({
                namespace: GARAGE_CONFIG_NAMESPACE,
                method: 'SET',
                payload: encodeGarageConfigSet(config as Partial<GarageDoorConfig>)
            });
        }
    }

    /**
     * Reads the travel-time and direction config for the bound shutter channel.
     * Returns `undefined` when the namespace is not advertised or the kind is garage.
     */
    async getShutterConfig(): Promise<ShutterConfig | undefined> {
        if (this.bind.kind !== 'shutter' || !this.has(SHUTTER_CONFIG_NAMESPACE)) {
            return undefined;
        }
        const reply = await this.bind.request({
            namespace: SHUTTER_CONFIG_NAMESPACE,
            method: 'GET',
            payload: encodeShutterConfigGet()
        });
        const entries = decodeShutterConfigGetAck(reply.payload);
        return entries.find((e) => e.channel === this.bind.channel);
    }

    /**
     * Writes travel times and optional direction to the device.
     * No-op on garages or when RollerShutter.Config is not advertised.
     */
    async setTravelTimes(options: Omit<ShutterConfigSetOptions, 'channel'>): Promise<void> {
        if (this.bind.kind !== 'shutter' || !this.has(SHUTTER_CONFIG_NAMESPACE)) {
            return;
        }
        await this.bind.request({
            namespace: SHUTTER_CONFIG_NAMESPACE,
            method: 'SET',
            payload: encodeShutterConfigSet({ ...options, channel: this.bind.channel })
        });
    }

    /**
     * Sends a calibration command to the device.
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

    /**
     * Applies a firmware PUSH for this endpoint.
     */
    handlePush(message: MerossMessage): void {
        const uuid = message.header.uuid
            ?? /^\/appliance\/([^/]+)\//.exec(message.header.from)?.[1];
        if (!uuid || uuid !== this.bind.uuid) {
            return;
        }

        if (this.bind.kind === 'garage') {
            if (message.header.namespace === GARAGE_STATE_NAMESPACE) {
                for (const entry of decodeGaragePush(message.payload)) {
                    if (entry.channel === this.bind.channel) {
                        this.applyGarage(entry.open);
                        if (this.moving === true) {
                            this.applyMoving(false);
                        }
                    }
                }
            }
            return;
        }

        if (this.bind.kind !== 'shutter') {
            return;
        }
        if (message.header.namespace === SHUTTER_POSITION_NAMESPACE) {
            for (const entry of decodeShutterPositionPush(message.payload)) {
                if (entry.channel === this.bind.channel) {
                    this.applyShutter(entry.position);
                }
            }
            return;
        }
        if (message.header.namespace === SHUTTER_STATE_NAMESPACE) {
            for (const entry of decodeShutterStatePush(message.payload)) {
                if (entry.channel === this.bind.channel) {
                    this.applyMoving(entry.state !== 0);
                }
            }
            return;
        }
    }

    private async pollInitial(): Promise<void> {
        try {
            if (this.bind.kind === 'garage') {
                const reply = await this.bind.request({
                    namespace: GARAGE_STATE_NAMESPACE,
                    method: 'GET',
                    payload: encodeGarageGet({ channel: this.bind.channel })
                });
                for (const entry of decodeGarageGetAck(reply.payload)) {
                    if (entry.channel === this.bind.channel) {
                        this.applyGarage(entry.open);
                    }
                }
                return;
            }
            const reply = await this.bind.request({
                namespace: SHUTTER_POSITION_NAMESPACE,
                method: 'GET',
                payload: encodeShutterPositionGet()
            });
            for (const entry of decodeShutterPositionGetAck(reply.payload)) {
                if (entry.channel === this.bind.channel) {
                    this.applyShutter(entry.position);
                }
            }
        } catch {
            // Next PUSH or setter call will recover.
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
