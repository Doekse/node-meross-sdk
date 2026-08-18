import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CommandError, ProtocolError, TransportError } from '../../src/errors';
import {
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

function jsonResponse(body: unknown, status = 200, statusText = 'OK'): Response {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return {
        status,
        statusText,
        ok: status === 200,
        async text() {
            return text;
        }
    } as Response;
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

    it('throws ProtocolError on invalid JSON or a bad signature', async () => {
        const { transport: badJson } = createTransport(async () => jsonResponse('{not json'));
        await assert.rejects(
            badJson.request({ uuid: UUID, ip: IP, namespace: TOGGLEX_NAMESPACE, method: 'GET' }),
            (err: unknown) => err instanceof ProtocolError
        );

        const { transport: badSign } = createTransport(async (_url, init) => {
            const sent = decodeMessage(String(init.body), KEY);
            const ack = ackFor(sent, 'GETACK');
            ack.header.sign = '0'.repeat(32);
            return jsonResponse(ack);
        });
        await assert.rejects(
            badSign.request({ uuid: UUID, ip: IP, namespace: TOGGLEX_NAMESPACE, method: 'GET' }),
            (err: unknown) => err instanceof ProtocolError && err.code === 'SIGNATURE_ERROR'
        );
    });

    it('times out when the device never answers', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const { transport } = createTransport((_url, init) => new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
                const error = new Error('aborted');
                error.name = 'AbortError';
                reject(error);
            });
        }));

        const pending = transport.request({
            uuid: UUID,
            ip: IP,
            namespace: TOGGLEX_NAMESPACE,
            method: 'GET'
        });
        t.mock.timers.tick(DEFAULT_LAN_TIMEOUT_MS);
        await assert.rejects(
            pending,
            (err: unknown) => err instanceof TransportError && err.code === 'LAN_TIMEOUT'
        );
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
});
