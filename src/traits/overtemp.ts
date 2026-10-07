import type { TraitAttachContext } from '../device/enroll-context';
import type { OverTempTraitBind } from '../device/bindings';
import { MerossError } from '../errors';
import {
    CONFIG_OVERTEMP_NAMESPACE,
    CONTROL_OVERTEMP_NAMESPACE,
    decodeConfigOverTempGetAck,
    decodeConfigOverTempPush,
    decodeControlOverTempPush,
    encodeConfigOverTempGet,
    encodeConfigOverTempSet
} from '../protocol/codecs/overtemp';
import type { MerossMessage } from '../protocol/message';
import { applyPatch } from './patch';
import type { TraitDescriptor } from './descriptor';
import { OverTempCatalog } from './overtemp.catalog';

export interface OverTempValues {
    enabled?: boolean;
    type?: number;
    active?: boolean;
    timestamp?: number;
}

/**
 * Device-wide over-temperature protection. Config is polled and set; Control
 * is inbound only. Enroll rides channel 0 or the hub parent.
 */
export class OverTempTrait {
    /** @internal */
    private readonly bind: OverTempTraitBind;
    private readonly namespaces: ReadonlySet<string>;
    private last: OverTempValues = {};

    /** @internal */
    constructor(bind: OverTempTraitBind) {
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
    values(): OverTempValues {
        return { ...this.last };
    }

    /** Undefined until Config GETACK or PUSH fills it. */
    isEnabled(): boolean | undefined {
        return this.last.enabled;
    }

    /**
     * Firmware `type`: 1 = alert only, 2 = alert and relay off. Last value from
     * Config.OverTemp or a Control.OverTemp trip — the trip carries the mode
     * that actually fired.
     */
    getType(): number | undefined {
        return this.last.type;
    }

    /** Live Control.OverTemp trip; inbound SET/PUSH only, never polled. */
    isActive(): boolean | undefined {
        return this.last.active;
    }

    getTimestamp(): number | undefined {
        return this.last.timestamp;
    }

    /**
     * On-demand GET of Config.OverTemp only. Rejects with `CommandError` /
     * `TransportError` / `ProtocolError` like `set`.
     */
    async poll(): Promise<OverTempValues> {
        const reply = await this.bind.request({
            namespace: CONFIG_OVERTEMP_NAMESPACE,
            method: 'GET',
            payload: encodeConfigOverTempGet()
        });
        this.applyChange(decodeConfigOverTempGetAck(reply.payload));
        return { ...this.last };
    }

    /**
     * SET Config.OverTemp. Throws when the namespace is not advertised so
     * hosts cannot treat a missing Ability as a successful write.
     */
    async set(options: { enabled: boolean; type?: number }): Promise<{
        enabled: boolean;
        type?: number;
    }> {
        if (!this.has(CONFIG_OVERTEMP_NAMESPACE)) {
            throw new MerossError(
                `${CONFIG_OVERTEMP_NAMESPACE} is not advertised`,
                'NAMESPACE_NOT_ADVERTISED'
            );
        }
        await this.bind.request({
            namespace: CONFIG_OVERTEMP_NAMESPACE,
            method: 'SET',
            payload: encodeConfigOverTempSet(options)
        });
        const values: { enabled: boolean; type?: number } = { enabled: options.enabled };
        if (options.type !== undefined) {
            values.type = options.type;
        }
        this.applyChange(values);
        return values;
    }

    /**
     * PUSH/GETACK from DeviceRuntime. Hosts subscribe to Endpoint `change`.
     *
     * @internal
     * @package
     */
    handlePush(message: MerossMessage): void {
        const { namespace } = message.header;
        if (namespace === CONFIG_OVERTEMP_NAMESPACE && this.has(CONFIG_OVERTEMP_NAMESPACE)) {
            this.applyChange(decodeConfigOverTempPush(message.payload));
            return;
        }
        if (namespace === CONTROL_OVERTEMP_NAMESPACE && this.has(CONTROL_OVERTEMP_NAMESPACE)) {
            // Device-wide: firmware SET may omit channel (codec defaults to 0).
            const entry = decodeControlOverTempPush(message.payload)
                .find((row) => row.channel === 0);
            if (entry) {
                this.applyChange({
                    active: entry.active,
                    timestamp: entry.timestamp,
                    type: entry.type
                });
            }
        }
    }

    private applyChange(patch: OverTempValues): void {
        applyPatch(this.last, patch, this.bind.emitChange);
    }
}

export const descriptor: TraitDescriptor<'overtemp', OverTempTrait> = {
    ...OverTempCatalog,
    attach(args: TraitAttachContext<'overtemp'>): OverTempTrait {
        return new OverTempTrait({
            namespaces: args.namespaces,
            request: args.request,
            emitChange: args.emitChange
        });
    }
};
