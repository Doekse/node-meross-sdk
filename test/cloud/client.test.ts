import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { CloudClient, encodeCloudParams, signCloudRequest } from '../../src/cloud/client';
import { AuthError, CloudError } from '../../src/errors';
import type { TokenData } from '../../src/session';
import { jsonResponse, ok } from '../helpers/http';

const EMAIL = 'you@example.com';
const PASSWORD = 'plain-secret';
const NOW = 1_700_000_000_000;
const NONCE = 'ABCDEFGH01234567';
const SIGN_IN = 'https://iotx.meross.com/v1/Auth/signIn';

const LOGIN_DATA = {
    token: 'stub-token',
    key: 'stub-key',
    userid: '42',
    email: EMAIL,
    domain: 'https://iotx-eu.meross.com',
    mqttDomain: 'eu-iotx.meross.com'
};

const DEVICE_ROW = {
    uuid: '00000000-0000-4000-8000-000000000001',
    devName: 'Kitchen plug',
    deviceType: 'mss310',
    onlineStatus: 1,
    channels: [{ channel: 0, devName: 'ch0' }],
    domain: 'eu-iotx.meross.com',
    fmwareVersion: '6.1.8',
    hdwareVersion: '4.0.0',
    region: 'eu'
};

describe('cloud request signing', () => {
    it('encodes params as URL-safe base64 JSON', () => {
        assert.equal(encodeCloudParams({ email: 'a@b.c' }), 'eyJlbWFpbCI6ImFAYi5jIn0=');
    });

    it('signs timestamp, nonce, and params as lowercase MD5 hex', () => {
        const encoded = encodeCloudParams({ email: 'a@b.c' });
        assert.equal(signCloudRequest(NOW, NONCE, encoded), 'a1a92c7ffa12d2e2c9b0f1ca14c64e98');
    });
});

