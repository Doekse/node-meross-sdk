import type { TraitAttachContext } from '../device/enroll-context';
import type { PresenceTraitBind } from '../device/bindings';
import {
    PRESENCE_CONFIG_NAMESPACE,
    PRESENCE_STUDY_NAMESPACE,
    decodePresenceConfigGetAck,
    decodePresenceConfigPush,
    encodePresenceConfigGet,
    encodePresenceConfigSet,
    encodePresenceStudySet,
    type PresenceConfig,
    type PresenceConfigSetOptions
} from '../protocol/codecs/presence';
import {
    SENSOR_LATESTX_NAMESPACE,
    decodeLatestXPush
} from '../protocol/codecs/sensor';
import type { MerossMessage } from '../protocol/message';
import { applyPatch } from './patch';
import type { TraitDescriptor } from './descriptor';
import { PresenceCatalog } from './presence.catalog';

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
 * Presence and lux for a standalone radar sensor. Hub temp/hum lux stays on
 * SensorTrait; this trait is board LatestX with presence keys.
 */
export class PresenceTrait {
    /** @internal */
    private readonly bind: PresenceTraitBind;
    private last: PresenceValues = {};

    /** @internal */
    constructor(bind: PresenceTraitBind) {
        this.bind = bind;
    }

    private has(namespace: string): boolean {
        return this.bind.namespaces?.has(namespace) ?? false;
    }

    /**
     * Full cache, not the last diff. A subscriber that attaches after enroll
     * never saw the seeded fields, and an unchanged poll does not emit again.
     */
    values(): PresenceValues {
        return { ...this.last };
    }

    /**
     * PUSH/GETACK from DeviceRuntime. Hosts subscribe to Endpoint `change`.
     *
     * @internal
     * @package
     */
    handlePush(message: MerossMessage): void {
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
        applyPatch(this.last, patch, this.bind.emitChange);
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

export const descriptor: TraitDescriptor<'presence', PresenceTrait> = {
    ...PresenceCatalog,
    attach(args: TraitAttachContext<'presence'>): PresenceTrait {
        return new PresenceTrait({
            channel: args.channel,
            namespaces: args.namespaces,
            request: args.request,
            emitChange: args.emitChange
        });
    }
};
