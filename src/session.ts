import type { Endpoint } from './endpoint';
import { NotImplementedError } from './errors';
import { Inventory } from './inventory';

export interface LoginOptions {
    email: string;
    password: string;
    mfaCode?: string;
}

export interface TokenData {
    token: string;
    key: string;
    userId: string;
    userEmail?: string;
    domain: string;
    mqttDomain: string;
    issuedOn?: string;
}

/**
 * Cloud credentials plus live inventory. Homey persists {@link TokenData}
 * via `storeData` and rebuilds a session with {@link Session.restore}.
 */
export class Session {
    readonly inventory: Inventory;
    private readonly token: TokenData | null;

    private constructor(token: TokenData | null = null) {
        this.inventory = new Inventory();
        this.token = token;
    }

    /**
     * Exchanges email/password (and optional MFA) for a session.
     */
    static async login(_options: LoginOptions): Promise<Session> {
        throw new NotImplementedError('Session.login');
    }

    /**
     * Rebuilds a session from a previously stored token without a password.
     */
    static restore(_token: TokenData): Session {
        throw new NotImplementedError('Session.restore');
    }

    /**
     * Returns a copy of the stored token so callers can persist it safely.
     */
    getToken(): TokenData | null {
        if (this.token === null) {
            return null;
        }
        return { ...this.token };
    }

    /**
     * Opens MQTT/LAN transports after login or restore.
     */
    async connect(): Promise<void> {
        throw new NotImplementedError('Session.connect');
    }

    /**
     * Closes transports without discarding the stored token.
     */
    async disconnect(): Promise<void> {
        throw new NotImplementedError('Session.disconnect');
    }

    /**
     * Returns the Homey-facing device for an inventory row id.
     */
    endpoint(_id: string): Endpoint {
        throw new NotImplementedError('Session.endpoint');
    }
}
