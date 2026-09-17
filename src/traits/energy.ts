import type { EnrollBoardExtraInput, TraitAttachArgs } from '../device/enroll-context';
import type { TraitName } from '../endpoint';
import {
    CONFIG_OVERTEMP_NAMESPACE,
    CONFIG_STANDBY_KILLER_NAMESPACE,
    CONSUMPTIONH_NAMESPACE,
    CONSUMPTIONX_NAMESPACE,
    CONSUMPTION_CONFIG_NAMESPACE,
    CONTROL_ALERT_CONFIG_NAMESPACE,
    CONTROL_ALERT_REPORT_NAMESPACE,
    CONTROL_OVERTEMP_NAMESPACE,
    ELECTRICITY_NAMESPACE,
    ELECTRICITYX_ALL_CHANNELS,
    ELECTRICITYX_NAMESPACE,
    consumptionXDays,
    decodeAlertConfigPush,
    decodeAlertReportPush,
    decodeConfigOverTempPush,
    decodeConsumptionConfigGetAck,
    decodeConsumptionHGetAck,
    decodeConsumptionXGetAck,
    decodeControlOverTempPush,
    decodeElectricityGetAck,
    decodeElectricityXGetAck,
    decodeStandbyKillerPush,
    encodeAlertConfigSet,
    encodeConfigOverTempSet,
    encodeConsumptionConfigGet,
    encodeConsumptionHGet,
    encodeConsumptionXDelete,
    encodeConsumptionXGet,
    encodeElectricityGet,
    encodeElectricityXGet,
    encodeStandbyKillerSet,
    type AlertConfigEntry,
    type AlertReportEntry,
    type ConfigOverTempState,
    type ConsumptionHHour,
    type ConsumptionXDay,
    type ControlOverTempState,
    type ElectricityConfig,
    type ElectricitySample,
    type MerossMessage,
    type StandbyKillerEntry
} from '../protocol';
import {
    channelList,
    pollSpecSize,
    SMART_CONFIG,
    SMART_ENERGY,
    SMART_FAST,
    type PollSpec
} from '../poll/spec';
import type { DeviceRequest } from '../request';
import { applyPatch } from './patch';
import type { TraitDescriptor } from './descriptor';

export interface EnergyValues {
    power?: number;
    current?: number;
    voltage?: number;
    consume?: number;
    powerFactor?: number;
    consumption?: ConsumptionXDay[];
    hourly?: ConsumptionHHour[];
    overTempEnabled?: boolean;
    overTempType?: number;
    overTempActive?: boolean;
    overTempTimestamp?: number;
    alertConfigType?: number;
    alertConfig?: Record<string, unknown>;
    alertReport?: Record<string, unknown>;
    standbyKillerEnabled?: boolean;
    standbyKillerPower?: number;
    standbyKillerTime?: number;
    standbyKillerAlert?: boolean;
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
    /** Ability keys; extras no-op when the namespace is absent. */
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

    constructor(bind: EnergyTraitBind) {
        this.bind = bind;
        this.namespaces = bind.namespaces ?? new Set();
    }

