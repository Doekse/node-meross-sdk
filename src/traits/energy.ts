import type { EnrollBoardExtraInput, TraitAttachContext } from '../device/enroll-context';
import type { TraitName } from '../endpoint';
import {
    CONSUMPTION_CONFIG_NAMESPACE,
    decodeConsumptionConfigGetAck,
    encodeConsumptionConfigGet
} from '../protocol/codecs/consumptionconfig';
import {
    CONSUMPTIONH_NAMESPACE,
    decodeConsumptionHGetAck,
    encodeConsumptionHGet,
    type ConsumptionHChannel,
    type ConsumptionHHour
} from '../protocol/codecs/consumptionh';
import {
    CONSUMPTIONX_NAMESPACE,
    decodeConsumptionXGetAck,
    encodeConsumptionXDelete,
    encodeConsumptionXGet,
    type ConsumptionXDay
} from '../protocol/codecs/consumptionx';
import {
    ELECTRICITY_NAMESPACE,
    ELECTRICITYX_NAMESPACE,
    decodeElectricityGetAck,
    decodeElectricityXGetAck,
    encodeElectricityGet,
    encodeElectricityXGet,
    type ElectricityConfig,
    type ElectricitySample
} from '../protocol/codecs/electricity';
import type { MerossMessage } from '../protocol/message';
import type { DeviceRequest } from '../request';
import { applyPatch } from './patch';
import type { TraitDescriptor } from './descriptor';
import { EnergyCatalog } from './energy.catalog';

export interface EnergyValues {
    power?: number;
    current?: number;
    voltage?: number;
    consume?: number;
    powerFactor?: number;
    consumption?: ConsumptionXDay[];
    hourly?: ConsumptionHHour[];
    /**
     * ConsumptionH `total` in watt-hours. This is the energy reading
     * meross_lan publishes for that namespace.
     */
    consumptionTotal?: number;
}

/**
 * Transport + channel bind for one energy endpoint. Session supplies this;
 * trait tests inject a fake request/emit pair.
 */
export interface EnergyTraitBind {
    channel: number;
    hasElectricity: boolean;
    hasElectricityX: boolean;
    hasConsumptionX: boolean;
    hasConsumptionH: boolean;
    /** Ability keys; ConsumptionConfig no-ops when absent. */
    namespaces?: ReadonlySet<string>;
    request: DeviceRequest;
    emitChange: (values: EnergyValues) => void;
}

export type { ElectricityConfig };

/**
 * Power plus consumption samples for one enrolled endpoint. DevicePoller owns
 * the schedule; this trait applies GETACK/PUSH and exposes on-demand `poll()`.
 */
export class EnergyTrait {
    private readonly bind: EnergyTraitBind;
    private readonly namespaces: ReadonlySet<string>;
    private last: EnergyValues = {};

