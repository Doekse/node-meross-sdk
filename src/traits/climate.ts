import type { TraitAttachContext } from '../device/enroll-context';
import type { SystemAll } from '../protocol/codecs/system-all';
import {
    decodeSummerMode,
    decodeThermostatModeBGetAck,
    decodeThermostatModeGetAck,
    decodeWindowOpened
} from '../protocol/codecs/climate';
import {
    THERMOSTAT_MODEB_NAMESPACE,
    THERMOSTAT_MODEC_NAMESPACE
} from '../protocol/namespaces';
import type { TraitDescriptor } from './descriptor';
import { ClimateCatalog } from './climate.catalog';
import { ClimateHubTrait } from './climate-hub';
import { ClimateModeTrait } from './climate-mode';
import { ClimateModeBTrait } from './climate-modeb';
import { ClimateModeCTrait } from './climate-modec';
import type { ClimateBoardKind, ClimateValues } from './climate-core';

export type {
    ClimateAlarmKind,
    ClimateBoardKind,
    ClimateFanSpeed,
    ClimateKind,
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
    ClimateValues,
    ClimateWorkMode
} from './climate-core';
export { ClimateHubTrait } from './climate-hub';
export { ClimateModeTrait } from './climate-mode';
export { ClimateModeBTrait } from './climate-modeb';
export { ClimateModeCTrait } from './climate-modec';

/**
 * One enrolled thermostat or hub valve. Narrow on `kind` before calling
 * ModeC-only (`setFanSpeed`) or hub-only (`setConfig`) methods.
 */
export type ClimateTrait =
    | ClimateModeTrait
    | ClimateModeBTrait
    | ClimateModeCTrait
    | ClimateHubTrait;

export type ClimateBoardTrait = ClimateModeTrait | ClimateModeBTrait | ClimateModeCTrait;

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
        let kind: ClimateBoardKind = 'mode';
        if (THERMOSTAT_MODEC_NAMESPACE in args.physical.ability) {
            kind = 'modeC';
        } else if (THERMOSTAT_MODEB_NAMESPACE in args.physical.ability) {
            kind = 'modeB';
        }
        const bind = {
            kind: 'board' as const,
            channel: args.channel,
            namespaces: args.namespaces,
            initial: digestClimateValues(args.physical.digest, args.channel, kind),
            request: args.request,
            emitChange: args.emitChange
        };
        if (kind === 'modeC') {
            return new ClimateModeCTrait(bind);
        }
        if (kind === 'modeB') {
            return new ClimateModeBTrait(bind);
        }
        return new ClimateModeTrait(bind);
    }
};

/**
 * Mode / ModeB rows are the GETACK payload. ModeC has no digest key.
 * SummerMode / WindowOpened merge onto the same snapshot.
 */
function digestClimateValues(
    digest: SystemAll['digest'] | undefined,
    channel: number,
    kind: ClimateBoardKind
): ClimateValues {
    const initial: ClimateValues = {};
    const thermostat = digest?.thermostat;
    if (kind === 'mode') {
        const row = thermostat?.mode?.find((entry) => entry.channel === channel);
        if (row !== undefined && typeof row.onoff === 'number' && typeof row.mode === 'number') {
            assignHostValues(initial, decodeThermostatModeGetAck({ mode: [row] })[0]);
        }
    } else if (kind === 'modeB') {
        const row = thermostat?.modeB?.find((entry) => entry.channel === channel);
        if (row !== undefined && typeof row.onoff === 'number' && typeof row.mode === 'number') {
            assignHostValues(initial, decodeThermostatModeBGetAck({ modeB: [row] })[0]);
        }
    }
    const summer = thermostat?.summerMode?.find((entry) => entry.channel === channel);
    if (summer !== undefined && typeof summer.mode === 'number') {
        assignHostValues(initial, decodeSummerMode({ summerMode: [summer] })[0]);
    }
    const opened = thermostat?.windowOpened?.find((entry) => entry.channel === channel);
    if (opened !== undefined) {
        assignHostValues(initial, decodeWindowOpened({ windowOpened: [opened] })[0]);
    }
    return initial;
}

/**
 * Decoders include `channel`, and they omit unsupported fields entirely.
 * Copying the rest keeps those holes out of the host snapshot.
 */
function assignHostValues(initial: ClimateValues, state: { channel: number } | undefined): void {
    if (state === undefined) {
        return;
    }
    const { channel: _channel, ...values } = state;
    Object.assign(initial, values);
}
