/**
 * Base error so hosts can instanceof-check as the kernel grows.
 */
export class MerossError extends Error {
    readonly code: string;

    constructor(message: string, code = 'MEROSS_ERROR') {
        super(message);
        this.name = 'MerossError';
        this.code = code;
    }
}

/**
 * Unimplemented public API surface.
 */
export class NotImplementedError extends MerossError {
    constructor(feature: string) {
        super(`${feature} is not implemented yet`, 'NOT_IMPLEMENTED');
        this.name = 'NotImplementedError';
    }
}

/**
 * Malformed envelope or signature mismatch. Not a public export yet.
 */
export class ProtocolError extends MerossError {
    constructor(message: string, code = 'PROTOCOL_ERROR') {
        super(message, code);
        this.name = 'ProtocolError';
    }
}

/**
 * Command timeout, device ERROR method, or a cancelled pending request.
 * Wrong-key replies use code `INVALID_KEY` with `deviceCode` 5001.
 * Not a public export until Session surfaces command failures to hosts.
 */
export class CommandError extends MerossError {
    /** Firmware `payload.error.code` when the device replied with method ERROR. */
    readonly deviceCode?: number;

    constructor(message: string, code = 'COMMAND_FAILED', deviceCode?: number) {
        super(message, code);
        this.name = 'CommandError';
        this.deviceCode = deviceCode;
    }
}

/**
 * Wrong credentials, MFA, or an expired/incomplete token from the cloud HTTP API.
 */
export class AuthError extends MerossError {
    readonly apiStatus?: number;

    constructor(message: string, code = 'AUTHENTICATION', apiStatus?: number) {
        super(message, code);
        this.name = 'AuthError';
        this.apiStatus = apiStatus;
    }
}

/**
 * Cloud HTTP transport failure, region redirect exhaustion, or a non-auth apiStatus.
 */
export class CloudError extends MerossError {
    readonly apiStatus?: number;
    readonly httpStatus?: number;
    readonly domain?: string;
    readonly mqttDomain?: string;

    constructor(
        message: string,
        code = 'CLOUD_ERROR',
        extras: {
            apiStatus?: number;
            httpStatus?: number;
            domain?: string;
            mqttDomain?: string;
        } = {}
    ) {
        super(message, code);
        this.name = 'CloudError';
        this.apiStatus = extras.apiStatus;
        this.httpStatus = extras.httpStatus;
        this.domain = extras.domain;
        this.mqttDomain = extras.mqttDomain;
    }
}

/**
 * MQTT or LAN HTTP connect/publish failure. Not a public export yet.
 */
export class TransportError extends MerossError {
    constructor(message: string, code = 'TRANSPORT_ERROR') {
        super(message, code);
        this.name = 'TransportError';
    }
}
