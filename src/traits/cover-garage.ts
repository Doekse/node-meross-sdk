import type { CoverTraitBind } from '../device/bindings';
import {
    GARAGE_CONFIG_NAMESPACE,
    GARAGE_MULTIPLE_CONFIG_NAMESPACE,
    GARAGE_STATE_NAMESPACE,
    decodeGarageConfigGetAck,
    decodeGarageGetAck,
    decodeGarageMultipleConfigGetAck,
    decodeGaragePush,
    encodeGarageConfigSet,
    encodeGarageMultipleConfigSet,
    encodeGarageSet,
    type GarageDoorConfig,
    type GarageMultipleConfigEntry
} from '../protocol/codecs/cover';
import type { MerossMessage } from '../protocol/message';
import { CoverTraitBase } from './cover-core';

/**
 * GarageDoor.State. Firmware has no stop or position.
 */
export class CoverGarageTrait extends CoverTraitBase {
    readonly kind = 'garage' as const;

    private lastGarageConfig: GarageDoorConfig | undefined;
    private lastMultipleConfig: GarageMultipleConfigEntry | undefined;

    /** @internal */
    constructor(bind: CoverTraitBind) {
        super(bind);
    }

    async open(): Promise<{ open: boolean }> {
        return { open: await this.setGarage(true) };
    }

    async close(): Promise<{ open: boolean }> {
        return { open: await this.setGarage(false) };
    }

    /**
     * Undefined until poller GETACK or PUSH fills it.
     * Prefers MultipleConfig when both namespaces are advertised.
     */
    getConfig(): GarageMultipleConfigEntry | GarageDoorConfig | undefined {
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
     */
    async setConfig(
        config: Partial<GarageDoorConfig> | GarageMultipleConfigEntry
    ): Promise<void> {
        if (this.has(GARAGE_MULTIPLE_CONFIG_NAMESPACE)) {
            const entry = {
                ...(config as GarageMultipleConfigEntry),
                channel: this.channel
            };
            await this.request({
                namespace: GARAGE_MULTIPLE_CONFIG_NAMESPACE,
                method: 'SET',
                payload: encodeGarageMultipleConfigSet(entry)
            });
            this.lastMultipleConfig = { ...this.lastMultipleConfig, ...entry };
            return;
        }
        this.requireNamespace(GARAGE_CONFIG_NAMESPACE);
        const patch = config as Partial<GarageDoorConfig>;
        await this.request({
            namespace: GARAGE_CONFIG_NAMESPACE,
            method: 'SET',
            payload: encodeGarageConfigSet(patch)
        });
        if (this.lastGarageConfig !== undefined) {
            this.lastGarageConfig = { ...this.lastGarageConfig, ...patch };
        }
    }

    /**
     * PUSH/GETACK from Runtime. Hosts subscribe to Endpoint `change`.
     *
     * @internal
     * @package
     */
    handlePush(message: MerossMessage): void {
        const ns = message.header.namespace;
        if (ns === GARAGE_STATE_NAMESPACE) {
            for (const entry of decodeGaragePush(message.payload)) {
                if (entry.channel === this.channel) {
                    this.applyChange({ open: entry.open });
                    if (this.last.moving === true) {
                        this.applyMoving(false);
                    }
                }
            }
            return;
        }
        if (ns === GARAGE_MULTIPLE_CONFIG_NAMESPACE && this.has(ns)) {
            const entry = decodeGarageMultipleConfigGetAck(message.payload)
                .find((e) => e.channel === this.channel);
            if (entry) {
                this.lastMultipleConfig = entry;
            }
            return;
        }
        if (ns === GARAGE_CONFIG_NAMESPACE && this.has(ns)) {
            this.lastGarageConfig = decodeGarageConfigGetAck(message.payload);
        }
    }

    /**
     * SETACK `open` is the current state, not the command. `execute` 1 with
     * a different `open` means the door is still travelling.
     */
    private async setGarage(open: boolean): Promise<boolean> {
        const reply = await this.request({
            namespace: GARAGE_STATE_NAMESPACE,
            method: 'SET',
            payload: encodeGarageSet({ channel: this.channel, open })
        });
        for (const entry of decodeGarageGetAck(reply.payload)) {
            if (entry.channel !== this.channel) {
                continue;
            }
            this.applyChange({ open: entry.open });
            const moving = entry.execute === true && entry.open !== open;
            if (moving || this.last.moving === true) {
                this.applyMoving(moving);
            }
        }
        return this.last.open ?? open;
    }
}
