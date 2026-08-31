import {
    FAN_BTN_CONFIG_NAMESPACE,
    FAN_CONFIG_NAMESPACE,
    FAN_NAMESPACE,
    FILTER_MAINTENANCE_NAMESPACE,
    TOGGLEX_NAMESPACE,
    decodeFanBtnConfigPush,
    decodeFanConfigGetAck,
    decodeFanPush,
    decodeFilterMaintenancePush,
    decodeToggleXPush,
    encodeFanBtnConfigPushQuery,
    encodeFanBtnConfigSet,
    encodeFanSet,
    encodeToggleXSet,
    type FanButtonConfig,
    type FanButtonConfigSetOptions,
    type MerossMessage
} from '../protocol';
import type { RoutedRequestOptions } from '../transport/router';

export interface FanValues {
    on?: boolean;
    /** Speed as 0..1 of advertised maxSpeed. */
    speed?: number;
    maxSpeed?: number;
    /** Remaining filter life as 0..1 from FilterMaintenance. */
    filterLife?: number;
}

export type { FanButtonConfig, FanButtonConfigSetOptions };

/**
 * Transport + channel bind for one Control.Fan endpoint. Session supplies this;
 * trait tests inject a fake request/emit pair.
 */
export interface FanTraitBind {
    uuid: string;
    channel: number;
    /** Ability keys; extras no-op when the namespace is absent. */
    namespaces?: ReadonlySet<string>;
    /** ToggleX when advertised; classic Toggle only when ToggleX is absent. */
    hasToggleX: boolean;
    hasToggle: boolean;
    request: (options: Omit<RoutedRequestOptions, 'uuid' | 'ip' | 'encryptionKey'>) => Promise<MerossMessage>;
    emitChange: (values: FanValues) => void;
}

/**
 * Fan speed and power for one enrolled channel. Power routes through
 * ToggleX/Toggle when the device has it; Control.Fan handles the rest. Speed is
 * host 0..1; wire is 0..maxSpeed from the last GETACK. Optional Fan.Config,
 * Fan.BtnConfig, and FilterMaintenance attach when Ability advertises them.
 * FilterMaintenance is PUSH-query only (GET disconnects MAP100). DevicePoller
 * issues that PUSH on the cloud MQTT period; this trait only applies the ACK.
 */
export class FanTrait {
    private readonly bind: FanTraitBind;
    private readonly namespaces: ReadonlySet<string>;
    private last: FanValues = {};
    private maxSpeed = 1;
    private savedSpeed = 1;
    private lastWireSpeed = 0;
    /** True once Control.Fan reported a positive maxSpeed (Fan.Config must not override). */
    private fanReportedMaxSpeed = false;

    constructor(bind: FanTraitBind) {
        this.bind = bind;
        this.namespaces = bind.namespaces ?? new Set();
    }

    private has(namespace: string): boolean {
        return this.namespaces.has(namespace);
    }

    /** Undefined until poller GETACK or PUSH fills it. */
    isOn(): boolean | undefined {
        return this.last.on;
    }

    /** Host range is `0..1` of advertised maxSpeed. */
    getSpeed(): number | undefined {
        return this.last.speed;
    }

    /** Host range is `0..1` from FilterMaintenance. */
    getFilterLife(): number | undefined {
        return this.last.filterLife;
    }

    async setOn(on: boolean): Promise<{ on: boolean }> {
        if (this.bind.hasToggleX) {
            await this.bind.request({
                namespace: TOGGLEX_NAMESPACE,
                method: 'SET',
                payload: encodeToggleXSet({ channel: this.bind.channel, on })
            });
        } else if (this.bind.hasToggle) {
            await this.bind.request({
                namespace: 'Appliance.Control.Toggle',
                method: 'SET',
                payload: { toggle: { onoff: on ? 1 : 0 } }
            });
        } else {
            await this.requestSpeed(on ? this.savedSpeed : 0);
            this.applyFanSpeed(on ? this.savedSpeed : 0);
            return { on };
        }
        this.applyChange({ on });
        return { on };
    }

    /**
     * Wire speed is rounded against the last known maxSpeed.
     */
    async setSpeed(speed: number): Promise<{ speed: number }> {
        const wire = Math.round(clamp01(speed) * this.maxSpeed);
        await this.requestSpeed(wire);
        this.applyFanSpeed(wire);
        return { speed: this.last.speed ?? speed };
    }

