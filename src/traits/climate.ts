import type { EnrollBoardContext, TraitAttachContext } from '../device/enroll-context';
import {
    THERMOSTAT_MODEB_NAMESPACE,
    THERMOSTAT_MODEC_NAMESPACE,
    THERMOSTAT_MODE_NAMESPACE
} from '../protocol/namespaces';
import type { TraitDescriptor } from './descriptor';
import { ClimateCatalog } from './climate.catalog';
import { ClimateHubTrait } from './climate-hub';
import { ClimateModeTrait } from './climate-mode';
import { ClimateModeBTrait } from './climate-modeb';
import { ClimateModeCTrait } from './climate-modec';

export type {
    ClimateAlarmKind,
    ClimateBoardGeneration,
    ClimateFanSpeed,
    ClimateGeneration,
    ClimateHoldMode,
    ClimateHubMode,
    ClimateMode,
    ClimateModeBMode,
    ClimateModeCMode,
    ClimateModeMode,
    ClimatePid,
    ClimateSchedule,
    ClimateSensorMode,
    ClimateSystem,
    ClimateSystemWire,
    ClimateTempUnit,
    ClimateTimer,
    ClimateTraitBind,
    ClimateTraitBoardBind,
    ClimateTraitHubBind,
    ClimateValues,
    ClimateWorkMode
} from './climate-core';
export { ClimateHubTrait } from './climate-hub';
export { ClimateModeTrait } from './climate-mode';
export { ClimateModeBTrait } from './climate-modeb';
export { ClimateModeCTrait } from './climate-modec';

/**
 * One enrolled thermostat or hub valve. Narrow on `generation` before calling
 * ModeC-only (`setFanSpeed`) or hub-only (`setConfig`) methods.
 */
export type ClimateTrait =
    | ClimateModeTrait
    | ClimateModeBTrait
    | ClimateModeCTrait
    | ClimateHubTrait;

export type ClimateBoardTrait = ClimateModeTrait | ClimateModeBTrait | ClimateModeCTrait;

/**
 * Board thermostats claim channel 0 from Ability Mode/ModeB/ModeC or digest
 * so leftover ToggleX does not enroll them as sockets.
 */
export function enrollClimate(ctx: EnrollBoardContext): void {
    if (
        THERMOSTAT_MODE_NAMESPACE in ctx.ability
        || THERMOSTAT_MODEB_NAMESPACE in ctx.ability
        || THERMOSTAT_MODEC_NAMESPACE in ctx.ability
        || ctx.all.digest.thermostat
    ) {
        ctx.add(0, 'climate', ['climate']);
    }
}

export const descriptor: TraitDescriptor<'climate', ClimateTrait> = {
    ...ClimateCatalog,
    attach(args: TraitAttachContext<'climate'>): ClimateTrait {
        if (args.graphEndpoint.subDeviceId) {
            return new ClimateHubTrait({
                kind: 'hub',
                subDeviceId: args.graphEndpoint.subDeviceId,
                namespaces: args.namespaces,
                request: args.request,
                emitChange: args.emitChange
            });
        }
        // ModeC > ModeB > mode when Ability advertises more than one generation.
        if (THERMOSTAT_MODEC_NAMESPACE in args.physical.ability) {
            return new ClimateModeCTrait({
                kind: 'board',
                channel: args.channel,
                namespaces: args.namespaces,
                request: args.request,
                emitChange: args.emitChange
            });
        }
        if (THERMOSTAT_MODEB_NAMESPACE in args.physical.ability) {
            return new ClimateModeBTrait({
                kind: 'board',
                channel: args.channel,
                namespaces: args.namespaces,
                request: args.request,
                emitChange: args.emitChange
            });
        }
        return new ClimateModeTrait({
            kind: 'board',
            channel: args.channel,
            namespaces: args.namespaces,
            request: args.request,
            emitChange: args.emitChange
        });
    }
};
