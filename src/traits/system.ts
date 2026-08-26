import { decodeSystemAllGetAck } from '../graph/system-all';
import {
    SYSTEM_ALL_NAMESPACE,
    SYSTEM_CLOCK_NAMESPACE,
    SYSTEM_DEBUG_NAMESPACE,
    SYSTEM_FIRMWARE_NAMESPACE,
    SYSTEM_HARDWARE_NAMESPACE,
    SYSTEM_POSITION_NAMESPACE,
    SYSTEM_TIME_NAMESPACE,
    decodeSystemClockPush,
    decodeSystemDebugGetAck,
    decodeSystemFirmwareGetAck,
    decodeSystemHardwareGetAck,
    decodeSystemPositionGetAck,
    decodeSystemTimeGetAck,
    encodeSystemPositionSet,
    encodeSystemTimeSet,
    type MerossMessage,
    type SystemDebugState,
    type SystemFirmwareState,
    type SystemHardwareState,
    type SystemPositionState,
    type SystemTimeState
} from '../protocol';
import type { RoutedRequestOptions } from '../transport/router';

export type {
    SystemDebugState,
    SystemFirmwareState,
    SystemHardwareState,
    SystemPositionState,
    SystemTimeState
};

/**
 * Board diagnostics snapshot emitted on `change`. Nested objects replace the
 * previous value; `clockSkewSeconds` is derived from Time / Clock vs local time.
 */
export interface SystemValues {
    firmware?: SystemFirmwareState;
    hardware?: SystemHardwareState;
    time?: SystemTimeState;
    debug?: SystemDebugState;
    position?: SystemPositionState;
    clockSkewSeconds?: number;
}

/**
 * Transport bind for one board System.* surface. Session supplies this;
 * trait tests inject a fake request/emit pair.
 */
export interface SystemTraitBind {
    uuid: string;
    /** System.All firmware so hosts can read version before the first poll. */
    initialFirmware?: SystemFirmwareState;
    /** System.All hardware identity before the first poll. */
    initialHardware?: SystemHardwareState;
    /** System.All time when the digest carried it. */
    initialTime?: SystemTimeState;
    request: (options: Omit<RoutedRequestOptions, 'uuid' | 'ip' | 'encryptionKey'>) => Promise<MerossMessage>;
    emitChange: (values: SystemValues) => void;
    /** Injectable for clock-skew tests. */
    now?: () => number;
}

/**
 * Board firmware, hardware, time, and diagnostics. Channel-agnostic; Session
 * attaches one instance on channel 0 / hub root.
 */
export class SystemTrait {
    private readonly bind: SystemTraitBind;
    private readonly now: () => number;
    private last: SystemValues = {};
    /** System.Clock timestamp; preferred over Time for skew when present. */
    private clockTimestamp: number | undefined;

    constructor(bind: SystemTraitBind) {
        this.bind = bind;
        this.now = bind.now ?? Date.now;
        if (bind.initialFirmware !== undefined) {
            this.last.firmware = bind.initialFirmware;
        }
        if (bind.initialHardware !== undefined) {
            this.last.hardware = bind.initialHardware;
        }
        if (bind.initialTime !== undefined) {
            this.last.time = bind.initialTime;
            this.last.clockSkewSeconds = this.skewFor(bind.initialTime.timestamp);
        }
    }

    /** Undefined until System.All or a Firmware GETACK/PUSH fills it. */
    getFirmware(): SystemFirmwareState | undefined {
        return this.last.firmware;
    }

    /** Undefined until System.All or a Hardware GETACK fills it. */
    getHardware(): SystemHardwareState | undefined {
        return this.last.hardware;
    }

    /** Undefined until System.All or a Time GETACK/PUSH fills it. */
    getTime(): SystemTimeState | undefined {
        return this.last.time;
    }

    /** Undefined until Debug GETACK fills it. */
    getDebug(): SystemDebugState | undefined {
        return this.last.debug;
    }

    /** Undefined until Position GETACK fills it. */
    getPosition(): SystemPositionState | undefined {
        return this.last.position;
    }

