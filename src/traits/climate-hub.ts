import type { ClimateTraitHubBind } from '../device/bindings';
import { MerossError } from '../errors';
import {
    HUB_MTS100_ADJUST_NAMESPACE,
    HUB_MTS100_ALL_NAMESPACE,
    HUB_MTS100_CONFIG_NAMESPACE,
    HUB_MTS100_MODE_NAMESPACE,
    HUB_MTS100_SCHEDULEB_NAMESPACE,
    HUB_MTS100_SCHEDULE_NAMESPACE,
    HUB_MTS100_SUPERCTL_NAMESPACE,
    HUB_MTS100_TEMPERATURE_NAMESPACE,
    HUB_MTS100_TIMESYNC_NAMESPACE,
    PHYSICAL_LOCK_NAMESPACE,
    decodeHubAdjust,
    decodeHubConfig,
    decodeHubMts100All,
    decodeHubMts100ModePush,
    decodeHubMts100TemperaturePush,
    decodeHubSchedule,
    decodeHubSuperCtl,
    decodeHubTimeSync,
    decodePhysicalLock,
    encodeHubAdjustSet,
    encodeHubConfigSet,
    encodeHubMts100ModeSet,
    encodeHubMts100TemperatureSet,
    encodeHubScheduleSet,
    encodeHubSuperCtlSet,
    encodePhysicalLockSet,
    type ClimateMode
} from '../protocol/codecs/climate';
import {
    decodeHubExceptionPush,
    decodeHubSubDeviceVersionPush,
    decodeHubToggleXPush,
    encodeHubToggleXSet
} from '../protocol/codecs/hub';
import type { MerossMessage, MerossPayload } from '../protocol/message';
import {
    HUB_EXCEPTION_NAMESPACE,
    HUB_SUBDEVICE_VERSION_NAMESPACE,
    HUB_TOGGLEX_NAMESPACE
} from '../protocol/namespaces';
import {
    ClimateTraitBase,
    type ClimateHubMode,
    type ClimatePid,
    type ClimateSchedule
} from './climate-core';

/**
 * MTS100 Mode.state: 0=custom, 1=heat/comfort, 2=cool/economy, 3=auto/schedule, 4=eco/away.
 * Off is Hub.ToggleX, not a Mode state. `manual` has no hub wire value.
 */
const HUB_MODE_FROM_WIRE: Record<number, ClimateMode> = {
    0: 'custom',
    1: 'heat',
    2: 'cool',
    3: 'auto',
    4: 'eco'
};
const HUB_MODE_TO_WIRE: Partial<Record<ClimateHubMode, number>> = {
    custom: 0,
    heat: 1,
    cool: 2,
    auto: 3,
    eco: 4
};

/**
 * Hub MTS100/MTS150 valve. Off is ToggleX; comfort/economy/away are
 * Temperature slots. Board extras (fan, HoldAction, history) are not here.
 */
export class ClimateHubTrait extends ClimateTraitBase {
    readonly kind = 'hub' as const;

    private readonly subDeviceId: string;

    /** @internal */
    constructor(bind: ClimateTraitHubBind) {
        super(bind.namespaces, bind.request, bind.emitChange);
        this.subDeviceId = bind.subDeviceId;
    }

    async setOn(on: boolean): Promise<{ on: boolean }> {
        await this.request({
            namespace: HUB_TOGGLEX_NAMESPACE,
            method: 'SET',
            payload: encodeHubToggleXSet({ id: this.subDeviceId, on })
        });
        this.applyChange(on ? { on } : { on, mode: 'off' });
        return { on };
    }

    /**
     * Hub `off` is ToggleX, not Mode.state.
     */
    async setMode(mode: ClimateHubMode): Promise<{ mode: ClimateHubMode }> {
        if (mode === 'off') {
            await this.request({
                namespace: HUB_TOGGLEX_NAMESPACE,
                method: 'SET',
                payload: encodeHubToggleXSet({ id: this.subDeviceId, on: false })
            });
            this.applyChange({ mode, on: false });
            return { mode };
        }
        const state = HUB_MODE_TO_WIRE[mode];
        if (state === undefined) {
            throw new MerossError(
                `climate.setMode('${mode}') is not supported on hub valves`,
                'UNSUPPORTED'
            );
        }
        await this.request({
            namespace: HUB_MTS100_MODE_NAMESPACE,
            method: 'SET',
            payload: encodeHubMts100ModeSet({ id: this.subDeviceId, state })
        });
        this.applyChange({ mode });
        return { mode };
    }

