import {
    SHUTTER_ADJUST_NAMESPACE,
    SHUTTER_CONFIG_NAMESPACE,
    SHUTTER_POSITION_NAMESPACE,
    SHUTTER_STATE_NAMESPACE,
    decodeShutterConfigGetAck,
    decodeShutterPositionPush,
    decodeShutterStatePush,
    encodeShutterAdjustSet,
    encodeShutterConfigSet,
    encodeShutterPositionSet,
    type ShutterAdjustValue,
    type ShutterConfig,
    type ShutterConfigSetOptions
} from '../protocol/codecs/cover';
import type { MerossMessage } from '../protocol/message';
import { CoverTraitBase, type CoverTraitBind } from './cover-core';

/**
 * RollerShutter position. `0` is closed and `1` is open on the host scale.
 */
export class CoverShutterTrait extends CoverTraitBase {
    readonly kind = 'shutter' as const;

    private lastShutterConfig: ShutterConfig | undefined;

    /** @internal */
    constructor(bind: CoverTraitBind) {
        super(bind);
    }

    /** Undefined until GETACK or PUSH fills it. */
    getPosition(): number | undefined {
        return this.last.position;
    }

    async open(): Promise<{ open: boolean }> {
        await this.request({
            namespace: SHUTTER_POSITION_NAMESPACE,
            method: 'SET',
            payload: encodeShutterPositionSet({ channel: this.channel, position: 100 })
        });
        this.applyShutter(100);
        return { open: true };
    }

    async close(): Promise<{ open: boolean }> {
        await this.request({
            namespace: SHUTTER_POSITION_NAMESPACE,
            method: 'SET',
            payload: encodeShutterPositionSet({ channel: this.channel, position: 0 })
        });
        this.applyShutter(0);
        return { open: false };
    }

    /** Firmware stop is position `-1`. */
    async stop(): Promise<void> {
        await this.request({
            namespace: SHUTTER_POSITION_NAMESPACE,
            method: 'SET',
            payload: encodeShutterPositionSet({ channel: this.channel, position: -1 })
        });
    }

    /**
     * Host range is `0..1`.
     */
    async setPosition(position: number): Promise<{ position: number }> {
        const clamped = Number.isFinite(position) ? Math.min(1, Math.max(0, position)) : 0;
        const wire = Math.round(clamped * 100);
        await this.request({
            namespace: SHUTTER_POSITION_NAMESPACE,
            method: 'SET',
            payload: encodeShutterPositionSet({ channel: this.channel, position: wire })
        });
        this.applyShutter(wire);
        return { position: this.last.position ?? clamped };
    }

    /**
     * Undefined until poller GETACK or PUSH fills it, or when Config is not advertised.
     */
    getShutterConfig(): ShutterConfig | undefined {
        if (!this.has(SHUTTER_CONFIG_NAMESPACE)) {
            return undefined;
        }
        return this.lastShutterConfig && { ...this.lastShutterConfig };
    }

    async setTravelTimes(options: Omit<ShutterConfigSetOptions, 'channel'>): Promise<void> {
        this.requireNamespace(SHUTTER_CONFIG_NAMESPACE);
        const next = { ...options, channel: this.channel };
        await this.request({
            namespace: SHUTTER_CONFIG_NAMESPACE,
            method: 'SET',
            payload: encodeShutterConfigSet(next)
        });
        this.lastShutterConfig = { ...this.lastShutterConfig, ...next };
    }

    /**
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
        this.requireNamespace(SHUTTER_ADJUST_NAMESPACE);
        const valueMap: Record<typeof stage, ShutterAdjustValue> = {
            stop: 0,
            auto: 1,
            manualClosed: 2,
            manualClosedStop: 3,
            manualOpenStop: 4
        };
        await this.request({
            namespace: SHUTTER_ADJUST_NAMESPACE,
            method: 'SET',
            payload: encodeShutterAdjustSet(this.channel, valueMap[stage])
        });
    }

    /**
     * PUSH/GETACK from DeviceRuntime. Hosts subscribe to Endpoint `change`.
     *
     * @internal
     * @package
     */
    handlePush(message: MerossMessage): void {
        const ns = message.header.namespace;
        if (ns === SHUTTER_POSITION_NAMESPACE) {
            for (const entry of decodeShutterPositionPush(message.payload)) {
                if (entry.channel === this.channel) {
                    this.applyShutter(entry.position);
                }
            }
            return;
        }
        if (ns === SHUTTER_STATE_NAMESPACE) {
            for (const entry of decodeShutterStatePush(message.payload)) {
                if (entry.channel === this.channel) {
                    this.applyMoving(entry.state !== 0);
                }
            }
            return;
        }
        if (ns === SHUTTER_CONFIG_NAMESPACE && this.has(ns)) {
            const entry = decodeShutterConfigGetAck(message.payload)
                .find((e) => e.channel === this.channel);
            if (entry) {
                this.lastShutterConfig = entry;
            }
        }
    }

    /** Wire `-1` is stop and does not change the cached position. */
    private applyShutter(wirePosition: number): void {
        if (wirePosition === -1) {
            return;
        }
        const position = wirePosition / 100;
        const open = wirePosition === 100;
        this.applyChange({ position, open });
    }
}
