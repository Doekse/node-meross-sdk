import { createHash, randomBytes } from 'node:crypto';

import { AuthError, CloudError } from '../errors';
import type { LoginOptions, TokenData } from '../session';

/** Well-known app secret; not an account credential. */
const SECRET = '23x17ahWarFH6w29';

const LOGIN_PATH = '/v1/Auth/signIn';
const DEV_LIST_PATH = '/v1/Device/devList';
const SUBDEV_LIST_PATH = '/v1/Hub/getSubDevices';

export interface CloudClientOptions {
    timeoutMs?: number;
    fetch?: typeof globalThis.fetch;
    now?: () => number;
    nonce?: () => string;
}

/** Cloud `/Device/devList` row. Graph maps this onto endpoints later. */
export interface CloudDevice {
    uuid: string;
    devName: string;
    deviceType: string;
    onlineStatus: number;
    channels: unknown[];
    domain?: string;
    reservedDomain?: string;
    fmwareVersion?: string;
    hdwareVersion?: string;
    subType?: string;
    region?: string;
}

/** Cloud `/Hub/getSubDevices` row. Hub children share Endpoint with `parentId`. */
export interface CloudSubDevice {
    subDeviceId: string;
    subDeviceType: string;
    subDeviceName: string;
    subDeviceVendor?: string;
    subDeviceIconId?: string;
}

/**
 * Cloud POSTs send parameters as base64(JSON), not a raw JSON body.
 */
export function encodeCloudParams(params: Record<string, unknown>): string {
    return Buffer.from(JSON.stringify(params)).toString('base64');
}

/**
 * Sign is MD5(secret + timestampMillis + nonce + encoded params).
 */
export function signCloudRequest(timestamp: number, nonce: string, encodedParams: string): string {
    return createHash('md5')
        .update(`${SECRET}${timestamp}${nonce}${encodedParams}`)
        .digest('hex');
}

/**
 * Signs Meross HTTP calls and follows region redirects so Session can
 * persist TokenData without talking to MQTT yet.
 */
export class CloudClient {
    private readonly timeoutMs: number;
    private readonly fetchImpl: typeof globalThis.fetch;
    private readonly now: () => number;
    private readonly nonce: () => string;
    private creds: TokenData | null = null;
    private httpDomain = 'iotx.meross.com';
    private mqttDomain = '';

    constructor(options: CloudClientOptions = {}) {
        this.timeoutMs = options.timeoutMs ?? 10_000;
        this.fetchImpl = options.fetch ?? globalThis.fetch;
        this.now = options.now ?? Date.now;
        this.nonce = options.nonce ?? (() => randomBytes(8).toString('hex'));
    }

    /**
     * Exchanges email/password (and optional MFA) for a client that can
     * list devices. Session.login stays stubbed until the wiring slice.
     */
    static async login(options: LoginOptions, clientOptions?: CloudClientOptions): Promise<CloudClient> {
        const client = new CloudClient(clientOptions);
        await client.login(options);
        return client;
    }

    /**
     * Rebuilds an HTTP client from Homey `storeData` without a password.
     */
    static restore(token: TokenData, clientOptions?: CloudClientOptions): CloudClient {
        const client = new CloudClient(clientOptions);
        client.restore(token);
        return client;
    }

    async login(options: LoginOptions): Promise<TokenData> {
        if (!options.email || !options.password) {
            throw new AuthError(!options.email ? 'Email missing' : 'Password missing');
        }

        const data = await this.post(LOGIN_PATH, {
            email: options.email,
            password: createHash('md5').update(options.password).digest('hex'),
            encryption: 1,
            accountCountryCode: '--',
            agree: 1,
            ...(options.mfaCode ? { mfaCode: options.mfaCode } : {})
        }) as Record<string, string> | null;

        if (!data?.token || !data.key || !data.userid) {
            throw new CloudError('Login response is missing token');
        }

        this.httpDomain = data.domain ? host(data.domain) : this.httpDomain;
        this.mqttDomain = data.mqttDomain ? host(data.mqttDomain) : this.mqttDomain;
        this.creds = {
            token: data.token,
            key: data.key,
            userId: data.userid,
            userEmail: data.email,
            domain: this.httpDomain,
            mqttDomain: this.mqttDomain,
            issuedOn: new Date(this.now()).toISOString()
        };
        return { ...this.creds };
    }

    restore(token: TokenData): void {
        if (!token.token || !token.key || !token.userId || !token.domain) {
            throw new AuthError('Token data is incomplete');
        }
        this.httpDomain = host(token.domain);
        this.mqttDomain = token.mqttDomain ? host(token.mqttDomain) : '';
        this.creds = {
            ...token,
            domain: this.httpDomain,
            mqttDomain: this.mqttDomain
        };
    }