    private has(namespace: string): boolean {
        return this.namespaces.has(namespace);
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
     * SET Config.OverTemp. No-op when the namespace is not advertised.
     */
    async setOverTemp(enabled: boolean, type?: number): Promise<void> {
        if (!this.has(CONFIG_OVERTEMP_NAMESPACE)) {
            return;
        }
        await this.bind.request({
            namespace: CONFIG_OVERTEMP_NAMESPACE,
            method: 'SET',
            payload: encodeConfigOverTempSet({ enabled, type })
        });
        this.applyConfigOverTemp({ enabled, ...(type !== undefined ? { type } : {}) });
    }

    /**
     * SET Control.AlertConfig for this channel. No-op when absent (EM06 / similar).
     */
    async setAlertConfig(options: {
        type?: number;
        value?: Record<string, unknown>;
    }): Promise<void> {
        if (!this.has(CONTROL_ALERT_CONFIG_NAMESPACE)) {
            return;
        }
        await this.bind.request({
            namespace: CONTROL_ALERT_CONFIG_NAMESPACE,
            method: 'SET',
            payload: encodeAlertConfigSet({
                channel: this.bind.channel,
                ...options
            })
        });
        this.applyAlertConfig({
            channel: this.bind.channel,
            ...(options.type !== undefined ? { type: options.type } : {}),
            ...(options.value !== undefined ? { value: options.value } : {})
        });
    }

    /**
     * SET Config.StandbyKiller for this channel (MSS305). No-op when absent.
     */
    async setStandbyKiller(options: {
        enabled?: boolean;
        power?: number;
        time?: number;
        alert?: boolean;
    }): Promise<void> {
        if (!this.has(CONFIG_STANDBY_KILLER_NAMESPACE)) {
            return;
        }
        await this.bind.request({
            namespace: CONFIG_STANDBY_KILLER_NAMESPACE,
            method: 'SET',
            payload: encodeStandbyKillerSet({
                channel: this.bind.channel,
                ...options
            })
        });
        this.applyStandbyKiller({
            channel: this.bind.channel,
            ...(options.enabled !== undefined ? { enabled: options.enabled } : {}),
            ...(options.power !== undefined ? { power: options.power } : {}),
            ...(options.time !== undefined ? { time: options.time } : {}),
            ...(options.alert !== undefined ? { alert: options.alert } : {})
        });
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
                this.applyHourlyConsumption(sample.hourly);
            }
            return;
        }
        if (message.header.namespace === CONFIG_OVERTEMP_NAMESPACE && this.has(CONFIG_OVERTEMP_NAMESPACE)) {
            this.applyConfigOverTemp(decodeConfigOverTempPush(message.payload));
            return;
        }
        if (message.header.namespace === CONTROL_OVERTEMP_NAMESPACE && this.has(CONTROL_OVERTEMP_NAMESPACE)) {
            const entry = decodeControlOverTempPush(message.payload)
                .find((row) => row.channel === this.bind.channel);
            if (entry) {
                this.applyControlOverTemp(entry);
            }
            return;
        }
        if (message.header.namespace === CONTROL_ALERT_CONFIG_NAMESPACE && this.has(CONTROL_ALERT_CONFIG_NAMESPACE)) {
            const entry = decodeAlertConfigPush(message.payload)
                .find((row) => row.channel === this.bind.channel);
            if (entry) {
                this.applyAlertConfig(entry);
            }
            return;
        }
        if (message.header.namespace === CONTROL_ALERT_REPORT_NAMESPACE && this.has(CONTROL_ALERT_REPORT_NAMESPACE)) {
            const entry = decodeAlertReportPush(message.payload)
                .find((row) => row.channel === this.bind.channel);
            if (entry) {
                this.applyAlertReport(entry);
            }
            return;
        }
        if (message.header.namespace === CONFIG_STANDBY_KILLER_NAMESPACE && this.has(CONFIG_STANDBY_KILLER_NAMESPACE)) {
            const entry = decodeStandbyKillerPush(message.payload)
                .find((row) => row.channel === this.bind.channel);
            if (entry) {
                this.applyStandbyKiller(entry);
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
            this.applyHourlyConsumption(sample.hourly);
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

    private applyHourlyConsumption(hourly: ConsumptionHHour[]): void {
        this.applyChange({ hourly });
    }

    private applyConfigOverTemp(state: ConfigOverTempState): void {
        const values: EnergyValues = { overTempEnabled: state.enabled };
        if (state.type !== undefined) {
            values.overTempType = state.type;
        }
        this.applyChange(values);
    }

    private applyControlOverTemp(entry: ControlOverTempState): void {
        const values: EnergyValues = { overTempActive: entry.active };
        if (entry.timestamp !== undefined) {
            values.overTempTimestamp = entry.timestamp;
        }
        this.applyChange(values);
    }

    private applyAlertConfig(entry: AlertConfigEntry): void {
        const values: EnergyValues = {};
        if (entry.type !== undefined) {
            values.alertConfigType = entry.type;
        }
        if (entry.value !== undefined) {
            values.alertConfig = entry.value;
        }
        this.applyChange(values);
    }

    private applyAlertReport(entry: AlertReportEntry): void {
        this.applyChange({ alertReport: entry.fields });
    }

    private applyStandbyKiller(entry: StandbyKillerEntry): void {
        const values: EnergyValues = {};
        if (entry.enabled !== undefined) {
            values.standbyKillerEnabled = entry.enabled;
        }
        if (entry.power !== undefined) {
            values.standbyKillerPower = entry.power;
        }
        if (entry.time !== undefined) {
            values.standbyKillerTime = entry.time;
        }
        if (entry.alert !== undefined) {
            values.standbyKillerAlert = entry.alert;
        }
        this.applyChange(values);
    }

    private applyChange(patch: EnergyValues): void {
        applyPatch(this.last, patch, this.bind.emitChange);
    }
}

/**
 * Classic Electricity / ConsumptionX stay on the master (whole board);
 * ElectricityX / ConsumptionH also land on strip children.
 */
export function enrollBoardEnergyExtra(input: EnrollBoardExtraInput): TraitName[] {
    const boardEnergy = ELECTRICITY_NAMESPACE in input.ability
        || CONSUMPTIONX_NAMESPACE in input.ability;
    const channelEnergy = ELECTRICITYX_NAMESPACE in input.ability
        || CONSUMPTIONH_NAMESPACE in input.ability;
    if (channelEnergy && input.classHint === 'socket') {
        return ['energy'];
    }
    if (boardEnergy && input.classHint !== 'cover' && input.parentId === undefined) {
        return ['energy'];
    }
    return [];
}

/** Shared with calibrate so packing cannot drift from the POLL row. */
const CONSUMPTIONX_SIZE = { base: 320, item: 53 } as const;

export const EnergyDescriptor: TraitDescriptor & {
    readonly name: 'energy';
    attach(args: TraitAttachArgs<EnergyValues>): EnergyTrait;
} = {
    name: 'energy',
    poll: {
        /**
         * Shared with climate board SET/PUSH; keep unfiltered
         * `channelList('config')` so MTS300 GETs are not dropped.
         */
        [CONTROL_ALERT_CONFIG_NAMESPACE]: {
            ...SMART_CONFIG,
            payload: channelList('config')
        },
        [CONFIG_STANDBY_KILLER_NAMESPACE]: {
            ...SMART_CONFIG,
            payload: channelList('config', 'energy')
        },
        [ELECTRICITY_NAMESPACE]: {
            ...SMART_FAST,
            payload: { dict: 'electricity', channel: 0 },
            base: 430
        },
        [ELECTRICITYX_NAMESPACE]: {
            ...SMART_FAST,
            payload: { dict: 'electricity', channel: ELECTRICITYX_ALL_CHANNELS },
            item: 100
        },
        [CONSUMPTIONX_NAMESPACE]: {
            ...SMART_ENERGY,
            ...CONSUMPTIONX_SIZE,
            calibrate: (payload) => {
                const days = consumptionXDays(payload);
                if (days === undefined) {
                    return undefined;
                }
                return pollSpecSize(CONSUMPTIONX_SIZE, days.length);
            }
        },
        [CONSUMPTIONH_NAMESPACE]: {
            ...SMART_ENERGY,
            payload: channelList('consumptionH', 'energy'),
            base: 320,
            item: 1_900
        }
    } satisfies Record<string, PollSpec>,
    attach(args: TraitAttachArgs<EnergyValues>): EnergyTrait {
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
