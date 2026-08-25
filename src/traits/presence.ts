import {
    PRESENCE_CONFIG_NAMESPACE,
    PRESENCE_STUDY_NAMESPACE,
    SENSOR_LATESTX_NAMESPACE,
    decodeLatestXPush,
    decodePresenceConfigGetAck,
    decodePresenceConfigPush,
    encodePresenceConfigGet,
    encodePresenceConfigSet,
    encodePresenceStudySet,
    type MerossMessage,
    type PresenceConfig,
    type PresenceConfigSetOptions
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
    /** Nobody-timeout in seconds from Presence.Config. */
    noBodyTime?: number;
    /** Max detection distance in meters from Presence.Config. */
    maxDistance?: number;
    /** Sensitivity level (0–2) from Presence.Config. */
    sensitivity?: number;
    /** Work mode (0–2) from Presence.Config. */
    workMode?: number;
    /** Test mode (0–2) from Presence.Config. */
    testMode?: number;
}

/**
 * Transport + channel bind for a WiFi presence board (MS600). Session supplies
 * this; trait tests inject a fake request/emit pair.
 */
export interface PresenceTraitBind {
    uuid: string;
    channel: number;
    /** Ability keys; extra methods no-op when the namespace is absent. */
    namespaces?: ReadonlySet<string>;
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

    private has(namespace: string): boolean {
        return this.bind.namespaces?.has(namespace) ?? false;
    }

    handlePush(message: MerossMessage): void {
        const uuid = message.header.uuid
            ?? /^\/appliance\/([^/]+)\//.exec(message.header.from)?.[1];
        if (!uuid || uuid !== this.bind.uuid) {
            return;
        }
        if (message.header.namespace === SENSOR_LATESTX_NAMESPACE) {
            for (const entry of decodeLatestXPush(message.payload)) {
                if (entry.subId || entry.channel !== this.bind.channel) {
                    continue;
                }
                this.applyChange(presencePatch(entry));
            }
            return;
        }
        if (message.header.namespace === PRESENCE_CONFIG_NAMESPACE && this.has(PRESENCE_CONFIG_NAMESPACE)) {
            for (const entry of decodePresenceConfigPush(message.payload)) {
                if (entry.channel !== this.bind.channel) {
                    continue;
                }
                this.applyChange(configPatch(entry));
            }
        }
    }

    /**
     * Returns `undefined` when Presence.Config is not advertised.
     */
    async getConfig(): Promise<PresenceConfig | undefined> {
        if (!this.has(PRESENCE_CONFIG_NAMESPACE)) {
            return undefined;
        }
        const reply = await this.bind.request({
            namespace: PRESENCE_CONFIG_NAMESPACE,
            method: 'GET',
            payload: encodePresenceConfigGet(this.bind.channel)
        });
        const entry = decodePresenceConfigGetAck(reply.payload).find(
            (e) => e.channel === this.bind.channel
        );
        if (entry) {
            this.applyChange(configPatch(entry));
        }
        return entry;
    }

    /**
     * Only supplied fields go on the wire. No-op when Presence.Config is not advertised.
     */
    async setConfig(options: Omit<PresenceConfigSetOptions, 'channel'>): Promise<void> {
        if (!this.has(PRESENCE_CONFIG_NAMESPACE)) {
            return;
        }
        await this.bind.request({
            namespace: PRESENCE_CONFIG_NAMESPACE,
            method: 'SET',
            payload: encodePresenceConfigSet({ ...options, channel: this.bind.channel })
        });
    }

    /**
     * No-op when Presence.Study is not advertised.
     */
    async startStudy(): Promise<void> {
        if (!this.has(PRESENCE_STUDY_NAMESPACE)) {
            return;
        }
        await this.bind.request({
            namespace: PRESENCE_STUDY_NAMESPACE,
            method: 'SET',
            payload: encodePresenceStudySet(this.bind.channel)
        });
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
}

function presencePatch(entry: {
    present?: boolean;
    distance?: number;
    light?: number;
    times?: number;
}): PresenceValues {
    const patch: PresenceValues = {};
    if (entry.present !== undefined) {
        patch.present = entry.present;
    }
    if (entry.distance !== undefined) {
        patch.distance = entry.distance;
    }
    if (entry.light !== undefined) {
        patch.light = entry.light;
    }
    if (entry.times !== undefined) {
        patch.times = entry.times;
    }
    return patch;
}

function configPatch(entry: PresenceConfig): PresenceValues {
    return {
        noBodyTime: entry.noBodyTime,
        maxDistance: entry.distance,
        sensitivity: entry.sensitivity,
        workMode: entry.mode.workMode,
        testMode: entry.mode.testMode
    };
}