describe('CloudClient.login', () => {
    it('POSTs a signed signIn body with an MD5 password and optional MFA', async () => {
        const calls: Array<{ url: string; init: RequestInit }> = [];
        await CloudClient.login(
            { email: EMAIL, password: PASSWORD, mfaCode: '123456' },
            {
                now: () => NOW,
                nonce: () => NONCE,
                fetch: async (url, init) => {
                    calls.push({ url: String(url), init: init ?? {} });
                    return ok(LOGIN_DATA);
                }
            }
        );

        assert.equal(calls.length, 1);
        assert.equal(calls[0]!.url, SIGN_IN);
        assert.equal(calls[0]!.init.method, 'POST');
        const headers = calls[0]!.init.headers as Record<string, string>;
        assert.equal(headers.Authorization, undefined);
        assert.equal(headers.Vendor, 'meross');

        const body = JSON.parse(String(calls[0]!.init.body)) as {
            params: string;
            sign: string;
            timestamp: number;
            nonce: string;
        };
        assert.equal(body.timestamp, NOW);
        assert.equal(body.nonce, NONCE);
        assert.equal(body.sign, signCloudRequest(NOW, NONCE, body.params));

        const params = JSON.parse(Buffer.from(body.params, 'base64').toString('utf8')) as {
            email: string;
            password: string;
            encryption: number;
            mfaCode: string;
        };
        assert.equal(params.email, EMAIL);
        assert.equal(params.password, createHash('md5').update(PASSWORD).digest('hex'));
        assert.equal(params.encryption, 1);
        assert.equal(params.mfaCode, '123456');
    });

    it('maps signIn data onto persistable TokenData', async () => {
        const client = await CloudClient.login(
            { email: EMAIL, password: PASSWORD },
            {
                now: () => NOW,
                nonce: () => NONCE,
                fetch: async () => ok(LOGIN_DATA)
            }
        );

        assert.deepEqual(client.getToken(), {
            token: 'stub-token',
            key: 'stub-key',
            userId: '42',
            userEmail: EMAIL,
            domain: 'iotx-eu.meross.com',
            mqttDomain: 'eu-iotx.meross.com',
            issuedOn: new Date(NOW).toISOString()
        });
    });

    it('uses global fetch when no fetch option is injected', async (t) => {
        const fetchMock = t.mock.method(globalThis, 'fetch', async () => ok(LOGIN_DATA));
        const client = await CloudClient.login({ email: EMAIL, password: PASSWORD });
        assert.equal(fetchMock.mock.callCount(), 1);
        assert.equal(String(fetchMock.mock.calls[0]!.arguments[0]), SIGN_IN);
        assert.equal(client.getToken().token, 'stub-token');
    });

    it('retries signIn on the redirected region from apiStatus 1030', async () => {
        const urls: string[] = [];
        const client = await CloudClient.login(
            { email: EMAIL, password: PASSWORD },
            {
                fetch: async (url) => {
                    urls.push(String(url));
                    if (urls.length === 1) {
                        return jsonResponse({
                            apiStatus: 1030,
                            data: {
                                domain: 'https://iotx-us.meross.com',
                                mqttDomain: 'us-iotx.meross.com'
                            }
                        });
                    }
                    return ok({
                        ...LOGIN_DATA,
                        domain: 'https://iotx-us.meross.com',
                        mqttDomain: 'us-iotx.meross.com'
                    });
                }
            }
        );

        assert.deepEqual(urls, [
            SIGN_IN,
            'https://iotx-us.meross.com/v1/Auth/signIn'
        ]);
        assert.equal(client.getToken().domain, 'iotx-us.meross.com');
        assert.equal(client.getToken().mqttDomain, 'us-iotx.meross.com');
    });

    it('stops after three region redirects', async () => {
        let hits = 0;
        await assert.rejects(
            () => CloudClient.login(
                { email: EMAIL, password: PASSWORD },
                {
                    fetch: async () => {
                        hits += 1;
                        return jsonResponse({
                            apiStatus: 1030,
                            data: {
                                domain: 'https://iotx-eu.meross.com',
                                mqttDomain: 'eu-iotx.meross.com'
                            }
                        });
                    }
                }
            ),
            (err: unknown) => err instanceof CloudError
                && err.code === 'BAD_DOMAIN'
                && err.domain === 'iotx-eu.meross.com'
                && err.mqttDomain === 'eu-iotx.meross.com'
        );
        assert.equal(hits, 4);
    });

    it('maps MFA required apiStatus to AuthError', async () => {
        await assert.rejects(
            () => CloudClient.login(
                { email: EMAIL, password: PASSWORD },
                { fetch: async () => jsonResponse({ apiStatus: 1033, info: '' }) }
            ),
            (err: unknown) => err instanceof AuthError && err.code === 'MFA_REQUIRED' && err.apiStatus === 1033
        );
    });

    it('maps a wrong MFA code to AuthError', async () => {
        await assert.rejects(
            () => CloudClient.login(
                { email: EMAIL, password: PASSWORD, mfaCode: '000000' },
                { fetch: async () => jsonResponse({ apiStatus: 1032 }) }
            ),
            (err: unknown) => err instanceof AuthError && err.code === 'MFA_WRONG'
        );
    });

    it('maps bad credentials to AuthError', async () => {
        await assert.rejects(
            () => CloudClient.login(
                { email: EMAIL, password: 'nope' },
                { fetch: async () => jsonResponse({ apiStatus: 1004 }) }
            ),
            (err: unknown) => err instanceof AuthError && err.code === 'AUTHENTICATION'
        );
    });

    it('rejects a missing email before fetch', async () => {
        const fetchImpl = async (): Promise<Response> => {
            throw new Error('fetch must not be called');
        };

        await assert.rejects(
            () => CloudClient.login({ email: '', password: PASSWORD }, { fetch: fetchImpl }),
            (err: unknown) => err instanceof AuthError && err.code === 'AUTHENTICATION'
        );
    });

    it('rejects a missing password before fetch', async () => {
        const fetchImpl = async (): Promise<Response> => {
            throw new Error('fetch must not be called');
        };

        await assert.rejects(
            () => CloudClient.login({ email: EMAIL, password: '' }, { fetch: fetchImpl }),
            (err: unknown) => err instanceof AuthError && err.code === 'AUTHENTICATION'
        );
    });
});

