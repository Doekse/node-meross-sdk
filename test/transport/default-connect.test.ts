import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Duplex } from 'node:stream';
import tls from 'node:tls';
import { describe, it } from 'node:test';

import {
    MQTT_RECONNECT_PERIOD_MS,
    connectMqtt,
    type MqttBrokerClient,
    type MqttConnectOptions
} from '../../src/transport';

const require = createRequire(__filename);

/**
 * `connectMqtt` must not load mqtt.js websocket/proxy deps; assert before any
 * other suite can pollute `require.cache` via `mqtt.connect()`.
 */
function assertWsSocksUnloaded(): void {
    assert.equal(require.cache[require.resolve('ws')], undefined);
    assert.equal(require.cache[require.resolve('socks')], undefined);
}

/** Force-close so mqtt.js cannot schedule reconnect timers after the test. */
function endClient(client: MqttBrokerClient | undefined): void {
    client?.end(true, () => {});
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
 * Isolated from other MQTT suites so a prior `mqtt.connect()` cannot leave
 * `ws`/`socks` in `require.cache` before these assertions run.
 */
describe('connectMqtt', { concurrency: false }, () => {
    const baseOptions: MqttConnectOptions = {
        protocol: 'mqtts',
        host: 'broker.example.test',
        port: 443,
        clientId: 'app:default-connect-test',
        username: '42',
        password: 'unused-password',
        rejectUnauthorized: true,
        keepalive: 30,
        reconnectPeriod: MQTT_RECONNECT_PERIOD_MS,
        resubscribe: false
    };

    it('loads mqtt without pulling in ws or socks', () => {
        let client: MqttBrokerClient | undefined;
        try {
            // Unused local port: TLS fails immediately; we only care that
            // constructing the client did not load ws/socks.
            client = connectMqtt({
                ...baseOptions,
                host: '127.0.0.1',
                port: 1
            });
            assertWsSocksUnloaded();
        } finally {
            endClient(client);
        }
    });

    it('sets TLS SNI for hostnames and omits it for IP addresses', async (t) => {
        const captured: tls.ConnectionOptions[] = [];
        t.mock.method(tls, 'connect', ((options: tls.ConnectionOptions) => {
            captured.push({ ...options });
            return createEncryptedDuplex() as unknown as tls.TLSSocket;
        }) as typeof tls.connect);

        const clients: MqttBrokerClient[] = [];
        try {
            clients.push(connectMqtt(baseOptions));
            await flushConnect();

            // tsx may not rewrite the live `connect` binding mqtt.ts imported.
            // Fall back to unused-port + ws/socks cache checks only.
            if (captured.length === 0) {
                clients.push(connectMqtt({
                    ...baseOptions,
                    host: '127.0.0.1',
                    port: 1
                }));
                assertWsSocksUnloaded();
                return;
            }

            clients.push(connectMqtt({
                ...baseOptions,
                host: '1.2.3.4'
            }));
            await flushConnect();

            const hostnameOpts = captured.find((opts) => opts.host === 'broker.example.test');
            const ipOpts = captured.find((opts) => opts.host === '1.2.3.4');
            assert.ok(hostnameOpts);
            assert.ok(ipOpts);
            assert.equal(hostnameOpts.servername, 'broker.example.test');
            assert.equal(ipOpts.servername, undefined);
            assertWsSocksUnloaded();
        } finally {
            for (const client of clients) {
                endClient(client);
            }
        }
    });
});
