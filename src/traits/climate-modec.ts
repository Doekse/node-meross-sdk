import { MerossError } from '../errors';
import {
    THERMOSTAT_MODEC_NAMESPACE,
    encodeThermostatModeCSet
} from '../protocol/codecs/climate';
import { ClimateBoardBase } from './climate-board';
import type {
    ClimateFanSpeed,
    ClimateMode,
    ClimateModeCMode,
    ClimateTraitBoardBind,
    ClimateValues
} from './climate-core';

/**
 * Thermostat.ModeC (MTS300-class). Fan speed lives here; eco/manual slots do not.
 * ModeC `work` has no timer wire value.
 */
export class ClimateModeCTrait extends ClimateBoardBase {
    readonly kind = 'modeC' as const;

    /**
     * Off is a ModeC mode, so last.mode becomes 'off'. Restore this on setOn(true).
     */
    private lastOnMode: Exclude<ClimateModeCMode, 'off'> = 'auto';

    /** @internal */
    constructor(bind: ClimateTraitBoardBind) {
        super(bind);
    }

    /**
     * Off is control.mode=0 and replaces last.mode. Turning on restores the
     * previous working mode so an auto range is not rewritten as heat.
     */
    async setOn(on: boolean): Promise<{ on: boolean }> {
        let mode: ClimateMode;
        if (!on) {
            mode = 'off';
        } else if (this.last.mode !== undefined && this.last.mode !== 'off') {
            mode = this.last.mode;
        } else {
            mode = this.lastOnMode;
        }
        await this.request({
            namespace: THERMOSTAT_MODEC_NAMESPACE,
            method: 'SET',
            payload: encodeThermostatModeCSet({ channel: this.channel, mode })
        });
        this.applyChange({ on, mode });
        return { on };
    }

    async setMode(mode: ClimateModeCMode): Promise<{ mode: ClimateModeCMode }> {
        await this.request({
            namespace: THERMOSTAT_MODEC_NAMESPACE,
            method: 'SET',
            payload: encodeThermostatModeCSet({ channel: this.channel, mode })
        });
        this.applyChange({ mode, on: mode !== 'off' });
        return { mode };
    }

    /**
     * Writes the active heat or cold slot. Auto is a range; use
     * {@link setHeatTemperature} / {@link setCoolTemperature}.
     */
    async setTargetTemperature(celsius: number): Promise<{ targetTemperature: number }> {
        const mode = this.last.mode;
        if (mode !== 'heat' && mode !== 'cool') {
            throw new MerossError(
                'climate.setTargetTemperature() requires heat or cool; in auto use setHeatTemperature/setCoolTemperature',
                'UNSUPPORTED'
            );
        }
        await this.request({
            namespace: THERMOSTAT_MODEC_NAMESPACE,
            method: 'SET',
            payload: encodeThermostatModeCSet({
                channel: this.channel,
                targetTemperature: celsius,
                mode
            })
        });
        if (mode === 'heat') {
            this.applyChange({ targetTemperature: celsius, heatTemperature: celsius });
        } else {
            this.applyChange({ targetTemperature: celsius, coolTemperature: celsius });
        }
        return { targetTemperature: celsius };
    }

    async setHeatTemperature(celsius: number): Promise<{ heatTemperature: number }> {
        await this.request({
            namespace: THERMOSTAT_MODEC_NAMESPACE,
            method: 'SET',
            payload: encodeThermostatModeCSet({ channel: this.channel, heatTemperature: celsius })
        });
        this.applyChange({ heatTemperature: celsius });
        return { heatTemperature: celsius };
    }

    async setCoolTemperature(celsius: number): Promise<{ coolTemperature: number }> {
        await this.request({
            namespace: THERMOSTAT_MODEC_NAMESPACE,
            method: 'SET',
            payload: encodeThermostatModeCSet({ channel: this.channel, coolTemperature: celsius })
        });
        this.applyChange({ coolTemperature: celsius });
        return { coolTemperature: celsius };
    }

    async setWorkMode(workMode: 'manual' | 'schedule'): Promise<{ workMode: 'manual' | 'schedule' }> {
        await this.request({
            namespace: THERMOSTAT_MODEC_NAMESPACE,
            method: 'SET',
            payload: encodeThermostatModeCSet({ channel: this.channel, workMode })
        });
        this.applyChange({ workMode });
        return { workMode };
    }

    /**
     * `fanHoldMinutes: null` sends firmware disable (hTime=99999). Omit to leave hold.
     */
    async setFanSpeed(
        fanSpeed: ClimateFanSpeed,
        fanHoldMinutes?: number | null
    ): Promise<{ fanSpeed: ClimateFanSpeed }> {
        await this.request({
            namespace: THERMOSTAT_MODEC_NAMESPACE,
            method: 'SET',
            payload: encodeThermostatModeCSet({
                channel: this.channel,
                fanSpeed,
                ...(fanHoldMinutes !== undefined ? { fanHoldMinutes } : {})
            })
        });
        this.applyChange({
            fanSpeed,
            ...(fanHoldMinutes !== undefined ? { fanHoldMinutes } : {})
        });
        return { fanSpeed };
    }

    protected override applyChange(patch: ClimateValues): void {
        super.applyChange(patch);
        const mode = this.last.mode;
        if (mode === 'heat' || mode === 'cool' || mode === 'auto') {
            this.lastOnMode = mode;
        }
    }
}
