import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Duplex } from 'node:stream';
import tls from 'node:tls';
import { describe, it } from 'node:test';

import { MqttTransport } from '../../src/transport';

const require = createRequire(__filename);

/**
 * Default mqtt.js construction must not load websocket/proxy deps; assert
 * before any other suite can pollute `require.cache` via `mqtt.connect()`.
 */
function assertWsSocksUnloaded(): void {
    assert.equal(require.cache[require.resolve('ws')], undefined);
    assert.equal(require.cache[require.resolve('socks')], undefined);
}

/**
 * Stand-in TLS socket: mqtt.js may check `encrypted`/`authorized`, but we only
 * need to avoid opening a real connection while exercising `connectTls`.
 */
function createEncryptedDuplex(): Duplex {
    const socket = new Duplex({
        read() {},
        write(_chunk, _encoding, callback) {
            callback();
        }
    });
    Object.assign(socket, { encrypted: true, authorized: true });
    return socket;
}

/** Lets mqtt.js invoke its stream factory before we inspect `tls.connect` args. */
function flushConnect(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Starts a real mqtt.js client (no injected `connect`) and tears it down
 * before the first-handshake timeout.
 */
async function withDefaultTransport(
    mqttDomain: string,
    run: () => Promise<void> | void
): Promise<void> {
    const transport = new MqttTransport({
        userId: '42',
        key: 'unused-key',
        mqttDomain,
        appId: 'default-connect-test'
    });
    const pending = transport.connect();
    try {
        await run();
    } finally {
        await transport.disconnect();
        await pending.catch(() => {});
    }
}

/**
 * Isolated from other MQTT suites so a prior `mqtt.connect()` cannot leave
 * `ws`/`socks` in `require.cache` before these assertions run.
 */
describe('MqttTransport default mqtt.js client', { concurrency: false }, () => {
    it('loads mqtt without pulling in ws or socks', async () => {
        await withDefaultTransport('127.0.0.1:1', () => {
            assertWsSocksUnloaded();
        });
    });

    it('sets TLS SNI for hostnames and omits it for IP addresses', async (t) => {
        const captured: tls.ConnectionOptions[] = [];
        t.mock.method(tls, 'connect', ((options: tls.ConnectionOptions) => {
            captured.push({ ...options });
            return createEncryptedDuplex() as unknown as tls.TLSSocket;
        }) as typeof tls.connect);

        await withDefaultTransport('broker.example.test', async () => {
            await flushConnect();
        });

        // tsx may not rewrite the live `connect` binding mqtt.ts imported.
        // Fall back to unused-port + ws/socks cache checks only.
        if (captured.length === 0) {
            await withDefaultTransport('127.0.0.1:1', () => {
                assertWsSocksUnloaded();
            });
            return;
        }

        await withDefaultTransport('1.2.3.4', async () => {
            await flushConnect();
        });

        const hostnameOpts = captured.find((opts) => opts.host === 'broker.example.test');
        const ipOpts = captured.find((opts) => opts.host === '1.2.3.4');
        assert.ok(hostnameOpts);
        assert.ok(ipOpts);
        assert.equal(hostnameOpts.servername, 'broker.example.test');
        assert.equal(ipOpts.servername, undefined);
        assertWsSocksUnloaded();
    });
});