    /** @internal */
    constructor(bind: EnergyTraitBind) {
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
    values(): EnergyValues {
        return { ...this.last };
    }

    /**
     * On-demand GET of advertised energy namespaces. Rejects with
     * `CommandError` / `TransportError` / `ProtocolError` like `setOn`.
     * Earlier GETs in this call may already be applied to `last` and emitted.
     * DevicePoller swallows the same failures on its path.
     */
    async poll(): Promise<EnergyValues> {
        if (this.bind.hasElectricity || this.bind.hasElectricityX) {
            await this.pollElectricity();
        }
        if (this.bind.hasConsumptionX) {
            await this.pollConsumption();
        }
        if (this.bind.hasConsumptionH) {
            await this.pollHourlyConsumption();
        }
        return { ...this.last };
    }

    /**
     * On-demand only. Returns `undefined` when ConsumptionH is not advertised.
     * Rejects with `CommandError` / `TransportError` / `ProtocolError` like
     * `setOn` when the GET fails or the payload cannot be decoded.
     */
    async getHourlyConsumption(): Promise<ConsumptionHHour[] | undefined> {
        if (!this.bind.hasConsumptionH) {
            return undefined;
        }
        await this.pollHourlyConsumption();
        return this.last.hourly;
    }

    /**
     * On-demand only. Returns `undefined` when ConsumptionConfig is not advertised.
     */
    async getCalibration(): Promise<ElectricityConfig | undefined> {
        if (!this.has(CONSUMPTION_CONFIG_NAMESPACE)) {
            return undefined;
        }
        const reply = await this.bind.request({
            namespace: CONSUMPTION_CONFIG_NAMESPACE,
            method: 'GET',
            payload: encodeConsumptionConfigGet()
        });
        return decodeConsumptionConfigGetAck(reply.payload);
    }

    /**
     * DELETE is all-or-nothing and does not PUSH, so the local list updates here.
     * No-op when ConsumptionX is not advertised.
     */
    async deleteConsumption(): Promise<void> {
        if (!this.bind.hasConsumptionX) {
            return;
        }
        await this.bind.request({
            namespace: CONSUMPTIONX_NAMESPACE,
            method: 'DELETE',
            payload: encodeConsumptionXDelete()
        });
        this.applyConsumption([]);
    }

    /**
     * PUSH/GETACK from DeviceRuntime. Hosts subscribe to Endpoint `change`.
     *
     * @internal
     * @package
     */
    handlePush(message: MerossMessage): void {
        if (message.header.namespace === ELECTRICITY_NAMESPACE && this.bind.hasElectricity) {
            // Board Electricity is not channel-scoped; do not drop the sample
            // when the payload omits channel.
            this.applyElectricity(decodeElectricityGetAck(message.payload));
            return;
        }
        if (message.header.namespace === ELECTRICITYX_NAMESPACE && this.bind.hasElectricityX) {
            const sample = decodeElectricityXGetAck(message.payload)
                .find((entry) => entry.channel === this.bind.channel);
            if (sample) {
                this.applyElectricity(sample);
            }
            return;
        }
        if (message.header.namespace === CONSUMPTIONX_NAMESPACE && this.bind.hasConsumptionX) {
            this.applyConsumption(decodeConsumptionXGetAck(message.payload));
            return;
        }
        if (message.header.namespace === CONSUMPTIONH_NAMESPACE && this.bind.hasConsumptionH) {
            const sample = decodeConsumptionHGetAck(message.payload)
                .find((entry) => entry.channel === this.bind.channel);
            if (sample) {
                this.applyConsumptionH(sample);
            }
        }
    }

    private async pollElectricity(): Promise<void> {
        if (this.bind.hasElectricity) {
            const reply = await this.bind.request({
                namespace: ELECTRICITY_NAMESPACE,
                method: 'GET',
                payload: encodeElectricityGet({ channel: this.bind.channel })
            });
            this.applyElectricity(decodeElectricityGetAck(reply.payload));
            return;
        }
        const reply = await this.bind.request({
            namespace: ELECTRICITYX_NAMESPACE,
            method: 'GET',
            payload: encodeElectricityXGet()
        });
        const sample = decodeElectricityXGetAck(reply.payload)
            .find((entry) => entry.channel === this.bind.channel);
        if (sample) {
            this.applyElectricity(sample);
        }
    }

    private async pollConsumption(): Promise<void> {
        const reply = await this.bind.request({
            namespace: CONSUMPTIONX_NAMESPACE,
            method: 'GET',
            payload: encodeConsumptionXGet()
        });
        this.applyConsumption(decodeConsumptionXGetAck(reply.payload));
    }

    private async pollHourlyConsumption(): Promise<void> {
        const reply = await this.bind.request({
            namespace: CONSUMPTIONH_NAMESPACE,
            method: 'GET',
            payload: encodeConsumptionHGet(this.bind.channel)
        });
        const sample = decodeConsumptionHGetAck(reply.payload)
            .find((entry) => entry.channel === this.bind.channel);
        if (sample) {
            this.applyConsumptionH(sample);
        }
    }

    private applyElectricity(sample: ElectricitySample): void {
        const values: EnergyValues = {};
        if (sample.power !== undefined) {
            values.power = sample.power;
        }
        if (sample.current !== undefined) {
            values.current = sample.current;
        }
        if (sample.voltage !== undefined) {
            values.voltage = sample.voltage;
        }
        if (sample.consume !== undefined) {
            values.consume = sample.consume;
        }
        if (sample.powerFactor !== undefined) {
            values.powerFactor = sample.powerFactor;
        }
        this.applyChange(values);
    }

    private applyConsumption(consumption: ConsumptionXDay[]): void {
        this.applyChange({ consumption });
    }

    /**
     * `hourly` is omitted when firmware sent no `data`, so this patch cannot
     * replace a series with an empty one. `total` is applied on its own.
     */
    private applyConsumptionH(sample: ConsumptionHChannel): void {
        const values: EnergyValues = {};
        if (sample.hourly !== undefined) {
            values.hourly = sample.hourly;
        }
        if (sample.total !== undefined) {
            values.consumptionTotal = sample.total;
        }
        this.applyChange(values);
    }

    private applyChange(patch: EnergyValues): void {
        applyPatch(this.last, patch, this.bind.emitChange);
    }
}

/**
 * A strip's channel 0 switches every outlet, so a per-outlet ElectricityX
 * meter does not belong there. Returning before the board-meter check keeps
 * ConsumptionH from enrolling that channel, which has no electricity sample.
 * Firmware also copies a classic board meter onto every channel, so that
 * reading stays on the master or each outlet would count it again.
 */
export function enrollBoardEnergyExtra(input: EnrollBoardExtraInput): TraitName[] {
    if (
        ELECTRICITYX_NAMESPACE in input.ability
        && input.classHint === 'socket'
    ) {
        if (input.strip && input.channel === 0) {
            return [];
        }
        return ['energy'];
    }
    const hasBoardMeter = ELECTRICITY_NAMESPACE in input.ability
        || CONSUMPTIONX_NAMESPACE in input.ability
        || CONSUMPTIONH_NAMESPACE in input.ability;
    if (hasBoardMeter && input.classHint !== 'cover' && input.parentId === undefined) {
        return ['energy'];
    }
    return [];
}

export const descriptor: TraitDescriptor<'energy', EnergyTrait> = {
    ...EnergyCatalog,
    attach(args: TraitAttachContext<'energy'>): EnergyTrait {
        const hasElectricity = ELECTRICITY_NAMESPACE in args.physical.ability;
        return new EnergyTrait({
            channel: args.channel,
            hasElectricity,
            hasElectricityX: !hasElectricity && ELECTRICITYX_NAMESPACE in args.physical.ability,
            hasConsumptionX: CONSUMPTIONX_NAMESPACE in args.physical.ability,
            hasConsumptionH: CONSUMPTIONH_NAMESPACE in args.physical.ability,
            namespaces: args.namespaces,
            request: args.request,
            emitChange: args.emitChange
        });
    }
};
