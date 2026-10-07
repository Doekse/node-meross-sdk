import type { TraitAttachContext } from '../device/enroll-context';
import type { AlertTraitBind } from '../device/bindings';
import { MerossError } from '../errors';
import {
    CONTROL_ALERT_CONFIG_NAMESPACE,
    CONTROL_ALERT_REPORT_NAMESPACE,
    decodeAlertConfigGetAck,
    decodeAlertConfigPush,
    decodeAlertReportPush,
    encodeAlertConfigGet,
    encodeAlertConfigSet
} from '../protocol/codecs/alertconfig';
import type { MerossMessage } from '../protocol/message';
import { applyPatch } from './patch';
import type { TraitDescriptor } from './descriptor';
import { AlertCatalog } from './alert.catalog';

export interface AlertValues {
    type?: number;
    value?: Record<string, unknown>;
    report?: Record<string, unknown>;
}

/**
 * Per-channel alert thresholds (EM06 / MTS300). Config is polled and set;
 * Report is inbound only. Enroll rides socket and climate channels.
 */
export class AlertTrait {
    /** @internal */
    private readonly bind: AlertTraitBind;
    private readonly namespaces: ReadonlySet<string>;
    private last: AlertValues = {};

    /** @internal */
    constructor(bind: AlertTraitBind) {
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
    values(): AlertValues {
        return { ...this.last };
    }

    /** Undefined until Config GETACK or PUSH fills it. */
    getType(): number | undefined {
        return this.last.type;
    }

    getValue(): Record<string, unknown> | undefined {
        return this.last.value;
    }

    /** Live AlertReport fields; inbound SET/PUSH only, never polled. */
    getReport(): Record<string, unknown> | undefined {
        return this.last.report;
    }

    /**
     * On-demand GET of AlertConfig for this channel. Rejects with
     * `CommandError` / `TransportError` / `ProtocolError` like `set`.
     * Empty GETACK `config: []` leaves `last` unchanged.
     */
    async poll(): Promise<AlertValues> {
        const reply = await this.bind.request({
            namespace: CONTROL_ALERT_CONFIG_NAMESPACE,
            method: 'GET',
            payload: encodeAlertConfigGet(this.bind.channel)
        });
        const entry = decodeAlertConfigGetAck(reply.payload)
            .find((row) => row.channel === this.bind.channel);
        if (entry) {
            this.applyConfig(entry);
        }
        return { ...this.last };
    }

    /**
     * SET AlertConfig for this channel. Throws when the namespace is not
     * advertised so hosts cannot treat a missing Ability as a successful write.
     */
    async set(options: {
        type?: number;
        value?: Record<string, unknown>;
    }): Promise<{ type?: number; value?: Record<string, unknown> }> {
        if (!this.has(CONTROL_ALERT_CONFIG_NAMESPACE)) {
            throw new MerossError(
                `${CONTROL_ALERT_CONFIG_NAMESPACE} is not advertised`,
                'NAMESPACE_NOT_ADVERTISED'
            );
        }
        await this.bind.request({
            namespace: CONTROL_ALERT_CONFIG_NAMESPACE,
            method: 'SET',
            payload: encodeAlertConfigSet({
                channel: this.bind.channel,
                ...options
            })
        });
        return this.applyConfig(options);
    }

    /**
     * PUSH/GETACK from Runtime. Hosts subscribe to Endpoint `change`.
     *
     * @internal
     * @package
     */
    handlePush(message: MerossMessage): void {
        const { namespace } = message.header;
        if (namespace === CONTROL_ALERT_CONFIG_NAMESPACE && this.has(CONTROL_ALERT_CONFIG_NAMESPACE)) {
            const entry = decodeAlertConfigPush(message.payload)
                .find((row) => row.channel === this.bind.channel);
            if (entry) {
                this.applyConfig(entry);
            }
            return;
        }
        if (namespace === CONTROL_ALERT_REPORT_NAMESPACE && this.has(CONTROL_ALERT_REPORT_NAMESPACE)) {
            const entry = decodeAlertReportPush(message.payload)
                .find((row) => row.channel === this.bind.channel);
            if (entry) {
                this.applyChange({ report: entry.fields });
            }
        }
    }

    /**
     * Copies only defined config keys so GETACK rows can carry `channel`
     * without leaking it into the snapshot.
     */
    private applyConfig(entry: {
        type?: number;
        value?: Record<string, unknown>;
    }): { type?: number; value?: Record<string, unknown> } {
        const values: { type?: number; value?: Record<string, unknown> } = {};
        if (entry.type !== undefined) {
            values.type = entry.type;
        }
        if (entry.value !== undefined) {
            values.value = entry.value;
        }
        this.applyChange(values);
        return values;
    }

    private applyChange(patch: AlertValues): void {
        applyPatch(this.last, patch, this.bind.emitChange);
    }
}

export const descriptor: TraitDescriptor<'alert', AlertTrait> = {
    ...AlertCatalog,
    attach(args: TraitAttachContext<'alert'>): AlertTrait {
        return new AlertTrait({
            channel: args.channel,
            namespaces: args.namespaces,
            request: args.request,
            emitChange: args.emitChange
        });
    }
};
