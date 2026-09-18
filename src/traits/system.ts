import type { EnrollBoardExtraInput, TraitAttachArgs } from '../device/enroll-context';
import type { TraitName } from '../endpoint';
import { decodeSystemAllGetAck } from '../protocol/codecs/system-all';
import {
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
    type SystemDebugState,
    type SystemFirmwareState,
    type SystemHardwareState,
    type SystemPositionState,
    type SystemTimeState
} from '../protocol/codecs/system';
import type { MerossMessage } from '../protocol/message';
import { SYSTEM_ALL_NAMESPACE } from '../protocol/namespaces';
import {
    ONCE,
    SMART_CONFIG,
    SYSTEM_ALL_PERIOD_MS,
    type PollSpec
} from '../poll/spec';
import type { DeviceRequest } from '../request';
import { applyPatch } from './patch';
import type { TraitDescriptor } from './descriptor';

export type {
    SystemDebugState,
    SystemFirmwareState,
    SystemHardwareState,
    SystemPositionState,
    SystemTimeState
};

/**
 * Device diagnostics snapshot emitted on `change`. Nested objects replace the
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
 * Transport bind for one device's System.* surface. Session supplies this;
 * trait tests inject a fake request/emit pair.
 */
export interface SystemTraitBind {
    /** System.All firmware so hosts can read version before the first poll. */
    initialFirmware?: SystemFirmwareState;
    /** System.All hardware identity before the first poll. */
    initialHardware?: SystemHardwareState;
    /** System.All time when the digest carried it. */
    initialTime?: SystemTimeState;
    request: DeviceRequest;
    emitChange: (values: SystemValues) => void;
    /** Injectable for clock-skew tests. */
    now?: () => number;
}

/**
 * Device firmware, hardware, time, and diagnostics. Channel-agnostic; Session
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
        applyPatch(this.last, patch, this.bind.emitChange);
    }
}

/**
 * Channel-0 / hub-root diagnostics. Enroll only as an extra — hubs seed
 * `'system'` on the parent row directly.
 */
export function enrollBoardSystemExtra(input: EnrollBoardExtraInput): TraitName[] {
    if (input.channel === 0 && !input.traits.includes('system')) {
        return ['system'];
    }
    return [];
}

export const SystemDescriptor: TraitDescriptor & {
    readonly name: 'system';
    attach(args: TraitAttachArgs<SystemValues>): SystemTrait;
} = {
    name: 'system',
    poll: {
        [SYSTEM_ALL_NAMESPACE]: {
            strategy: 'all',
            periodMs: SYSTEM_ALL_PERIOD_MS,
            periodCloudMs: 0,
            base: 1_000
        },
        'Appliance.System.Runtime': { ...SMART_CONFIG, base: 330 },
        // Firmware / Hardware / Time ride System.All; standalone GET is the fallback.
        [SYSTEM_FIRMWARE_NAMESPACE]: {
            ...ONCE,
            skipIf: SYSTEM_ALL_NAMESPACE
        },
        [SYSTEM_HARDWARE_NAMESPACE]: {
            ...ONCE,
            skipIf: SYSTEM_ALL_NAMESPACE
        },
        [SYSTEM_TIME_NAMESPACE]: {
            ...SMART_CONFIG,
            skipIf: SYSTEM_ALL_NAMESPACE
        },
        [SYSTEM_POSITION_NAMESPACE]: ONCE,
        [SYSTEM_DEBUG_NAMESPACE]: { ...ONCE, base: 1_900 }
    } satisfies Record<string, PollSpec>,
    attach(args: TraitAttachArgs<SystemValues>): SystemTrait {
        return new SystemTrait({
            initialFirmware: args.physical.system.firmware,
            initialHardware: args.physical.system.hardware,
            initialTime: args.physical.system.time,
            request: args.request,
            emitChange: args.emitChange
        });
    }
};