describe('CloudClient.restore and device list', () => {
    const saved: TokenData = {
        token: 'saved-token',
        key: 'saved-key',
        userId: '42',
        userEmail: EMAIL,
        domain: 'https://iotx-eu.meross.com',
        mqttDomain: 'eu-iotx.meross.com',
        issuedOn: '2026-01-02T03:04:05.000Z'
    };

    it('restores TokenData without a password and strips https from domain', () => {
        const client = CloudClient.restore(saved);
        assert.deepEqual(client.getToken(), {
            token: 'saved-token',
            key: 'saved-key',
            userId: '42',
            userEmail: EMAIL,
            domain: 'iotx-eu.meross.com',
            mqttDomain: 'eu-iotx.meross.com',
            issuedOn: '2026-01-02T03:04:05.000Z'
        });
    });

    it('lists devices over HTTP with the restored Basic token', async () => {
        const calls: Array<{ url: string; init: RequestInit }> = [];
        const client = CloudClient.restore(saved, {
            now: () => NOW,
            nonce: () => NONCE,
            fetch: async (url, init) => {
                calls.push({ url: String(url), init: init ?? {} });
                return ok([DEVICE_ROW]);
            }
        });

        const devices = await client.listDevices();
        assert.equal(calls.length, 1);
        assert.equal(calls[0]!.url, 'https://iotx-eu.meross.com/v1/Device/devList');
        const headers = calls[0]!.init.headers as Record<string, string>;
        assert.equal(headers.Authorization, 'Basic saved-token');

        const body = JSON.parse(String(calls[0]!.init.body)) as { params: string };
        assert.deepEqual(JSON.parse(Buffer.from(body.params, 'base64').toString('utf8')), {});
        assert.deepEqual(devices, [DEVICE_ROW]);
    });

    it('lists hub subdevices by uuid', async () => {
        const client = CloudClient.restore(saved, {
            fetch: async (url) => {
                assert.equal(String(url), 'https://iotx-eu.meross.com/v1/Hub/getSubDevices');
                return ok([{
                    subDeviceId: '0001',
                    subDeviceType: 'ms100',
                    subDeviceName: 'Hall sensor',
                    subDeviceVendor: 'meross'
                }]);
            }
        });
        const subs = await client.listSubDevices('hub-uuid');
        assert.equal(subs.length, 1);
        assert.equal(subs[0]!.subDeviceId, '0001');
        assert.equal(subs[0]!.subDeviceType, 'ms100');
    });

    it('rejects device list when no token is present', async () => {
        const client = new CloudClient({
            fetch: async () => {
                throw new Error('fetch must not be called');
            }
        });
        await assert.rejects(
            () => client.listDevices(),
            (err: unknown) => err instanceof AuthError && err.code === 'AUTHENTICATION'
        );
    });

    it('maps expired-token apiStatus from device list', async () => {
        const client = CloudClient.restore(saved, {
            fetch: async () => jsonResponse({ apiStatus: 1200 })
        });
        await assert.rejects(
            () => client.listDevices(),
            (err: unknown) => err instanceof AuthError && err.code === 'TOKEN_EXPIRED' && err.apiStatus === 1200
        );
    });

    it('maps HTTP failures to CloudError', async () => {
        const httpClient = CloudClient.restore(saved, {
            fetch: async () => jsonResponse('nope', 503, 'Service Unavailable')
        });

        await assert.rejects(
            () => httpClient.listDevices(),
            (err: unknown) => err instanceof CloudError && err.code === 'HTTP_ERROR' && err.httpStatus === 503
        );
    });

    it('maps a hanging request to NETWORK_TIMEOUT', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const hanging = CloudClient.restore(saved, {
            timeoutMs: 1_000,
            fetch: async (_url, init) => new Promise((_resolve, reject) => {
                const abort = (): void => {
                    const err = new Error('aborted');
                    err.name = 'AbortError';
                    reject(err);
                };
                init?.signal?.addEventListener('abort', abort);
            })
        });
        const pending = hanging.listDevices();
        await Promise.resolve();
        t.mock.timers.tick(1_000);

        await assert.rejects(
            pending,
            (err: unknown) => err instanceof CloudError && err.code === 'NETWORK_TIMEOUT'
        );
    });
});
