import type { TraitAttachContext } from '../device/enroll-context';
import type { StandbyKillerTraitBind } from '../device/bindings';
import { MerossError } from '../errors';
import {
    CONFIG_STANDBY_KILLER_NAMESPACE,
    decodeStandbyKillerGetAck,
    decodeStandbyKillerPush,
    encodeStandbyKillerGet,
    encodeStandbyKillerSet
} from '../protocol/codecs/standbykiller';
import type { MerossMessage } from '../protocol/message';
import { applyPatch } from './patch';
import type { TraitDescriptor } from './descriptor';
import { StandbyKillerCatalog } from './standbykiller.catalog';

export interface StandbyKillerValues {
    enabled?: boolean;
    power?: number;
    time?: number;
    alert?: boolean;
}

/**
 * Per-channel standby cut-off. Enroll rides socket channels only.
 */
export class StandbyKillerTrait {
    /** @internal */
    private readonly bind: StandbyKillerTraitBind;
    private readonly namespaces: ReadonlySet<string>;
    private last: StandbyKillerValues = {};

    /** @internal */
    constructor(bind: StandbyKillerTraitBind) {
        this.bind = bind;
        this.namespaces = bind.namespaces ?? new Set();
    }

    private has(namespace: string): boolean {
        return this.namespaces.has(namespace);
    }

    /**
     * Full cache, not the last diff. A subscriber that attaches after enroll
     * never saw the seeded fields, and an unchanged poll does not emit again.
     */
    values(): StandbyKillerValues {
        return { ...this.last };
    }

    /** Undefined until GETACK or PUSH fills it. */
    isEnabled(): boolean | undefined {
        return this.last.enabled;
    }

    getPower(): number | undefined {
        return this.last.power;
    }

    getTime(): number | undefined {
        return this.last.time;
    }

    isAlert(): boolean | undefined {
        return this.last.alert;
    }

    /**
     * On-demand GET of StandbyKiller for this channel. Rejects with
     * `CommandError` / `TransportError` / `ProtocolError` like `set`.
     * Empty GETACK `config: []` leaves `last` unchanged (MSS305 first reply).
     */
    async poll(): Promise<StandbyKillerValues> {
        const reply = await this.bind.request({
            namespace: CONFIG_STANDBY_KILLER_NAMESPACE,
            method: 'GET',
            payload: encodeStandbyKillerGet(this.bind.channel)
        });
        const entry = decodeStandbyKillerGetAck(reply.payload)
            .find((row) => row.channel === this.bind.channel);
        if (entry) {
            this.applyConfig(entry);
        }
        return { ...this.last };
    }

    /**
     * SET StandbyKiller for this channel. Throws when the namespace is not
     * advertised so hosts cannot treat a missing Ability as a successful write.
     */
    async set(options: {
        enabled?: boolean;
        power?: number;
        time?: number;
        alert?: boolean;
    }): Promise<StandbyKillerValues> {
        if (!this.has(CONFIG_STANDBY_KILLER_NAMESPACE)) {
            throw new MerossError(
                `${CONFIG_STANDBY_KILLER_NAMESPACE} is not advertised`,
                'NAMESPACE_NOT_ADVERTISED'
            );
        }
        await this.bind.request({
            namespace: CONFIG_STANDBY_KILLER_NAMESPACE,
            method: 'SET',
            payload: encodeStandbyKillerSet({
                channel: this.bind.channel,
                ...options
            })
        });
        return this.applyConfig(options);
    }

    /**
     * PUSH/GETACK from DeviceRuntime. Hosts subscribe to Endpoint `change`.
     *
     * @internal
     * @package
     */
    handlePush(message: MerossMessage): void {
        const { namespace } = message.header;
        if (namespace === CONFIG_STANDBY_KILLER_NAMESPACE && this.has(CONFIG_STANDBY_KILLER_NAMESPACE)) {
            const entry = decodeStandbyKillerPush(message.payload)
                .find((row) => row.channel === this.bind.channel);
            if (entry) {
                this.applyConfig(entry);
            }
        }
    }

    /**
     * Copies only defined config keys so GETACK rows can carry `channel`
     * without leaking it into the snapshot.
     */
    private applyConfig(entry: StandbyKillerValues): StandbyKillerValues {
        const values: StandbyKillerValues = {};
        if (entry.enabled !== undefined) {
            values.enabled = entry.enabled;
        }
        if (entry.power !== undefined) {
            values.power = entry.power;
        }
        if (entry.time !== undefined) {
            values.time = entry.time;
        }
        if (entry.alert !== undefined) {
            values.alert = entry.alert;
        }
        this.applyChange(values);
        return values;
    }

    private applyChange(patch: StandbyKillerValues): void {
        applyPatch(this.last, patch, this.bind.emitChange);
    }
}

export const descriptor: TraitDescriptor<'standbykiller', StandbyKillerTrait> = {
    ...StandbyKillerCatalog,
    attach(args: TraitAttachContext<'standbykiller'>): StandbyKillerTrait {
        return new StandbyKillerTrait({
            channel: args.channel,
            namespaces: args.namespaces,
            request: args.request,
            emitChange: args.emitChange
        });
    }
};