    /**
     * GET disconnects on MFC100, so this is never polled from DevicePoller.
     * Returns `undefined` when BtnConfig is absent.
     */
    async getButtonConfig(): Promise<FanButtonConfig | undefined> {
        if (!this.has(FAN_BTN_CONFIG_NAMESPACE)) {
            return undefined;
        }
        const reply = await this.bind.request({
            namespace: FAN_BTN_CONFIG_NAMESPACE,
            method: 'PUSH',
            payload: encodeFanBtnConfigPushQuery()
        });
        return decodeFanBtnConfigPush(reply.payload).find(
            (entry) => entry.channel === this.bind.channel
        );
    }

    /**
     * No-op when BtnConfig is absent.
     */
    async setButtonConfig(options: Omit<FanButtonConfigSetOptions, 'channel'>): Promise<void> {
        if (!this.has(FAN_BTN_CONFIG_NAMESPACE)) {
            return;
        }
        await this.bind.request({
            namespace: FAN_BTN_CONFIG_NAMESPACE,
            method: 'SET',
            payload: encodeFanBtnConfigSet({ channel: this.bind.channel, ...options })
        });
    }

    handlePush(message: MerossMessage): void {
        const uuid = message.header.uuid
            ?? /^\/appliance\/([^/]+)\//.exec(message.header.from)?.[1];
        if (!uuid || uuid !== this.bind.uuid) {
            return;
        }

        if (message.header.namespace === TOGGLEX_NAMESPACE && this.bind.hasToggleX) {
            for (const entry of decodeToggleXPush(message.payload)) {
                if (entry.channel === this.bind.channel) {
                    this.applyChange({ on: entry.on });
                    return;
                }
            }
            return;
        }

        if (message.header.namespace === 'Appliance.Control.Toggle' && this.bind.hasToggle) {
            if (this.bind.channel === 0) {
                const toggle = message.payload.toggle as { onoff?: unknown } | undefined;
                if (toggle && typeof toggle.onoff === 'number') {
                    this.applyChange({ on: toggle.onoff === 1 });
                }
            }
            return;
        }

        const ns = message.header.namespace;
        if (ns === FAN_NAMESPACE) {
            for (const entry of decodeFanPush(message.payload)) {
                if (entry.channel === this.bind.channel) {
                    this.applyFanEntry(entry);
                }
            }
            return;
        }

        if (ns === FAN_CONFIG_NAMESPACE && this.has(ns)) {
            for (const entry of decodeFanConfigGetAck(message.payload)) {
                if (entry.channel !== this.bind.channel) {
                    continue;
                }
                if (
                    this.fanReportedMaxSpeed
                    || entry.maxSpeed === undefined
                    || entry.maxSpeed <= 0
                ) {
                    continue;
                }
                this.maxSpeed = entry.maxSpeed;
                this.applyFanSpeed(this.lastWireSpeed);
            }
            return;
        }

        if (ns === FILTER_MAINTENANCE_NAMESPACE && this.has(ns)) {
            for (const entry of decodeFilterMaintenancePush(message.payload)) {
                if (entry.channel === this.bind.channel) {
                    this.applyChange({ filterLife: entry.life / 100 });
                }
            }
        }
    }

    private async requestSpeed(speed: number): Promise<void> {
        await this.bind.request({
            namespace: FAN_NAMESPACE,
            method: 'SET',
            payload: encodeFanSet({ channel: this.bind.channel, speed })
        });
    }

    private applyFanEntry(entry: { speed: number; maxSpeed?: number }): void {
        this.lastWireSpeed = entry.speed;
        if (entry.maxSpeed !== undefined && entry.maxSpeed > 0) {
            this.fanReportedMaxSpeed = true;
            this.maxSpeed = Math.max(entry.maxSpeed, entry.speed, 1);
        } else {
            this.maxSpeed = Math.max(this.maxSpeed, entry.speed, 1);
        }
        this.applyFanSpeed(entry.speed);
    }

    private applyFanSpeed(speed: number): void {
        if (speed > 0) {
            this.savedSpeed = speed;
        }
        const patch: FanValues = {
            speed: this.maxSpeed > 0 ? speed / this.maxSpeed : 0,
            maxSpeed: this.maxSpeed
        };
        if (!this.bind.hasToggleX && !this.bind.hasToggle) {
            patch.on = speed > 0;
        }
        this.applyChange(patch);
    }

    private applyChange(patch: FanValues): void {
        const next: FanValues = {};
        for (const key of Object.keys(patch) as Array<keyof FanValues>) {
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
}

function clamp01(value: number): number {
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
