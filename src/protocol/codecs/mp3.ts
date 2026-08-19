import { ProtocolError } from '../../errors';
import type { MerossPayload } from '../message';

export const MP3_NAMESPACE = 'Appliance.Control.Mp3';

/** HP110 firmware volume is 0–16. Host traits scale this to 0..1. */
export const MP3_VOLUME_MAX = 16;

export interface Mp3State {
    channel: number;
    muted?: boolean;
    volume?: number;
    song?: number;
}

export interface Mp3GetOptions {
    channel: number;
}

export interface Mp3SetOptions {
    channel: number;
    muted?: boolean;
    volume?: number;
    song?: number;
}

/** GET `{ mp3: { channel } }`. */
export function encodeMp3Get(options: Mp3GetOptions): MerossPayload {
    return { mp3: { channel: options.channel } };
}

/** SET is a single-channel object. */
export function encodeMp3Set(options: Mp3SetOptions): MerossPayload {
    const mp3: Record<string, number> = { channel: options.channel };
    if (options.muted !== undefined) {
        mp3.mute = options.muted ? 1 : 0;
    }
    if (options.volume !== undefined) {
        mp3.volume = options.volume;
    }
    if (options.song !== undefined) {
        mp3.song = options.song;
    }
    return { mp3 };
}

export function decodeMp3GetAck(payload: MerossPayload): Mp3State {
    return decodeMp3(payload);
}

export function decodeMp3Push(payload: MerossPayload): Mp3State {
    return decodeMp3(payload);
}

function decodeMp3(payload: MerossPayload): Mp3State {
    const raw = payload.mp3;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new ProtocolError('Control.Mp3 payload must contain an mp3 object');
    }
    const { channel, mute, volume, song } = raw as Record<string, unknown>;
    if (typeof channel !== 'number') {
        throw new ProtocolError('Control.Mp3 channel is required');
    }
    const state: Mp3State = { channel };
    if (typeof mute === 'number') {
        state.muted = mute === 1;
    }
    if (typeof volume === 'number') {
        state.volume = volume;
    }
    if (typeof song === 'number') {
        state.song = song;
    }
    return state;
}
