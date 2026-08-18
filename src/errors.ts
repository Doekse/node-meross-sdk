/**
 * Base error so Homey can instanceof-check as the kernel grows.
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
 * Thrown by frozen-API stubs until login, MQTT, LAN, and traits are implemented.
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
