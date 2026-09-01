import {
    CONTROL_ALARM_NAMESPACE,
    CONTROL_BEEP_NAMESPACE,
    decodeAlarmPush,
    decodeBeepPush,
    encodeAlarmLinkedSet,
    encodeAlarmSet,
    encodeBeepSet,
    type AlarmChannelState,
    type BeepChannelState,
    type MerossMessage
} from '../protocol';
import type { RoutedRequestOptions } from '../transport/router';

export interface AlarmValues {
    on?: boolean;
    linked?: boolean;
    /** Control.Beep chime; distinct from the Control.Alarm siren. */
    beep?: boolean;
}

/**
 * Transport + channel bind for one Control.Alarm / Control.Beep endpoint.
 * Session supplies this; trait tests inject a fake request/emit pair. Hub
 * parent uses channel 0.
 */
export interface AlarmTraitBind {
    uuid: string;
    channel: number;
    /** Ability keys; setters and PUSH apply only for advertised namespaces. */
    namespaces?: ReadonlySet<string>;
    request: (options: Omit<RoutedRequestOptions, 'uuid' | 'ip' | 'encryptionKey'>) => Promise<MerossMessage>;
    emitChange: (values: AlarmValues) => void;
}

/**
 * Hub siren via Appliance.Control.Alarm and optional Control.Beep chime.
 * Distinct from Thermostat.Alarm on ClimateTrait.
 */
export class AlarmTrait {
    private readonly bind: AlarmTraitBind;
    private readonly namespaces: ReadonlySet<string>;
    private last: AlarmValues = {};
    /** MA151 GETACK/PUSH uses maSecurity; SET must match. */
    private maSecurity = false;

    constructor(bind: AlarmTraitBind) {
        this.bind = bind;
        this.namespaces = bind.namespaces ?? new Set();
    }

    private has(namespace: string): boolean {
        return this.namespaces.has(namespace);
    }

    /** Undefined until GETACK or PUSH fills it. */
    isOn(): boolean | undefined {
        return this.last.on;
    }

    /** Undefined until Beep GETACK or PUSH fills it. */
    isBeepOn(): boolean | undefined {
        return this.last.beep;
    }

    /**
     * Control.Alarm siren. No-op when the namespace is not advertised.
     */
    async setOn(on: boolean, durationSeconds?: number): Promise<{ on: boolean } | undefined> {
        if (!this.has(CONTROL_ALARM_NAMESPACE)) {
            return undefined;
        }
        await this.bind.request({
            namespace: CONTROL_ALARM_NAMESPACE,
            method: 'SET',
            payload: encodeAlarmSet({
                channel: this.bind.channel,
                on,
                maSecurity: this.maSecurity,
                ...(durationSeconds !== undefined ? { durationSeconds } : {})
            })
        });
        this.applyChange({ on });
        return { on };
    }

    /**
     * `event.interConn` for this device only; firmware type 1 is local scope.
     * No-op when Control.Alarm is not advertised.
     */
    async setLinked(on: boolean): Promise<{ linked: boolean } | undefined> {
        if (!this.has(CONTROL_ALARM_NAMESPACE)) {
            return undefined;
        }
        await this.bind.request({
            namespace: CONTROL_ALARM_NAMESPACE,
            method: 'SET',
            payload: encodeAlarmLinkedSet({
                channel: this.bind.channel,
                on
            })
        });
        this.applyChange({ linked: on });
        return { linked: on };
    }

    /**
     * Control.Beep chime. No-op when the namespace is not advertised.
     */
    async setBeep(on: boolean): Promise<{ beep: boolean } | undefined> {
        if (!this.has(CONTROL_BEEP_NAMESPACE)) {
            return undefined;
        }
        await this.bind.request({
            namespace: CONTROL_BEEP_NAMESPACE,
            method: 'SET',
            payload: encodeBeepSet({
                channel: this.bind.channel,
                on
            })
        });
        this.applyChange({ beep: on });
        return { beep: on };
    }

    handlePush(message: MerossMessage): void {
        if (message.header.namespace === CONTROL_ALARM_NAMESPACE && this.has(CONTROL_ALARM_NAMESPACE)) {
            for (const entry of decodeAlarmPush(message.payload)) {
                if (this.matchesAlarm(entry)) {
                    if (entry.maSecurity) {
                        this.maSecurity = true;
                    }
                    this.applyChange(alarmPatch(entry));
                }
            }
            return;
        }
        if (message.header.namespace === CONTROL_BEEP_NAMESPACE && this.has(CONTROL_BEEP_NAMESPACE)) {
            for (const entry of decodeBeepPush(message.payload)) {
                if (this.matchesBeep(entry)) {
                    this.applyChange({ beep: entry.on });
                }
            }
        }
    }

    private matchesAlarm(entry: AlarmChannelState): boolean {
        return entry.channel === this.bind.channel && entry.subId === undefined;
    }

    private matchesBeep(entry: BeepChannelState): boolean {
        return entry.channel === this.bind.channel;
    }

    private applyChange(patch: AlarmValues): void {
        const next: AlarmValues = {};
        for (const key of Object.keys(patch) as Array<keyof AlarmValues>) {
            const value = patch[key];
            if (value === undefined || this.last[key] === value) {
                continue;
            }
            this.last[key] = value;
            next[key] = value;
        }
        if (Object.keys(next).length > 0) {
            this.bind.emitChange(next);
        }
    }
}

function alarmPatch(entry: AlarmChannelState): AlarmValues {
    const patch: AlarmValues = {};
    if (entry.on !== undefined) {
        patch.on = entry.on;
    }
    if (entry.linked !== undefined) {
        patch.linked = entry.linked;
    }
    return patch;
}
