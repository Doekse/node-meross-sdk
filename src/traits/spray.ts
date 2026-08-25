import {
    SPRAY_NAMESPACE,
    decodeSprayPush,
    encodeSpraySet,
    type MerossMessage,
    type SprayMode
} from '../protocol';
import type { RoutedRequestOptions } from '../transport/router';

export type { SprayMode };

export interface SprayValues {
    mode?: SprayMode;
}

/**
 * Transport + channel bind for one Control.Spray endpoint. Session supplies this;
 * trait tests inject a fake request/emit pair.
 */
export interface SprayTraitBind {
    uuid: string;
    channel: number;
    request: (options: Omit<RoutedRequestOptions, 'uuid' | 'ip' | 'encryptionKey'>) => Promise<MerossMessage>;
    emitChange: (values: SprayValues) => void;
}

/**
 * Humidifier spray mode for one enrolled channel. Firmware mode is 0/1/2
 * (off / continuous / intermittent).
 */
export class SprayTrait {
    private readonly bind: SprayTraitBind;
    private last: SprayValues = {};

    constructor(bind: SprayTraitBind) {
        this.bind = bind;
    }

    /** Last known spray mode. Undefined until poller GETACK or PUSH fills it. */
    getMode(): SprayMode | undefined {
        return this.last.mode;
    }

    /**
     * Sets the spray mode for the bound channel.
     */
    async setMode(mode: SprayMode): Promise<{ mode: SprayMode }> {
        await this.bind.request({
            namespace: SPRAY_NAMESPACE,
            method: 'SET',
            payload: encodeSpraySet({ channel: this.bind.channel, mode })
        });
        this.applyChange({ mode });
        return { mode };
    }

    /**
     * Applies a firmware PUSH for this endpoint.
     */
    handlePush(message: MerossMessage): void {
        const uuid = message.header.uuid
            ?? /^\/appliance\/([^/]+)\//.exec(message.header.from)?.[1];
        if (!uuid || uuid !== this.bind.uuid) {
            return;
        }
        if (message.header.namespace !== SPRAY_NAMESPACE) {
            return;
        }
        for (const entry of decodeSprayPush(message.payload)) {
            if (entry.channel === this.bind.channel) {
                this.applyChange({ mode: entry.mode });
            }
        }
    }

    private applyChange(patch: SprayValues): void {
        const next: SprayValues = {};
        for (const key of Object.keys(patch) as Array<keyof SprayValues>) {
            const value = patch[key];
            if (value === undefined || this.last[key] === value) {
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
