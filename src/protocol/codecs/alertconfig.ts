import { ProtocolError } from '../../errors';
import type { MerossPayload } from '../message';

/** Alert thresholds (GET/SET/PUSH-query list). MTS300 and EM06. */
export const CONTROL_ALERT_CONFIG_NAMESPACE = 'Appliance.Control.AlertConfig';
/**
 * Live alert report (GET/SET list). Experimental in meross_lan — field names
 * are not stable, so entries keep residual wire keys.
 */
export const CONTROL_ALERT_REPORT_NAMESPACE = 'Appliance.Control.AlertReport';

export interface AlertConfigEntry {
    channel: number;
    type?: number;
    /** Device-specific nested thresholds (e.g. `{ mts300: { hcMal, auxLO, auxLOT } }`). */
    value?: Record<string, unknown>;
}

export interface AlertConfigSetOptions {
    channel: number;
    type?: number;
    value?: Record<string, unknown>;
}

export interface AlertReportEntry {
    channel: number;
    fields: Record<string, unknown>;
}

/** GET `{ config: [{ channel }] }`. */
export function encodeAlertConfigGet(channel: number): MerossPayload {
    return { config: [{ channel }] };
}

/** SET `{ config: [{ channel, type?, value? }] }`. */
export function encodeAlertConfigSet(options: AlertConfigSetOptions): MerossPayload {
    const entry: Record<string, unknown> = { channel: options.channel };
    if (options.type !== undefined) {
        entry.type = options.type;
    }
    if (options.value !== undefined) {
        entry.value = options.value;
    }
    return { config: [entry] };
}

export function decodeAlertConfigGetAck(payload: MerossPayload): AlertConfigEntry[] {
    return decodeAlertConfig(payload);
}

export function decodeAlertConfigPush(payload: MerossPayload): AlertConfigEntry[] {
    return decodeAlertConfig(payload);
}

/** GET `{ alert: [{ channel }] }`. */
export function encodeAlertReportGet(channel: number): MerossPayload {
    return { alert: [{ channel }] };
}

export function decodeAlertReportGetAck(payload: MerossPayload): AlertReportEntry[] {
    return decodeAlertReport(payload);
}

export function decodeAlertReportPush(payload: MerossPayload): AlertReportEntry[] {
    return decodeAlertReport(payload);
}

function decodeAlertConfig(payload: MerossPayload): AlertConfigEntry[] {
    const raw = payload.config;
    // EM06 has been seen to PUSH an empty body.
    if (raw === undefined) {
        return [];
    }
    if (!Array.isArray(raw)) {
        throw new ProtocolError('Control.AlertConfig payload must contain a config array');
    }
    return raw.map((item) => {
        if (typeof item !== 'object' || item === null) {
            throw new ProtocolError('Control.AlertConfig entry must be an object');
        }
        const { channel, type, value } = item as Record<string, unknown>;
        const entry: AlertConfigEntry = {
            channel: typeof channel === 'number' ? channel : 0
        };
        if (typeof type === 'number') {
            entry.type = type;
        }
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            entry.value = value as Record<string, unknown>;
        }
        return entry;
    });
}

/**
 * Soft decode: wrong or missing `alert` yields `[]` so an experimental GETACK
 * cannot break enrollment fan-out.
 */
function decodeAlertReport(payload: MerossPayload): AlertReportEntry[] {
    const raw = payload.alert;
    if (!Array.isArray(raw)) {
        return [];
    }
    const entries: AlertReportEntry[] = [];
    for (const item of raw) {
        if (typeof item !== 'object' || item === null) {
            continue;
        }
        const { channel, ...fields } = item as Record<string, unknown>;
        entries.push({
            channel: typeof channel === 'number' ? channel : 0,
            fields
        });
    }
    return entries;
}
