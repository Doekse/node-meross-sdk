import type { EnrollBoardContext, EnrollBoardExtraInput, TraitAttachArgs } from '../device/enroll-context';
import {
    enrollBoardExtra,
    enrollHubExtra,
    enrollStandalone
} from '../device/enroll-helpers';
import type { TraitName } from '../endpoint';
import { MerossError } from '../errors';
import type { AbilityMap } from '../protocol/codecs/ability';
import {
    CONFIG_OVERTEMP_NAMESPACE,
    CONTROL_OVERTEMP_NAMESPACE,
    decodeConfigOverTempGetAck,
    decodeConfigOverTempPush,
    decodeControlOverTempPush,
    encodeConfigOverTempGet,
    encodeConfigOverTempSet,
    type MerossMessage
} from '../protocol';
import { SMART_CONFIG, type PollSpec } from '../poll/spec';
import type { DeviceRequest } from '../request';
import { applyPatch } from './patch';
import type { TraitDescriptor } from './descriptor';

export interface OverTempValues {
    enabled?: boolean;
    type?: number;
    active?: boolean;
    timestamp?: number;
}

/**
 * Transport bind for one device's Config.OverTemp / Control.OverTemp surface.
 * Session supplies this; trait tests inject a fake request/emit pair.
 */
export interface OverTempTraitBind {
    /** Ability keys; Config SET and Control PUSH apply only when advertised. */
    namespaces?: ReadonlySet<string>;
    request: DeviceRequest;
    emitChange: (values: OverTempValues) => void;
}

/**
 * Device-wide over-temperature protection. Config is polled and set; Control
 * is inbound only. Enroll rides channel 0 or the hub parent.
 */
export class OverTempTrait {
    private readonly bind: OverTempTraitBind;
    private readonly namespaces: ReadonlySet<string>;
    private last: OverTempValues = {};

    constructor(bind: OverTempTraitBind) {
        this.bind = bind;
        this.namespaces = bind.namespaces ?? new Set();
    }

    private has(namespace: string): boolean {
        return this.namespaces.has(namespace);
    }

    /** Undefined until Config GETACK or PUSH fills it. */
    isEnabled(): boolean | undefined {
        return this.last.enabled;
    }

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

    handlePush(message: MerossMessage): void {
        if (message.header.namespace === CONFIG_OVERTEMP_NAMESPACE && this.has(CONFIG_OVERTEMP_NAMESPACE)) {
            this.applyChange(decodeConfigOverTempPush(message.payload));
            return;
        }
        if (message.header.namespace === CONTROL_OVERTEMP_NAMESPACE && this.has(CONTROL_OVERTEMP_NAMESPACE)) {
            // Device-wide: firmware SET may omit channel (codec defaults to 0).
            const entry = decodeControlOverTempPush(message.payload)
                .find((row) => row.channel === 0);
            if (entry) {
                this.applyChange({ active: entry.active, timestamp: entry.timestamp });
            }
        }
    }

    private applyChange(patch: OverTempValues): void {
        applyPatch(this.last, patch, this.bind.emitChange);
    }
}

/** Enroll only when Config is advertised; Control is push-only. */
function hasOverTemp(ability: AbilityMap): boolean {
    return CONFIG_OVERTEMP_NAMESPACE in ability;
}

/**
 * Device-wide OverTemp rides channel 0 when some other trait already claimed it.
 */
export function enrollBoardOverTempExtra(input: EnrollBoardExtraInput): TraitName[] {
    return enrollBoardExtra(input, hasOverTemp(input.ability), 'overtemp');
}

/** Standalone OverTemp when nothing else claimed channel 0. */
export function enrollOverTempStandalone(ctx: EnrollBoardContext): void {
    enrollStandalone(ctx, hasOverTemp(ctx.ability), 'socket', 'overtemp');
}

/** Hub parent carries OverTemp beside system when Ability advertises Config. */
export function enrollHubOverTempExtra(ability: AbilityMap): TraitName[] {
    return enrollHubExtra(hasOverTemp(ability), 'overtemp');
}

export const OverTempDescriptor: TraitDescriptor & {
    readonly name: 'overtemp';
    attach(args: TraitAttachArgs<OverTempValues>): OverTempTrait;
} = {
    name: 'overtemp',
    poll: {
        [CONFIG_OVERTEMP_NAMESPACE]: {
            ...SMART_CONFIG,
            payload: { dict: 'overTemp' },
            base: 340
        }
    } satisfies Record<string, PollSpec>,
    attach(args: TraitAttachArgs<OverTempValues>): OverTempTrait {
        return new OverTempTrait({
            namespaces: args.namespaces,
            request: args.request,
            emitChange: args.emitChange
        });
    }
};
