import type { TraitAttachContext } from '../device/enroll-context';
import type { MediaTraitBind } from '../device/bindings';
import {
    MP3_NAMESPACE,
    MP3_VOLUME_MAX,
    decodeMp3Push,
    encodeMp3Set,
    type Mp3State
} from '../protocol/codecs/mp3';
import type { MerossMessage } from '../protocol/message';
import { applyPatch } from './patch';
import type { TraitDescriptor } from './descriptor';
import { MediaCatalog } from './media.catalog';

export interface MediaValues {
    muted?: boolean;
    /** Volume as 0..1 of firmware max 16. */
    volume?: number;
    song?: number;
}

/**
 * White-noise player for one enrolled channel. Mute, volume, and song are
 * separate Control.Mp3 SETs.
 */
export class MediaTrait {
    /** @internal */
    private readonly bind: MediaTraitBind;
    private last: MediaValues = {};

    /** @internal */
    constructor(bind: MediaTraitBind) {
        this.bind = bind;
    }

    /**
     * Full cache, not the last diff. A subscriber that attaches after enroll
     * never saw the seeded fields, and an unchanged poll does not emit again.
     */
    values(): MediaValues {
        return { ...this.last };
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

    /**
     * PUSH/GETACK from DeviceRuntime. Hosts subscribe to Endpoint `change`.
     *
     * @internal
     * @package
     */
    handlePush(message: MerossMessage): void {
        if (message.header.namespace !== MP3_NAMESPACE) {
            return;
        }
        const decoded = decodeMp3Push(message.payload);
        if (decoded.channel === this.bind.channel) {
            this.applyChange(mediaPatch(decoded));
        }
    }

    private applyChange(patch: MediaValues): void {
        applyPatch(this.last, patch, this.bind.emitChange);
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

export const descriptor: TraitDescriptor<'media', MediaTrait> = {
    ...MediaCatalog,
    attach(args: TraitAttachContext<'media'>): MediaTrait {
        return new MediaTrait({
            channel: args.channel,
            request: args.request,
            emitChange: args.emitChange
        });
    }
};