    /**
     * Device clock minus local Unix seconds at the last Time / Clock update.
     * Prefers System.Clock when seen. Undefined until either timestamp is known.
     */
    clockSkewSeconds(): number | undefined {
        return this.last.clockSkewSeconds;
    }

    /**
     * Reuses the last known `timeRule` from seed or poll so SET matches firmware.
     */
    async setTimezone(timezone: string): Promise<SystemTimeState> {
        const timeRule = this.last.time?.timeRule ?? [];
        await this.bind.request({
            namespace: SYSTEM_TIME_NAMESPACE,
            method: 'SET',
            payload: encodeSystemTimeSet({ timezone, timeRule })
        });
        const time: SystemTimeState = {
            timestamp: this.last.time?.timestamp ?? Math.floor(this.now() / 1000),
            timezone,
            timeRule
        };
        this.applyTime(time);
        return time;
    }

    async setPosition(latitude: number, longitude: number): Promise<SystemPositionState> {
        const position = { latitude, longitude };
        await this.bind.request({
            namespace: SYSTEM_POSITION_NAMESPACE,
            method: 'SET',
            payload: encodeSystemPositionSet(position)
        });
        this.applyChange({ position });
        return position;
    }

    handlePush(message: MerossMessage): void {
        const uuid = message.header.uuid
            ?? /^\/appliance\/([^/]+)\//.exec(message.header.from)?.[1];
        if (!uuid || uuid !== this.bind.uuid) {
            return;
        }
        const { namespace } = message.header;
        if (namespace === SYSTEM_ALL_NAMESPACE) {
            this.applyAll(message.payload);
            return;
        }
        if (namespace === SYSTEM_TIME_NAMESPACE) {
            this.applyTime(decodeSystemTimeGetAck(message.payload));
            return;
        }
        if (namespace === SYSTEM_FIRMWARE_NAMESPACE) {
            this.applyChange({ firmware: decodeSystemFirmwareGetAck(message.payload) });
            return;
        }
        if (namespace === SYSTEM_HARDWARE_NAMESPACE) {
            this.applyChange({ hardware: decodeSystemHardwareGetAck(message.payload) });
            return;
        }
        if (namespace === SYSTEM_DEBUG_NAMESPACE) {
            this.applyChange({ debug: decodeSystemDebugGetAck(message.payload) });
            return;
        }
        if (namespace === SYSTEM_POSITION_NAMESPACE) {
            this.applyChange({ position: decodeSystemPositionGetAck(message.payload) });
            return;
        }
        if (namespace === SYSTEM_CLOCK_NAMESPACE) {
            this.clockTimestamp = decodeSystemClockPush(message.payload).timestamp;
            this.applyChange({ clockSkewSeconds: this.skewFor(this.clockTimestamp) });
        }
    }

    /**
     * Heartbeat All carries firmware, hardware, and time. Standalone Time/Firmware
     * GET is only a fallback when All is not advertised.
     */
    private applyAll(payload: MerossMessage['payload']): void {
        const all = decodeSystemAllGetAck(payload);
        const patch: SystemValues = {
            firmware: all.firmware,
            hardware: all.hardware
        };
        if (all.time !== undefined) {
            patch.time = all.time;
            patch.clockSkewSeconds = this.skewFor(this.clockTimestamp ?? all.time.timestamp);
        }
        this.applyChange(patch);
    }

    private applyTime(time: SystemTimeState): void {
        this.applyChange({
            time,
            clockSkewSeconds: this.skewFor(this.clockTimestamp ?? time.timestamp)
        });
    }

    private skewFor(deviceTs: number): number {
        return deviceTs - Math.floor(this.now() / 1000);
    }

    private applyChange(patch: SystemValues): void {
        const next: SystemValues = {};
        for (const key of Object.keys(patch) as Array<keyof SystemValues>) {
            const value = patch[key];
            if (value === undefined) {
                continue;
            }
            const previous = this.last[key];
            const changed = typeof value === 'object'
                ? JSON.stringify(previous) !== JSON.stringify(value)
                : previous !== value;
            if (!changed) {
                continue;
            }
            (this.last as Record<string, unknown>)[key] = value;
            (next as Record<string, unknown>)[key] = value;
        }
        if (Object.keys(next).length > 0) {
            this.bind.emitChange(next);
        }
    }
}
