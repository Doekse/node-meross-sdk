import { encodeMessage, type MerossMessage, type MerossPayload } from '../../src/protocol';
import type { RoutedRequestOptions } from '../../src/transport/router';

const DEFAULT_KEY = 'stub-key';
const FROM_APP = '/app/test/subscribe';

/** Trait `request` bind: uuid / ip / encryptionKey are supplied by Session. */
export type TraitRequestOptions = Omit<RoutedRequestOptions, 'uuid' | 'ip' | 'encryptionKey'>;

export interface RequestRecorderOptions {
    uuid: string;
    key?: string;
    from?: string;
    /**
     * Build the device reply. Default is `{method}ACK` with an empty payload.
     * Throw to simulate a transport/command failure after the SET is recorded.
     */
    ack?: (
        options: TraitRequestOptions,
        sent: MerossMessage
    ) => MerossMessage | Promise<MerossMessage>;
}

/**
 * Records trait `request` calls as signed envelopes and returns a canned ACK.
 * Harnesses pass {@link ack} when GETACK payload or ERROR handling matters.
 *
 * @param options Bind uuid and optional reply factory
 */
export function createRequestRecorder(options: RequestRecorderOptions): {
    requests: MerossMessage[];
    request: (opts: TraitRequestOptions) => Promise<MerossMessage>;
} {
    const key = options.key ?? DEFAULT_KEY;
    const from = options.from ?? FROM_APP;
    const requests: MerossMessage[] = [];
    return {
        requests,
        request: async (opts) => {
            const sent = encodeMessage({
                namespace: opts.namespace,
                method: opts.method,
                key,
                from,
                payload: opts.payload,
                uuid: options.uuid
            });
            requests.push(sent);
            if (options.ack !== undefined) {
                return options.ack(opts, sent);
            }
            return traitAck(sent, { key });
        }
    };
}

/**
 * Device reply for a recorded request. Defaults to `{method}ACK` and the
 * request uuid so tests only pass the payload they care about.
 *
 * @param sent Outbound envelope from {@link createRequestRecorder}
 * @param options Override method, payload, or signing key
 */
export function traitAck(
    sent: MerossMessage,
    options: {
        key?: string;
        method?: string;
        payload?: MerossPayload;
    } = {}
): MerossMessage {
    const uuid = sent.header.uuid ?? '';
    const key = options.key ?? DEFAULT_KEY;
    return encodeMessage({
        namespace: sent.header.namespace,
        method: options.method ?? `${sent.header.method}ACK`,
        key,
        from: `/appliance/${uuid}/publish`,
        messageId: sent.header.messageId,
        uuid,
        payload: options.payload ?? {}
    });
}

/**
 * Namespace/method/payload triples for assertions that should not mention
 * signatures or message ids.
 *
 * @param requests Recorded envelopes
 */
export function recordedCalls(requests: readonly MerossMessage[]): Array<{
    namespace: string;
    method: string;
    payload: MerossPayload;
}> {
    return requests.map((message) => ({
        namespace: message.header.namespace,
        method: message.header.method,
        payload: message.payload
    }));
}
