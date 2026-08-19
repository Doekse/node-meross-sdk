import {
    GARAGE_STATE_NAMESPACE,
    SHUTTER_POSITION_NAMESPACE,
    SHUTTER_STATE_NAMESPACE,
    decodeGarageGetAck,
    decodeGaragePush,
    decodeShutterPositionGetAck,
    decodeShutterPositionPush,
    decodeShutterStatePush,
    encodeGarageGet,
    encodeGarageSet,
    encodeShutterPositionGet,
    encodeShutterPositionSet,
    type MerossMessage
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
            await this.bind.request({
                namespace: GARAGE_STATE_NAMESPACE,
                method: 'SET',
                payload: encodeGarageSet({ channel: this.bind.channel, open: true })
            });
            this.applyGarage(true);
        } else {
            await this.bind.request({
                namespace: SHUTTER_POSITION_NAMESPACE,
                method: 'SET',
                payload: encodeShutterPositionSet({ channel: this.bind.channel, position: 100 })
            });
            this.applyShutter(100);
        }
        return { open: true };
    }

    /**
     * Closes the bound channel.
     */
    async close(): Promise<{ open: boolean }> {
        if (this.bind.kind === 'garage') {
            await this.bind.request({
                namespace: GARAGE_STATE_NAMESPACE,
                method: 'SET',
                payload: encodeGarageSet({ channel: this.bind.channel, open: false })
            });
            this.applyGarage(false);
        } else {
            await this.bind.request({
                namespace: SHUTTER_POSITION_NAMESPACE,
                method: 'SET',
                payload: encodeShutterPositionSet({ channel: this.bind.channel, position: 0 })
            });
            this.applyShutter(0);
        }
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
     * Applies a firmware PUSH for this endpoint.
     */
    handlePush(message: MerossMessage): void {
        const uuid = message.header.uuid
            ?? /^\/appliance\/([^/]+)\//.exec(message.header.from)?.[1];
        if (!uuid || uuid !== this.bind.uuid) {
            return;
        }

        if (this.bind.kind === 'garage' && message.header.namespace === GARAGE_STATE_NAMESPACE) {
            for (const entry of decodeGaragePush(message.payload)) {
                if (entry.channel === this.bind.channel) {
                    this.applyGarage(entry.open);
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