    getToken(): TokenData {
        if (!this.creds) {
            throw new AuthError('Not authenticated');
        }
        return { ...this.creds };
    }

    async listDevices(): Promise<CloudDevice[]> {
        if (!this.creds) {
            throw new AuthError('Not authenticated');
        }
        return (await this.post(DEV_LIST_PATH, {}) ?? []) as CloudDevice[];
    }

    async listSubDevices(hubUuid: string): Promise<CloudSubDevice[]> {
        if (!this.creds) {
            throw new AuthError('Not authenticated');
        }
        return (await this.post(SUBDEV_LIST_PATH, { uuid: hubUuid }) ?? []) as CloudSubDevice[];
    }

    private async post(
        path: string,
        params: Record<string, unknown>,
        redirectCount = 0
    ): Promise<unknown> {
        const timestamp = this.now();
        const nonce = this.nonce();
        const encoded = encodeCloudParams(params);
        const headers: Record<string, string> = {
            Vendor: 'meross',
            AppVersion: '3.22.4',
            AppType: 'iOS',
            AppLanguage: 'en',
            'User-Agent': 'intellect_socket/3.22.4 (iPhone; iOS 17.2; Scale/2.00)',
            'Content-Type': 'application/json'
        };
        if (this.creds) {
            headers.Authorization = `Basic ${this.creds.token}`;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
        let response: Response;
        try {
            response = await this.fetchImpl(`https://${this.httpDomain}${path}`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    params: encoded,
                    sign: signCloudRequest(timestamp, nonce, encoded),
                    timestamp,
                    nonce
                }),
                signal: controller.signal
            });
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                throw new CloudError('Cloud request timed out', 'NETWORK_TIMEOUT');
            }
            const message = error instanceof Error ? error.message : String(error);
            throw new CloudError(`Cloud request failed: ${message}`, 'NETWORK_ERROR');
        } finally {
            clearTimeout(timeoutId);
        }

        if (response.status === 401) {
            throw new AuthError('Unauthorized', 'TOKEN_EXPIRED');
        }
        if (response.status !== 200) {
            throw new CloudError(`HTTP ${response.status}: ${response.statusText}`, 'HTTP_ERROR', {
                httpStatus: response.status
            });
        }

        let body: { apiStatus?: number; info?: string; data?: unknown };
        try {
            body = JSON.parse(await response.text()) as typeof body;
        } catch {
            throw new CloudError('Cloud response is not valid JSON');
        }

        if (body.apiStatus === 0) {
            return body.data ?? null;
        }
        if (body.apiStatus === 1030) {
            const redirect = body.data as { domain?: string; mqttDomain?: string } | undefined;
            if (!redirect?.domain) {
                throw new CloudError('Region redirect is missing a domain', 'BAD_DOMAIN', { apiStatus: 1030 });
            }
            const nextHost = host(redirect.domain);
            const nextMqtt = redirect.mqttDomain ? host(redirect.mqttDomain) : '';
            if (redirectCount >= 3) {
                throw new CloudError('Max retries (3) exceeded for domain redirect', 'BAD_DOMAIN', {
                    apiStatus: 1030,
                    domain: nextHost,
                    mqttDomain: nextMqtt
                });
            }
            this.httpDomain = nextHost;
            if (nextMqtt) {
                this.mqttDomain = nextMqtt;
            }
            return this.post(path, params, redirectCount + 1);
        }

        throw apiError(body.apiStatus, body.info);
    }
}

/**
 * TokenData and 1030 redirects mix hostnames with `https://` origins.
 */
function host(domain: string): string {
    return domain.replace(/^https?:\/\//, '');
}

function apiError(apiStatus: number | undefined, info: string | undefined): AuthError | CloudError {
    const message = info || `API error ${apiStatus ?? 'unknown'}`;
    if (apiStatus === undefined) {
        return new CloudError(message);
    }
    const authCode = AUTH_CODES[apiStatus]
        ?? (apiStatus >= 1000 && apiStatus <= 1008 ? 'AUTHENTICATION' : undefined);
    if (authCode) {
        return new AuthError(message, authCode, apiStatus);
    }
    return new CloudError(message, 'API_ERROR', { apiStatus });
}

const AUTH_CODES: Record<number, string> = {
    1019: 'TOKEN_EXPIRED',
    1022: 'TOKEN_EXPIRED',
    1032: 'MFA_WRONG',
    1033: 'MFA_REQUIRED',
    1200: 'TOKEN_EXPIRED',
    1301: 'TOO_MANY_TOKENS'
};
