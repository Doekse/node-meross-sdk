import type { EnrollBoardContext, TraitAttachArgs } from '../device/enroll-context';
import {
    GARAGE_CONFIG_NAMESPACE,
    GARAGE_MULTIPLE_CONFIG_NAMESPACE,
    GARAGE_STATE_NAMESPACE,
    SHUTTER_ADJUST_NAMESPACE,
    SHUTTER_CONFIG_NAMESPACE,
    SHUTTER_POSITION_NAMESPACE,
    SHUTTER_STATE_NAMESPACE,
    TOGGLEX_ALL_CHANNELS,
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
import {
    channelList,
    DEFAULT,
    SMART_CONFIG,
    type PollSpec
} from '../poll/spec';
import type { DeviceRequest } from '../request';
import { applyPatch } from './patch';
import type { TraitDescriptor } from './descriptor';

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
    channel: number;
    /** Garage vs shutter namespaces stay in codecs; the host API is the same. */
    kind: 'garage' | 'shutter';
    /**
     * Ability namespace keys advertised by the device.
     * Optional garage config methods use this to no-op when unsupported.
     */
    namespaces?: ReadonlySet<string>;
    /** System.All digest `open` so hosts can read open/closed before the first PUSH. */
    initialOpen?: boolean;
    request: DeviceRequest;
    emitChange: (values: CoverValues) => void;
}

/**
 * Open/close/position for one enrolled cover. Kind is bound at enrollment.
 */
export class CoverTrait {
    private readonly bind: CoverTraitBind;
    private last: CoverValues = {};
    private lastGarageConfig: GarageDoorConfig | undefined;
    private lastMultipleConfig: GarageMultipleConfigEntry | undefined;
    private lastShutterConfig: ShutterConfig | undefined;

    constructor(bind: CoverTraitBind) {
        this.bind = bind;
        if (bind.initialOpen !== undefined) {
            this.last.open = bind.initialOpen;
        }
    }

    private has(namespace: string): boolean {
        return this.bind.namespaces?.has(namespace) ?? false;
    }

    /** Undefined until digest, SET, or PUSH fills it. */
    isOpen(): boolean | undefined {
        return this.last.open;
    }

    /** Shutter only. Undefined for garage or until GETACK/PUSH fills it. */
    getPosition(): number | undefined {
        return this.last.position;
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
        return { position: this.last.position ?? clamped };
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

        const ns = message.header.namespace;
        if (this.bind.kind === 'garage') {
            if (ns === GARAGE_STATE_NAMESPACE) {
                for (const entry of decodeGaragePush(message.payload)) {
                    if (entry.channel === this.bind.channel) {
                        this.applyGarage(entry.open);
                        if (this.last.moving === true) {
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
            if (moving || this.last.moving === true) {
                this.applyMoving(moving);
            }
        }
        return this.last.open ?? open;
    }

    private applyGarage(open: boolean): void {
        this.applyChange({ open });
    }

    private applyShutter(wirePosition: number): void {
        if (wirePosition === -1) {
            return;
        }
        const position = wirePosition / 100;
        const open = wirePosition === 100;
        this.applyChange({ position, open });
    }

    private applyMoving(moving: boolean): void {
        this.applyChange({ moving });
    }

    private applyChange(patch: CoverValues): void {
        applyPatch(this.last, patch, this.bind.emitChange);
    }
}

/**
 * Garage digest wins so unwired doors can be claimed without an endpoint
 * (ToggleX leftover would otherwise re-add them as sockets). Shutter digest
 * and Ability fallback only run when there is no garage digest.
 */
export function enrollCover(ctx: EnrollBoardContext): void {
    if (ctx.all.digest.garageDoor.length > 0) {
        // Seed open/closed from the digest so hosts have state before the first
        // PUSH or poll; on cloud MQTT that poll can be ~20 minutes away.
        // Channels the installer never wired report doorEnable 0 and are not
        // user-visible devices, so they are skipped (MSG200 ships three doors).
        for (const door of ctx.all.digest.garageDoor) {
            if (door.doorEnable === false) {
                // Claim the channel without creating an endpoint, so the
                // ToggleX leftover pass does not re-add the disabled door as a
                // plain socket.
                ctx.taken.add(door.channel);
                continue;
            }
            ctx.add(door.channel, 'cover', ['cover'], door.open);
        }
        return;
    }
    if (ctx.all.digest.rollerShutter.length > 0) {
        for (const channel of ctx.all.digest.rollerShutter) {
            ctx.add(channel, 'cover', ['cover']);
        }
        return;
    }
    if (GARAGE_STATE_NAMESPACE in ctx.ability || SHUTTER_STATE_NAMESPACE in ctx.ability) {
        ctx.add(0, 'cover', ['cover']);
    }
}

export const CoverDescriptor: TraitDescriptor & {
    readonly name: 'cover';
    attach(args: TraitAttachArgs<CoverValues>): CoverTrait;
} = {
    name: 'cover',
    poll: {
        [GARAGE_STATE_NAMESPACE]: {
            ...DEFAULT,
            payload: { dict: 'state', channel: TOGGLEX_ALL_CHANNELS }
        },
        [GARAGE_CONFIG_NAMESPACE]: { ...SMART_CONFIG, base: 410 },
        [GARAGE_MULTIPLE_CONFIG_NAMESPACE]: { ...SMART_CONFIG, item: 140 },
        [SHUTTER_POSITION_NAMESPACE]: { ...DEFAULT, item: 50 },
        [SHUTTER_STATE_NAMESPACE]: { ...DEFAULT, item: 40 },
        [SHUTTER_CONFIG_NAMESPACE]: { ...SMART_CONFIG, item: 70 },
        [SHUTTER_ADJUST_NAMESPACE]: {
            ...SMART_CONFIG,
            payload: channelList('adjust', 'cover'),
            item: 35
        }
    } satisfies Record<string, PollSpec>,
    attach(args: TraitAttachArgs<CoverValues>): CoverTrait {
        // Position/Config can exist without a shutter; State is the discriminator.
        const kind: 'garage' | 'shutter' = SHUTTER_STATE_NAMESPACE in args.physical.ability
            ? 'shutter'
            : 'garage';
        return new CoverTrait({
            channel: args.channel,
            kind,
            namespaces: args.namespaces,
            initialOpen: args.graphEndpoint.on,
            request: args.request,
            emitChange: args.emitChange
        });
    }
};
