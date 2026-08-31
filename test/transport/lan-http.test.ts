import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CommandError, ProtocolError, TransportError } from '../../src/errors';
import {
    DEFAULT_COMMAND_TIMEOUT_MS,
    ProtocolDispatcher,
    TOGGLEX_NAMESPACE,
    decodeMessage,
    decryptPayload,
    deriveEncryptionKey,
    encodeMessage,
    encodeToggleXSet,
    encryptPayload
} from '../../src/protocol';
import { verifySignature } from '../../src/protocol/sign';
import {
    DEFAULT_LAN_TIMEOUT_MS,
    LanHttpTransport,
    type LanHttpTransportOptions
} from '../../src/transport';
import { jsonResponse } from '../helpers/http';

const KEY = 'stub-key';
const UUID = '00000000-0000-4000-8000-000000000001';
const IP = '192.168.1.50';
const FROM = '/app/42-lan/subscribe';
const ENCRYPTION_KEY = deriveEncryptionKey(
    '12345678-0000-0000-0000-000000000000',
    '0123456789abcdefghijklmnopqr',
    'aa:bb:cc:dd:ee:ff'
);

interface FetchCall {
    url: string;
    init: RequestInit;
}

function ackFor(request: ReturnType<typeof decodeMessage>, method: 'GETACK' | 'SETACK' | 'ERROR') {
    return encodeMessage({
        namespace: request.header.namespace,
        method,
        key: KEY,
        from: `/appliance/${UUID}/publish`,
        messageId: request.header.messageId,
        timestamp: request.header.timestamp,
        uuid: UUID,
        payload: method === 'ERROR' ? { error: { code: 5000 } } : { togglex: { channel: 0, onoff: 1 } }
    });
}

function createTransport(
    fetchImpl: (url: string, init: RequestInit) => Promise<Response>,
    overrides: Partial<LanHttpTransportOptions> = {}
) {
    const calls: FetchCall[] = [];
    const transport = new LanHttpTransport({
        key: KEY,
        from: FROM,
        fetch: async (url, init) => {
            const requestInit = init ?? {};
            calls.push({ url: String(url), init: requestInit });
            return fetchImpl(String(url), requestInit);
        },
        ...overrides
    });
    return { transport, calls };
}

/** Drain nested microtasks so a retry can arm its next abort timer under fake time. */
function flushMicrotasks(): Promise<void> {
    return Promise.resolve().then(() => Promise.resolve());
}

function abortError(): Error {
    const error = new Error('aborted');
    error.name = 'AbortError';
    return error;
}

