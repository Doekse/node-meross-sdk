import type { EnrollBoardContext, EnrollBoardExtraInput, TraitAttachArgs } from '../device/enroll-context';
import { enrollBoardExtra, enrollStandalone } from '../device/enroll-helpers';
import type { TraitName } from '../endpoint';
import {
    MP3_NAMESPACE,
    MP3_VOLUME_MAX,
    decodeMp3Push,
    encodeMp3Set,
    type MerossMessage,
    type Mp3State
} from '../protocol';
import { DEFAULT, type PollSpec } from '../poll/spec';
import type { DeviceRequest } from '../request';
import { applyPatch } from './patch';
import type { TraitDescriptor } from './descriptor';

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
    channel: number;
    request: DeviceRequest;
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

function hasMedia(ability: EnrollBoardExtraInput['ability']): boolean {
    return MP3_NAMESPACE in ability;
}

/**
 * Mp3 rides channel 0 when some other trait already claimed it.
 */
export function enrollBoardMediaExtra(input: EnrollBoardExtraInput): TraitName[] {
    return enrollBoardExtra(input, hasMedia(input.ability), 'media');
}

/** Standalone speaker when nothing else claimed channel 0. */
export function enrollMediaStandalone(ctx: EnrollBoardContext): void {
    enrollStandalone(ctx, hasMedia(ctx.ability), 'speaker', 'media');
}

export const MediaDescriptor: TraitDescriptor & {
    readonly name: 'media';
    attach(args: TraitAttachArgs<MediaValues>): MediaTrait;
} = {
    name: 'media',
    poll: {
        [MP3_NAMESPACE]: {
            ...DEFAULT,
            payload: { dict: 'mp3' },
            base: 380
        }
    } satisfies Record<string, PollSpec>,
    attach(args: TraitAttachArgs<MediaValues>): MediaTrait {
        return new MediaTrait({
            channel: args.channel,
            request: args.request,
            emitChange: args.emitChange
        });
    }
};
