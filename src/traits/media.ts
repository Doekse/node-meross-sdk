import {
    MP3_NAMESPACE,
    MP3_VOLUME_MAX,
    decodeMp3Push,
    encodeMp3Set,
    type MerossMessage,
    type Mp3State
} from '../protocol';
import type { RoutedRequestOptions } from '../transport/router';

export interface MediaValues {
    muted?: boolean;
    /** Volume as 0..1 of firmware max 16. */
    volume?: number;
    song?: number;
}

/**
 * Transport + channel bind for one Control.Mp3 endpoint. Session supplies this;
 * trait tests inject a fake request/emit pair.
 */
export interface MediaTraitBind {
    uuid: string;
    channel: number;
    request: (options: Omit<RoutedRequestOptions, 'uuid' | 'ip' | 'encryptionKey'>) => Promise<MerossMessage>;
    emitChange: (values: MediaValues) => void;
}

/**
 * White-noise player for one enrolled channel. Mute, volume, and song are
 * separate Control.Mp3 SETs.
 */
export class MediaTrait {
    private readonly bind: MediaTraitBind;
    private last: MediaValues = {};

    constructor(bind: MediaTraitBind) {
        this.bind = bind;
    }

    /** Firmware mute 1 is stopped/idle. Undefined until GETACK or PUSH fills it. */
    isMuted(): boolean | undefined {
        return this.last.muted;
    }

    /** Host range is `0..1` of firmware max 16. */
    getVolume(): number | undefined {
        return this.last.volume;
    }

    getSong(): number | undefined {
        return this.last.song;
    }

    /**
     * Firmware mute 1 is stopped/idle, not a volume of zero.
     */
    async setMuted(muted: boolean): Promise<{ muted: boolean }> {
        await this.bind.request({
            namespace: MP3_NAMESPACE,
            method: 'SET',
            payload: encodeMp3Set({ channel: this.bind.channel, muted })
        });
        this.applyChange({ muted });
        return { muted };
    }

    /**
     * Host range is `0..1`; wire volume is 0–16.
     */
    async setVolume(volume: number): Promise<{ volume: number }> {
        const wire = Math.round(clamp01(volume) * MP3_VOLUME_MAX);
        await this.bind.request({
            namespace: MP3_NAMESPACE,
            method: 'SET',
            payload: encodeMp3Set({ channel: this.bind.channel, volume: wire })
        });
        this.applyChange({ volume: wire / MP3_VOLUME_MAX });
        return { volume: wire / MP3_VOLUME_MAX };
    }

    /**
     * HP110 songs are 1–11.
     */
    async setSong(song: number): Promise<{ song: number }> {
        await this.bind.request({
            namespace: MP3_NAMESPACE,
            method: 'SET',
            payload: encodeMp3Set({ channel: this.bind.channel, song })
        });
        this.applyChange({ song });
        return { song };
    }

    handlePush(message: MerossMessage): void {
        const uuid = message.header.uuid
            ?? /^\/appliance\/([^/]+)\//.exec(message.header.from)?.[1];
        if (!uuid || uuid !== this.bind.uuid) {
            return;
        }
        if (message.header.namespace !== MP3_NAMESPACE) {
            return;
        }
        const decoded = decodeMp3Push(message.payload);
        if (decoded.channel === this.bind.channel) {
            this.applyChange(mediaPatch(decoded));
        }
    }

    private applyChange(patch: MediaValues): void {
        const next: MediaValues = {};
        for (const key of Object.keys(patch) as Array<keyof MediaValues>) {
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

function mediaPatch(entry: Mp3State): MediaValues {
    const patch: MediaValues = {};
    if (entry.muted !== undefined) {
        patch.muted = entry.muted;
    }
    if (entry.volume !== undefined) {
        patch.volume = entry.volume / MP3_VOLUME_MAX;
    }
    if (entry.song !== undefined) {
        patch.song = entry.song;
    }
    return patch;
}

function clamp01(value: number): number {
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
