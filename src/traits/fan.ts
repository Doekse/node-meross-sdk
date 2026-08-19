import {
    FAN_NAMESPACE,
    TOGGLEX_NAMESPACE,
    decodeFanGetAck,
    decodeFanPush,
    decodeToggleXGetAck,
    decodeToggleXPush,
    encodeFanGet,
    encodeFanSet,
    encodeToggleXGet,
    encodeToggleXSet,
    type MerossMessage
} from '../protocol';
import type { RoutedRequestOptions } from '../transport/router';

export interface FanValues {
    on?: boolean;
    /** Speed as 0..1 of advertised maxSpeed. */
    speed?: number;
    maxSpeed?: number;
}

/**
 * Transport + channel bind for one Control.Fan endpoint. Session supplies this;
 * trait tests inject a fake request/emit pair.
 */
export interface FanTraitBind {
    uuid: string;
    channel: number;
    /** Device-level on/off via ToggleX (preferred when available). */
    hasToggleX: boolean;
    /** Device-level on/off via classic Toggle (only when ToggleX is absent). */
    hasToggle: boolean;
    request: (options: Omit<RoutedRequestOptions, 'uuid' | 'ip' | 'encryptionKey'>) => Promise<MerossMessage>;
    emitChange: (values: FanValues) => void;
}

/**
 * Fan speed and power for one enrolled channel. Power routes through
 * ToggleX/Toggle when the device has it; Control.Fan handles the rest. Speed is
 * host 0..1; wire is 0..maxSpeed from the last GETACK.
 */
export class FanTrait {
    private readonly bind: FanTraitBind;
    private last: FanValues = {};
    private maxSpeed = 1;
    private savedSpeed = 1;

    constructor(bind: FanTraitBind) {
        this.bind = bind;
    }

    /** Fetches initial state. Idempotent; Session calls this once and does not await it. */
    start(): void {
        void this.pollInitial();
    }

    /** Last known on/off. Undefined until initial GET or PUSH fills it. */
    isOn(): boolean | undefined {
        return this.last.on;
    }

    /** Last known speed in `0..1`. */
    getSpeed(): number | undefined {
        return this.last.speed;
    }

    /**
     * Turns the bound channel on or off.
     */
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
     * Sets speed in `0..1`. Wire speed is rounded against the last known maxSpeed.
     */
    async setSpeed(speed: number): Promise<{ speed: number }> {
        const wire = Math.round(clamp01(speed) * this.maxSpeed);
        await this.requestSpeed(wire);
        this.applyFanSpeed(wire);
        return { speed: this.last.speed ?? speed };
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

        if (message.header.namespace !== FAN_NAMESPACE) {
            return;
        }
        for (const entry of decodeFanPush(message.payload)) {
            if (entry.channel === this.bind.channel) {
                this.applyFanEntry(entry);
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
        if (entry.maxSpeed !== undefined && entry.maxSpeed > 0) {
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

    private async pollInitial(): Promise<void> {
        try {
            const fanReply = await this.bind.request({
                namespace: FAN_NAMESPACE,
                method: 'GET',
                payload: encodeFanGet({ channel: this.bind.channel })
            });
            const fan = decodeFanGetAck(fanReply.payload).find(
                (entry) => entry.channel === this.bind.channel
            );
            if (fan) {
                this.applyFanEntry(fan);
            }
            if (!this.bind.hasToggleX) {
                return;
            }
            const toggleReply = await this.bind.request({
                namespace: TOGGLEX_NAMESPACE,
                method: 'GET',
                payload: encodeToggleXGet({ channel: this.bind.channel })
            });
            const toggle = decodeToggleXGetAck(toggleReply.payload).find(
                (entry) => entry.channel === this.bind.channel
            );
            if (toggle) {
                this.applyChange({ on: toggle.on });
            }
        } catch {
            // Next PUSH or setter call will recover.
        }
    }
}

function clamp01(value: number): number {
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
