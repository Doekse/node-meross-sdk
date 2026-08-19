import {
    SENSOR_LATESTX_NAMESPACE,
    decodeLatestXGetAck,
    decodeLatestXPush,
    encodeLatestXGet,
    type MerossMessage
} from '../protocol';
import type { RoutedRequestOptions } from '../transport/router';

export interface PresenceValues {
    /** true when firmware reports present (wire 2). */
    present?: boolean;
    /** Distance in meters. */
    distance?: number;
    /** Illuminance in lux. */
    light?: number;
    times?: number;
}

/**
 * Transport + channel bind for a WiFi presence board (MS600). Session supplies
 * this; trait tests inject a fake request/emit pair.
 */
export interface PresenceTraitBind {
    uuid: string;
    channel: number;
    request: (options: Omit<RoutedRequestOptions, 'uuid' | 'ip' | 'encryptionKey'>) => Promise<MerossMessage>;
    emitChange: (values: PresenceValues) => void;
}

/**
 * Presence and lux for a standalone radar sensor. Hub temp/hum lux stays on
 * SensorTrait; this trait is board LatestX with presence keys.
 */
export class PresenceTrait {
    private readonly bind: PresenceTraitBind;
    private last: PresenceValues = {};

    constructor(bind: PresenceTraitBind) {
        this.bind = bind;
    }

    /** Fetches initial state. Idempotent; Session calls this once and does not await it. */
    start(): void {
        void this.pollInitial();
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
        if (message.header.namespace !== SENSOR_LATESTX_NAMESPACE) {
            return;
        }
        for (const entry of decodeLatestXPush(message.payload)) {
            if (entry.subId || entry.channel !== this.bind.channel) {
                continue;
            }
            this.applyChange(presencePatch(entry));
        }
    }

    private applyChange(patch: PresenceValues): void {
        const next: PresenceValues = {};
        for (const key of Object.keys(patch) as Array<keyof PresenceValues>) {
            const value = patch[key];
            if (value === undefined) {
                continue;
            }
            const previous = this.last[key];
            const changed = typeof value === 'object'
                ? JSON.stringify(previous) !== JSON.stringify(value)
                : previous !== value;
            if (!changed) {
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
            const reply = await this.bind.request({
                namespace: SENSOR_LATESTX_NAMESPACE,
                method: 'GET',
                payload: encodeLatestXGet({
                    channel: this.bind.channel,
                    keys: ['presence', 'light']
                })
            });
            const entry = decodeLatestXGetAck(reply.payload).find((e) =>
                !e.subId && e.channel === this.bind.channel
            );
            if (entry) this.applyChange(presencePatch(entry));
        } catch {
            // Next PUSH or setter call will recover.
        }
    }
}

function presencePatch(entry: {
    present?: boolean;
    distance?: number;
    light?: number;
    times?: number;
}): PresenceValues {
    const patch: PresenceValues = {};
    if (entry.present !== undefined) patch.present = entry.present;
    if (entry.distance !== undefined) patch.distance = entry.distance;
    if (entry.light !== undefined) patch.light = entry.light;
    if (entry.times !== undefined) patch.times = entry.times;
    return patch;
}