    /**
     * Writes the custom Temperature slot.
     */
    async setTargetTemperature(celsius: number): Promise<{ targetTemperature: number }> {
        await this.request({
            namespace: HUB_MTS100_TEMPERATURE_NAMESPACE,
            method: 'SET',
            payload: encodeHubMts100TemperatureSet({ id: this.subDeviceId, targetTemperature: celsius })
        });
        this.applyChange({ targetTemperature: celsius });
        return { targetTemperature: celsius };
    }

    /**
     * Writes the comfort slot.
     */
    async setHeatTemperature(celsius: number): Promise<{ heatTemperature: number }> {
        await this.request({
            namespace: HUB_MTS100_TEMPERATURE_NAMESPACE,
            method: 'SET',
            payload: encodeHubMts100TemperatureSet({ id: this.subDeviceId, comfort: celsius })
        });
        this.applyChange({ heatTemperature: celsius, comfort: celsius });
        return { heatTemperature: celsius };
    }

    /**
     * Writes the economy slot.
     */
    async setCoolTemperature(celsius: number): Promise<{ coolTemperature: number }> {
        await this.request({
            namespace: HUB_MTS100_TEMPERATURE_NAMESPACE,
            method: 'SET',
            payload: encodeHubMts100TemperatureSet({ id: this.subDeviceId, economy: celsius })
        });
        this.applyChange({ coolTemperature: celsius, economy: celsius });
        return { coolTemperature: celsius };
    }

    /**
     * Writes the away slot.
     */
    async setEcoTemperature(celsius: number): Promise<{ ecoTemperature: number }> {
        await this.request({
            namespace: HUB_MTS100_TEMPERATURE_NAMESPACE,
            method: 'SET',
            payload: encodeHubMts100TemperatureSet({ id: this.subDeviceId, away: celsius })
        });
        this.applyChange({ ecoTemperature: celsius, away: celsius });
        return { ecoTemperature: celsius };
    }

    async setCalibration(calibration: number): Promise<{ calibration: number }> {
        this.requireNamespace(HUB_MTS100_ADJUST_NAMESPACE);
        await this.request({
            namespace: HUB_MTS100_ADJUST_NAMESPACE,
            method: 'SET',
            payload: encodeHubAdjustSet({ id: this.subDeviceId, calibration })
        });
        this.applyChange({ calibration });
        return { calibration };
    }

    async setChildLock(locked: boolean): Promise<{ childLock: boolean }> {
        this.requireNamespace(PHYSICAL_LOCK_NAMESPACE);
        await this.request({
            namespace: PHYSICAL_LOCK_NAMESPACE,
            method: 'SET',
            payload: encodePhysicalLockSet({ channel: 0, locked, subId: this.subDeviceId })
        });
        this.applyChange({ childLock: locked });
        return { childLock: locked };
    }

    async setSchedule(schedule: ClimateSchedule): Promise<{ schedule: ClimateSchedule }> {
        const ns = this.has(HUB_MTS100_SCHEDULEB_NAMESPACE)
            ? HUB_MTS100_SCHEDULEB_NAMESPACE
            : this.has(HUB_MTS100_SCHEDULE_NAMESPACE)
                ? HUB_MTS100_SCHEDULE_NAMESPACE
                : undefined;
        if (!ns) {
            throw new MerossError(
                `${HUB_MTS100_SCHEDULE_NAMESPACE} is not advertised`,
                'NAMESPACE_NOT_ADVERTISED'
            );
        }
        await this.request({
            namespace: ns,
            method: 'SET',
            payload: encodeHubScheduleSet({ id: this.subDeviceId, schedule, scale: 10 })
        });
        this.applyChange({ schedule });
        return { schedule };
    }

    async setConfig(pid: ClimatePid): Promise<{ pid: ClimatePid }> {
        this.requireNamespace(HUB_MTS100_CONFIG_NAMESPACE);
        await this.request({
            namespace: HUB_MTS100_CONFIG_NAMESPACE,
            method: 'SET',
            payload: encodeHubConfigSet({ id: this.subDeviceId, pid })
        });
        this.applyChange({ pid });
        return { pid };
    }

