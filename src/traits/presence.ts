import type { EnrollBoardContext, TraitAttachArgs } from '../device/enroll-context';
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
import {
    channelList,
    SMART_CONFIG,
    SMART_FAST_MQTT,
    type PollSpec
} from '../poll/spec';
import type { DeviceRequest } from '../request';
import { applyPatch } from './patch';
import type { TraitDescriptor } from './descriptor';

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
 * Transport + channel bind for a WiFi presence device (MS600). Session supplies
 * this; trait tests inject a fake request/emit pair.
 */
export interface PresenceTraitBind {
    channel: number;
    /** Ability keys; extra methods no-op when the namespace is absent. */
    namespaces?: ReadonlySet<string>;
    request: DeviceRequest;
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

/**
 * MS600 has no digest channel list for presence; Ability Config/Study is the
 * claim so leftover ToggleX does not enroll it as a socket.
 */
export function enrollPresence(ctx: EnrollBoardContext): void {
    if (PRESENCE_CONFIG_NAMESPACE in ctx.ability || PRESENCE_STUDY_NAMESPACE in ctx.ability) {
        ctx.add(0, 'sensor', ['presence']);
    }
}

export const PresenceDescriptor: TraitDescriptor & {
    readonly name: 'presence';
    attach(args: TraitAttachArgs<PresenceValues>): PresenceTrait;
} = {
    name: 'presence',
    poll: {
        [PRESENCE_CONFIG_NAMESPACE]: {
            ...SMART_CONFIG,
            payload: channelList('config', 'presence'),
            item: 260
        },
        /**
         * Shared with sensor tempHum handlePush; keep `by: 'either'` + data /
         * dataId so hub children stay in the GET. preferTrait stays in jobs.
         */
        [SENSOR_LATESTX_NAMESPACE]: {
            ...SMART_FAST_MQTT,
            payload: {
                list: 'latest',
                by: 'either',
                data: ['presence', 'light'],
                dataId: ['light', 'temp', 'humi']
            },
            item: 220
        }
    } satisfies Record<string, PollSpec>,
    attach(args: TraitAttachArgs<PresenceValues>): PresenceTrait {
        return new PresenceTrait({
            channel: args.channel,
            namespaces: args.namespaces,
            request: args.request,
            emitChange: args.emitChange
        });
    }
};
