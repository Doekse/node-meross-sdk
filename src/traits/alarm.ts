import {
    CONTROL_ALARM_NAMESPACE,
    decodeAlarmPush,
    encodeAlarmLinkedSet,
    encodeAlarmSet,
    type AlarmChannelState,
    type MerossMessage
} from '../protocol';
import type { RoutedRequestOptions } from '../transport/router';

export interface AlarmValues {
    on?: boolean;
    linked?: boolean;
}

/**
 * Transport + channel bind for one Control.Alarm endpoint. Session supplies this;
 * trait tests inject a fake request/emit pair. Hub parent uses channel 0.
 */
export interface AlarmTraitBind {
    uuid: string;
    channel: number;
    request: (options: Omit<RoutedRequestOptions, 'uuid' | 'ip' | 'encryptionKey'>) => Promise<MerossMessage>;
    emitChange: (values: AlarmValues) => void;
}

/**
 * Hub siren via Appliance.Control.Alarm. Distinct from Thermostat.Alarm on ClimateTrait.
 */
export class AlarmTrait {
    private readonly bind: AlarmTraitBind;
    private last: AlarmValues = {};
    /** MA151 GETACK/PUSH uses maSecurity; SET must match. */
    private maSecurity = false;

    constructor(bind: AlarmTraitBind) {
        this.bind = bind;
    }

    /** Undefined until GETACK or PUSH fills it. */
    isOn(): boolean | undefined {
        return this.last.on;
    }

    async setOn(on: boolean, durationSeconds?: number): Promise<{ on: boolean }> {
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
     */
    async setLinked(on: boolean): Promise<{ linked: boolean }> {
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

    handlePush(message: MerossMessage): void {
        const uuid = message.header.uuid
            ?? /^\/appliance\/([^/]+)\//.exec(message.header.from)?.[1];
        if (!uuid || uuid !== this.bind.uuid) {
            return;
        }
        if (message.header.namespace !== CONTROL_ALARM_NAMESPACE) {
            return;
        }
        for (const entry of decodeAlarmPush(message.payload)) {
            if (this.matches(entry)) {
                if (entry.maSecurity) {
                    this.maSecurity = true;
                }
                this.applyChange(alarmPatch(entry));
            }
        }
    }

    private matches(entry: AlarmChannelState): boolean {
        return entry.channel === this.bind.channel && entry.subId === undefined;
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