describe('LanHttpTransport', () => {
    it('POSTs a signed JSON envelope to http://{ip}/config and settles GETACK via pending', async () => {
        const { transport, calls } = createTransport(async (_url, init) => {
            const sent = decodeMessage(String(init.body), KEY);
            return jsonResponse(ackFor(sent, 'SETACK'));
        });

        const reply = await transport.request({
            uuid: UUID,
            ip: IP,
            namespace: TOGGLEX_NAMESPACE,
            method: 'SET',
            payload: encodeToggleXSet({ channel: 0, on: false })
        });

        assert.equal(calls.length, 1);
        assert.equal(calls[0]!.url, `http://${IP}/config`);
        assert.equal(calls[0]!.init.method, 'POST');
        const headers = calls[0]!.init.headers as Record<string, string>;
        assert.equal(headers['Content-Type'], 'application/json');

        const sent = decodeMessage(String(calls[0]!.init.body), KEY);
        assert.equal(sent.header.from, FROM);
        assert.equal(sent.header.uuid, UUID);
        assert.equal(verifySignature(sent.header, KEY), true);
        assert.equal(reply.header.method, 'SETACK');
        assert.equal(transport.dispatcher.pending.has(sent.header.messageId), false);
    });

    it('encrypts the body and decrypts the response when an AES key is set', async () => {
        const { transport, calls } = createTransport(async (_url, init) => {
            const plain = decryptPayload(String(init.body), ENCRYPTION_KEY);
            const sent = decodeMessage(plain, KEY);
            return jsonResponse(encryptPayload(JSON.stringify(ackFor(sent, 'GETACK')), ENCRYPTION_KEY));
        });

        const reply = await transport.request({
            uuid: UUID,
            ip: IP,
            namespace: TOGGLEX_NAMESPACE,
            method: 'GET',
            encryptionKey: ENCRYPTION_KEY
        });

        const headers = calls[0]!.init.headers as Record<string, string>;
        assert.equal(headers['Content-Type'], 'application/octet-stream');
        assert.equal(String(calls[0]!.init.body).startsWith('{'), false);
        assert.equal(reply.header.method, 'GETACK');
    });

    it('rejects a device ERROR method as CommandError without treating it as HTTP failure', async () => {
        const { transport } = createTransport(async (_url, init) => {
            const sent = decodeMessage(String(init.body), KEY);
            return jsonResponse(ackFor(sent, 'ERROR'));
        });

        await assert.rejects(
            transport.request({ uuid: UUID, ip: IP, namespace: TOGGLEX_NAMESPACE, method: 'GET' }),
            (err: unknown) => err instanceof CommandError && err.code === 'COMMAND_FAILED'
        );
    });

    it('surfaces ERROR 5001 as INVALID_KEY even when signed with the device key', async () => {
        // Wrong caller key: device signs ERROR 5001 with its own key. Without the
        // decodeMessage exception, this would land as SIGNATURE_ERROR.
        const deviceKey = 'device-owned-key';
        const { transport } = createTransport(async (_url, init) => {
            const sent = decodeMessage(String(init.body), KEY);
            return jsonResponse(encodeMessage({
                namespace: sent.header.namespace,
                method: 'ERROR',
                key: deviceKey,
                from: `/appliance/${UUID}/publish`,
                messageId: sent.header.messageId,
                timestamp: sent.header.timestamp,
                uuid: UUID,
                payload: { error: { code: 5001 } }
            }));
        });

        await assert.rejects(
            transport.request({ uuid: UUID, ip: IP, namespace: TOGGLEX_NAMESPACE, method: 'GET' }),
            (err: unknown) => err instanceof CommandError
                && err.code === 'INVALID_KEY'
                && err.deviceCode === 5001
        );
    });

    it('throws LAN_HTTP_ERROR on a non-200 status and clears pending', async () => {
        let messageId = '';
        const dispatcher = new ProtocolDispatcher();
        const { transport } = createTransport(async (_url, init) => {
            messageId = decodeMessage(String(init.body), KEY).header.messageId;
            return jsonResponse('nope', 500, 'Error');
        }, { dispatcher });

        await assert.rejects(
            transport.request({ uuid: UUID, ip: IP, namespace: TOGGLEX_NAMESPACE, method: 'GET' }),
            (err: unknown) => err instanceof TransportError && err.code === 'LAN_HTTP_ERROR'
        );
        assert.equal(dispatcher.pending.has(messageId), false);
    });

    it('throws ProtocolError on invalid JSON', async () => {
        const { transport } = createTransport(async () => jsonResponse('{not json'));

        await assert.rejects(
            transport.request({ uuid: UUID, ip: IP, namespace: TOGGLEX_NAMESPACE, method: 'GET' }),
            (err: unknown) => err instanceof ProtocolError
        );
    });

    it('throws SIGNATURE_ERROR when GETACK is signed incorrectly', async () => {
        const { transport } = createTransport(async (_url, init) => {
            const sent = decodeMessage(String(init.body), KEY);
            const ack = ackFor(sent, 'GETACK');
            ack.header.sign = '0'.repeat(32);
            return jsonResponse(ack);
        });

        await assert.rejects(
            transport.request({ uuid: UUID, ip: IP, namespace: TOGGLEX_NAMESPACE, method: 'GET' }),
            (err: unknown) => err instanceof ProtocolError && err.code === 'SIGNATURE_ERROR'
        );
    });

    it('times out after escalating 1s/2s/4s when the device never answers', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const { transport, calls } = createTransport((_url, init) => new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
                reject(abortError());
            });
        }));

        const pending = transport.request({
            uuid: UUID,
            ip: IP,
            namespace: TOGGLEX_NAMESPACE,
            method: 'GET'
        });
        // Per-uuid queue awaits the prior request before arming the abort timer.
        await flushMicrotasks();
        // 1s → 2s → 4s; a fourth attempt (8s) would outrun the pending timer.
        t.mock.timers.tick(DEFAULT_LAN_TIMEOUT_MS);
        await flushMicrotasks();
        t.mock.timers.tick(DEFAULT_LAN_TIMEOUT_MS * 2);
        await flushMicrotasks();
        t.mock.timers.tick(DEFAULT_LAN_TIMEOUT_MS * 4);
        await flushMicrotasks();
        await assert.rejects(
            pending,
            (err: unknown) =>
                err instanceof TransportError
                && err.code === 'LAN_TIMEOUT'
                && err.message === `LAN HTTP timed out after ${DEFAULT_LAN_TIMEOUT_MS * 7}ms`
        );
        assert.equal(calls.length, 3);
        assert.ok(DEFAULT_LAN_TIMEOUT_MS * 7 < DEFAULT_COMMAND_TIMEOUT_MS);
        const bodies = calls.map((call) => String(call.init.body));
        assert.equal(new Set(bodies).size, 1);
        const messageIds = bodies.map((body) => decodeMessage(body, KEY).header.messageId);
        assert.equal(new Set(messageIds).size, 1);
    });

    it('retries on AbortError and reuses the same messageId', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        let attempts = 0;
        const { transport, calls } = createTransport((_url, init) => {
            attempts++;
            if (attempts < 3) {
                return new Promise((_resolve, reject) => {
                    init.signal?.addEventListener('abort', () => {
                        reject(abortError());
                    });
                });
            }
            const sent = decodeMessage(String(init.body), KEY);
            return Promise.resolve(jsonResponse(ackFor(sent, 'GETACK')));
        });

        const pending = transport.request({
            uuid: UUID,
            ip: IP,
            namespace: TOGGLEX_NAMESPACE,
            method: 'GET'
        });
        await flushMicrotasks();
        t.mock.timers.tick(DEFAULT_LAN_TIMEOUT_MS);
        await flushMicrotasks();
        t.mock.timers.tick(DEFAULT_LAN_TIMEOUT_MS * 2);
        await flushMicrotasks();
        const reply = await pending;

        assert.equal(reply.header.method, 'GETACK');
        assert.equal(calls.length, 3);
        const messageIds = calls.map(
            (call) => decodeMessage(String(call.init.body), KEY).header.messageId
        );
        assert.equal(new Set(messageIds).size, 1);
        assert.equal(messageIds[0], reply.header.messageId);
    });

    it('maps a fetch failure to LAN_UNREACHABLE', async () => {
        const { transport } = createTransport(async () => {
            throw new Error('ECONNREFUSED');
        });
        await assert.rejects(
            transport.request({ uuid: UUID, ip: IP, namespace: TOGGLEX_NAMESPACE, method: 'GET' }),
            (err: unknown) => err instanceof TransportError && err.code === 'LAN_UNREACHABLE'
        );
    });

    it('serializes concurrent requests to one uuid in order', async () => {
        const events: string[] = [];
        let fetchCount = 0;
        let unblockFirst!: () => void;
        const firstBlocked = new Promise<void>((resolve) => {
            unblockFirst = resolve;
        });

        const { transport } = createTransport(async (_url, init) => {
            const n = ++fetchCount;
            events.push(`fetch-${n}-start`);
            const sent = decodeMessage(String(init.body), KEY);
            if (n === 1) {
                await firstBlocked;
            }
            events.push(`fetch-${n}-end`);
            return jsonResponse(ackFor(sent, 'GETACK'));
        });

        const first = transport.request({
            uuid: UUID,
            ip: IP,
            namespace: TOGGLEX_NAMESPACE,
            method: 'GET'
        });
        while (fetchCount < 1) {
            await new Promise<void>((resolve) => setImmediate(resolve));
        }

        const second = transport.request({
            uuid: UUID,
            ip: IP,
            namespace: TOGGLEX_NAMESPACE,
            method: 'GET'
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(fetchCount, 1);
        assert.deepEqual(events, ['fetch-1-start']);

        unblockFirst();
        const [firstReply, secondReply] = await Promise.all([first, second]);
        assert.equal(firstReply.header.method, 'GETACK');
        assert.equal(secondReply.header.method, 'GETACK');
        assert.deepEqual(events, [
            'fetch-1-start',
            'fetch-1-end',
            'fetch-2-start',
            'fetch-2-end'
        ]);
    });

    it('does not serialize requests across different uuids', async () => {
        let inFlight = 0;
        let peakInFlight = 0;
        const gates: Array<() => void> = [];

        const { transport } = createTransport(async (_url, init) => {
            inFlight++;
            peakInFlight = Math.max(peakInFlight, inFlight);
            const sent = decodeMessage(String(init.body), KEY);
            await new Promise<void>((resolve) => {
                gates.push(resolve);
            });
            inFlight--;
            return jsonResponse(ackFor(sent, 'GETACK'));
        });

        const first = transport.request({
            uuid: UUID,
            ip: IP,
            namespace: TOGGLEX_NAMESPACE,
            method: 'GET'
        });
        const second = transport.request({
            uuid: '00000000-0000-4000-8000-000000000002',
            ip: '192.168.1.51',
            namespace: TOGGLEX_NAMESPACE,
            method: 'GET'
        });

        while (gates.length < 2) {
            await new Promise<void>((resolve) => setImmediate(resolve));
        }
        assert.equal(peakInFlight, 2);
        for (const release of gates) {
            release();
        }
        await Promise.all([first, second]);
    });

    it('releases the per-uuid queue after a failed attempt', async () => {
        let calls = 0;
        const { transport } = createTransport(async (_url, init) => {
            calls++;
            if (calls === 1) {
                throw new Error('ECONNREFUSED');
            }
            const sent = decodeMessage(String(init.body), KEY);
            return jsonResponse(ackFor(sent, 'GETACK'));
        });

        await assert.rejects(
            transport.request({ uuid: UUID, ip: IP, namespace: TOGGLEX_NAMESPACE, method: 'GET' }),
            (err: unknown) => err instanceof TransportError && err.code === 'LAN_UNREACHABLE'
        );

        const reply = await transport.request({
            uuid: UUID,
            ip: IP,
            namespace: TOGGLEX_NAMESPACE,
            method: 'GET'
        });
        assert.equal(calls, 2);
        assert.equal(reply.header.method, 'GETACK');
    });
});