    async setSuperCtl(superCtl: boolean, superCtlLevel?: number): Promise<{ superCtl: boolean }> {
        this.requireNamespace(HUB_MTS100_SUPERCTL_NAMESPACE);
        await this.request({
            namespace: HUB_MTS100_SUPERCTL_NAMESPACE,
            method: 'SET',
            payload: encodeHubSuperCtlSet({
                id: this.subDeviceId,
                superCtl,
                superCtlLevel
            })
        });
        this.applyChange({ superCtl, ...(superCtlLevel !== undefined ? { superCtlLevel } : {}) });
        return { superCtl };
    }

    /**
     * PUSH/GETACK from DeviceRuntime. Hosts subscribe to Endpoint `change`.
     *
     * @internal
     * @package
     */
    handlePush(message: MerossMessage): void {
        this.handleHubPush(message.header.namespace, message.payload);
    }

    private handleHubPush(ns: string, payload: MerossPayload): void {
        const subId = this.subDeviceId;
        const id = { id: subId };
        if (ns === HUB_MTS100_ALL_NAMESPACE && this.has(ns)) {
            for (const entry of decodeHubMts100All(payload)) {
                if (entry.id !== subId) {
                    continue;
                }
                const { id: _id, modeRaw, ...rest } = entry;
                this.applyChange({
                    ...rest,
                    ...(modeRaw !== undefined ? { mode: HUB_MODE_FROM_WIRE[modeRaw] ?? 'custom' } : {})
                });
            }
            return;
        }
        if (ns === HUB_TOGGLEX_NAMESPACE) {
            this.applyMatching(decodeHubToggleXPush(payload).map((entry) => ({
                id: entry.id,
                on: entry.on
            })), id);
            return;
        }
        if (ns === HUB_EXCEPTION_NAMESPACE && this.has(ns)) {
            this.applyMatching(decodeHubExceptionPush(payload).map((entry) => ({
                id: entry.id,
                fault: entry.code
            })), id);
            return;
        }
        if (ns === HUB_SUBDEVICE_VERSION_NAMESPACE && this.has(ns)) {
            this.applyMatching(decodeHubSubDeviceVersionPush(payload).map((entry) => ({
                id: entry.id,
                ...(entry.firmware !== undefined ? { firmwareVersion: entry.firmware } : {}),
                ...(entry.hardware !== undefined ? { hardwareVersion: entry.hardware } : {})
            })), id);
            return;
        }
        if (ns === HUB_MTS100_MODE_NAMESPACE) {
            this.applyMatching(decodeHubMts100ModePush(payload).map((entry) => ({
                id: entry.id,
                mode: HUB_MODE_FROM_WIRE[entry.state] ?? 'custom'
            })), id);
            return;
        }
        if (ns === HUB_MTS100_TEMPERATURE_NAMESPACE) {
            this.applyMatching(decodeHubMts100TemperaturePush(payload), id);
            return;
        }
        if (ns === HUB_MTS100_ADJUST_NAMESPACE && this.has(ns)) {
            this.applyMatching(decodeHubAdjust(payload).filter((entry) => entry.id === subId), id);
            return;
        }
        if (ns === HUB_MTS100_CONFIG_NAMESPACE && this.has(ns)) {
            this.applyMatching(decodeHubConfig(payload).filter((entry) => entry.id === subId), id);
            return;
        }
        if (ns === HUB_MTS100_SUPERCTL_NAMESPACE && this.has(ns)) {
            this.applyMatching(decodeHubSuperCtl(payload).filter((entry) => entry.id === subId), id);
            return;
        }
        if ((ns === HUB_MTS100_SCHEDULE_NAMESPACE || ns === HUB_MTS100_SCHEDULEB_NAMESPACE) && this.has(ns)) {
            this.applyMatching(decodeHubSchedule(payload, 10).filter((entry) => entry.id === subId), id);
            return;
        }
        if (ns === HUB_MTS100_TIMESYNC_NAMESPACE && this.has(ns)) {
            this.applyMatching(decodeHubTimeSync(payload).filter((entry) => entry.id === subId), id);
            return;
        }
        if (ns === PHYSICAL_LOCK_NAMESPACE && this.has(ns)) {
            this.applyMatching(decodePhysicalLock(payload).filter((entry) => entry.id === subId), id);
        }
    }
}
