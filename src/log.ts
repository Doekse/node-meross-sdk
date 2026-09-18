/**
 * Opt-in host sink for transport traffic the SDK cannot expose via wrappable
 * fetch/mqtt hooks — LAN uses node:http, and cloud sign-in runs before Session
 * exists. Homey (or any host) owns DEBUG gating; this module never reads env.
 */

export type LogLevel = 'error' | 'debug' | 'trace';

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

/** Numeric ranks so floor checks never string-compare (`'debug' < 'error'`). */
const LOG_LEVEL_RANK: Record<LogLevel, number> = {
    error: 0,
    debug: 1,
    trace: 2
};

const SECRET_KEYS = new Set(['password', 'token', 'key', 'mfaCode']);
const REDACTED = '[REDACTED]';

/**
 * Whether `level` should emit when the host floor is `floor`.
 * Omitted floor resolves to `debug` — the same default {@link emitTraffic} uses.
 */
export function isLogEnabled(floor: LogLevel | undefined, level: LogLevel): boolean {
    const resolved = floor ?? 'debug';
    return LOG_LEVEL_RANK[level] <= LOG_LEVEL_RANK[resolved];
}

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
 * Traffic fields plus a lazy body. `data` runs only when the floor is `trace`.
 */
interface TrafficInput {
    channel: LogChannel;
    message: string;
    direction: LogDirection;
    target?: string;
    data: () => string;
}

/**
 * One traffic line: summary at `debug`, or the same line at `trace` with
 * `data` when the floor allows. Lazy `data` avoids stringify/redact when
 * bodies are filtered out. Unfiltered {@link emitLog} stays for errors.
 * Omitted `logLevel` uses the {@link isLogEnabled} default (`debug`).
 */
export function emitTraffic(
    logger: SessionLogger | undefined,
    logLevel: LogLevel | undefined,
    record: TrafficInput
): void {
    if (!logger) {
        return;
    }
    if (!isLogEnabled(logLevel, 'debug')) {
        return;
    }
    const traceEnabled = isLogEnabled(logLevel, 'trace');
    let data: string | undefined;
    if (traceEnabled) {
        try {
            data = record.data();
        } catch {
            // Same I/O isolation as emitLog: a bad body must not drop the line.
        }
    }
    const level: LogLevel = traceEnabled ? 'trace' : 'debug';
    emitLog(logger, {
        level,
        channel: record.channel,
        message: record.message,
        direction: record.direction,
        target: record.target,
        ...(data !== undefined ? { data } : {})
    });
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
