/**
 * Opt-in host sink for transport traffic the SDK cannot expose via wrappable
 * fetch/mqtt hooks — LAN uses node:http, and cloud sign-in runs before Session
 * exists. Homey (or any host) owns DEBUG gating; this module never reads env.
 */

export type LogLevel = 'debug' | 'error';

export type LogChannel = 'mqtt' | 'lan' | 'cloud';

/** Present when the record is request/response traffic. */
export type LogDirection = 'tx' | 'rx';

/**
 * Host-formatted line. Optional traffic fields exist because LAN HTTP and
 * cloud sign-in are not visible through a wrappable fetch/mqtt hook.
 */
export interface LogRecord {
    level: LogLevel;
    channel: LogChannel;
    message: string;
    direction?: LogDirection;
    /** MQTT topic or LAN/cloud URL — never an Authorization header. */
    target?: string;
    /**
     * Plaintext JSON (pre-encrypt / post-decrypt for LAN; decoded params for
     * cloud). Never ciphertext or raw base64.
     */
    data?: string;
}

/** Host callback; {@link emitLog} is a no-op when this is omitted. */
export type SessionLogger = (record: LogRecord) => void;

const SECRET_KEYS = new Set(['password', 'token', 'key', 'mfaCode']);
const REDACTED = '[REDACTED]';

/**
 * Invokes the host sink without letting a throwing callback fail the request.
 */
export function emitLog(logger: SessionLogger | undefined, record: LogRecord): void {
    if (!logger) {
        return;
    }
    try {
        logger(record);
    } catch {
        // Host logging must not break MQTT/LAN/cloud I/O.
    }
}

/**
 * Replaces cloud credential fields so debug dumps stay useful without
 * leaking secrets. Returns a new structure; the input is never mutated.
 */
export function redactSecrets(value: unknown): unknown {
    if (value === null || typeof value !== 'object') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(redactSecrets);
    }
    const copy: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
        copy[key] = SECRET_KEYS.has(key) ? REDACTED : redactSecrets(nested);
    }
    return copy;
}
