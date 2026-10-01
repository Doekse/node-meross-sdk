/**
 * Opt-in host sink for transport traffic the SDK cannot expose via wrappable
 * fetch/mqtt hooks — LAN uses node:http, and cloud sign-in runs before Session
 * exists. Homey (or any host) owns DEBUG gating; this module never reads env.
 *
 * Callers use {@link logTraffic} and {@link logError}. Summary text, header
 * peeks, and redaction stay here so a transport does not assemble a line.
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

/** Host callback; logging is a no-op when this is omitted. */
export type SessionLogger = (record: LogRecord) => void;

/**
 * One exchange. MQTT and LAN summaries are built from `method`/`namespace`
 * or, on receive, from the JSON body. Cloud passes `message` itself.
 * `body` is read only when the summary or a trace dump needs it.
 */
export interface TrafficEvent {
    channel: LogChannel;
    direction: LogDirection;
    target?: string;
    message?: string;
    /** Used when a protocol body has no header. */
    fallback?: string;
    method?: string;
    namespace?: string;
    uuid?: string;
    messageId?: string;
    body?: unknown | (() => unknown);
}

/**
 * A failure line. Emitted whenever a logger is set, including at floor `error`.
 * JSON `data` is redacted like a trace body. Text that is not JSON is omitted
 * so a truncated frame is not logged raw.
 */
export interface ErrorEvent {
    channel: LogChannel;
    message: string;
    direction?: LogDirection;
    target?: string;
    data?: string | (() => string);
}

/** Numeric ranks so floor checks never string-compare (`'debug' < 'error'`). */
const LOG_LEVEL_RANK: Record<LogLevel, number> = {
    error: 0,
    debug: 1,
    trace: 2
};

/**
 * Lowercase names. Firmware uses `userId` where cloud uses `userid`, so
 * matching compares with `toLowerCase()`.
 */
const REDACT_KEYS = new Set([
    'password',
    'token',
    'key',
    'mfacode',
    'uuid',
    'sign',
    'from',
    'innerip',
    'server',
    'port',
    'secondserver',
    'secondport',
    'activeserver',
    'mainserver',
    'mainport',
    'macaddress',
    'wifimac',
    'ssid',
    'gatewaymac',
    'userid',
    'bindid',
    'email',
    'sn',
    'setupid',
    'setupcode',
    'domain',
    'mqttdomain',
    'cluster',
    'reserveddomain',
    'params',
    'authorization',
    'latitude',
    'longitude'
]);
const REDACTED = '[REDACTED]';

const MQTT_APPLIANCE_TOPIC = /^\/appliance\/([^/]+)\/(?:subscribe|publish)$/;
const FROM_UUID = /^\/appliance\/([^/]+)\//;

interface HeaderPeek {
    method: string;
    namespace: string;
    messageId: string;
    uuid?: string;
}

/**
 * Debug one-liner, plus a redacted body when the floor is `trace`.
 * Omitted `logLevel` matches an explicit `debug` floor.
 */
export function logTraffic(
    logger: SessionLogger | undefined,
    logLevel: LogLevel | undefined,
    event: TrafficEvent
): void {
    if (!logger || !enabled(logLevel, 'debug')) {
        return;
    }

    const protocol = event.channel === 'mqtt' || event.channel === 'lan';
    const method = event.method;
    const namespace = event.namespace;
    const known = protocol && method !== undefined && namespace !== undefined;
    const trace = enabled(logLevel, 'trace');
    const body = (protocol && !known) || trace ? readLazy(event.body) : undefined;

    let message: string;
    if (known) {
        message = protocolLine(event.direction, event.channel, method, namespace, event);
    } else if (protocol) {
        message = lineFromBody(event, body);
    } else {
        message = event.message ?? event.fallback ?? '';
    }

    const data = trace && body !== undefined ? redactBody(body) : undefined;
    emit(logger, {
        level: trace ? 'trace' : 'debug',
        channel: event.channel,
        message,
        direction: event.direction,
        ...(event.target !== undefined ? { target: event.target } : {}),
        ...(data !== undefined ? { data } : {})
    });
}

/**
 * Failure line. The host floor does not apply: an error is the reason a
 * request is about to throw. JSON `data` is redacted like a trace body.
 */
export function logError(logger: SessionLogger | undefined, event: ErrorEvent): void {
    if (!logger) {
        return;
    }
    const raw = readLazy(event.data);
    const data = raw === undefined ? undefined : redactBody(raw);
    emit(logger, {
        level: 'error',
        channel: event.channel,
        message: event.message,
        ...(event.direction !== undefined ? { direction: event.direction } : {}),
        ...(event.target !== undefined ? { target: event.target } : {}),
        ...(data !== undefined ? { data } : {})
    });
}

/**
 * Whether `level` should emit when the host floor is `floor`.
 * Omitted floor resolves to `debug`.
 */
function enabled(floor: LogLevel | undefined, level: LogLevel): boolean {
    const resolved = floor ?? 'debug';
    return LOG_LEVEL_RANK[level] <= LOG_LEVEL_RANK[resolved];
}

function emit(logger: SessionLogger, record: LogRecord): void {
    try {
        logger(record);
    } catch {
        // Host logging must not break MQTT/LAN/cloud I/O.
    }
}

/**
 * Evaluates a lazy body or error payload. A throw becomes `undefined` so the
 * line still emits.
 */
function readLazy<T>(value: T | (() => T) | undefined): T | undefined {
    try {
        if (typeof value === 'function') {
            return (value as () => T)();
        }
        return value;
    } catch {
        return undefined;
    }
}

function protocolLine(
    direction: LogDirection,
    channel: LogChannel,
    method: string,
    namespace: string,
    ids: { uuid?: string; messageId?: string }
): string {
    const parts: string[] = [];
    if (ids.uuid) {
        parts.push(`uuid:${ids.uuid}`);
    }
    if (ids.messageId) {
        parts.push(`messageId:${ids.messageId}`);
    }
    const suffix = parts.length > 0 ? ` (${parts.join(' ')})` : '';
    return `${direction}(${channel}) ${method} ${namespace}${suffix}`;
}

function lineFromBody(event: TrafficEvent, body: unknown): string {
    const peek = typeof body === 'string' ? peekHeader(body) : undefined;
    if (!peek) {
        return event.fallback ?? event.message ?? '';
    }
    let uuid = event.uuid ?? peek.uuid;
    if (uuid === undefined && event.channel === 'mqtt' && event.target) {
        uuid = uuidFromTopic(event.target);
    }
    return protocolLine(event.direction, event.channel, peek.method, peek.namespace, {
        uuid,
        messageId: peek.messageId
    });
}

function peekHeader(text: string): HeaderPeek | undefined {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return undefined;
    }
    if (typeof raw !== 'object' || raw === null) {
        return undefined;
    }
    const header = (raw as { header?: unknown }).header;
    if (typeof header !== 'object' || header === null) {
        return undefined;
    }
    const fields = header as Record<string, unknown>;
    const method = readString(fields, 'method');
    const namespace = readString(fields, 'namespace');
    const messageId = readString(fields, 'messageId');
    if (method === undefined || namespace === undefined || messageId === undefined) {
        return undefined;
    }
    const from = readString(fields, 'from') ?? '';
    return {
        method,
        namespace,
        messageId,
        uuid: readString(fields, 'uuid') ?? FROM_UUID.exec(from)?.[1]
    };
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key];
    return typeof value === 'string' ? value : undefined;
}

function uuidFromTopic(topic: string): string | undefined {
    return MQTT_APPLIANCE_TOPIC.exec(topic)?.[1];
}

function redactBody(body: unknown): string | undefined {
    try {
        const value = typeof body === 'string' ? JSON.parse(body) : body;
        return JSON.stringify(redact(value));
    } catch {
        // A truncated frame is header-first and still holds sign, from, and uuid.
        // Structured redact never sees it, so the dump is omitted.
        return undefined;
    }
}

/**
 * Replaces credential, network, and location fields. Key match ignores case.
 * Returns a new structure; the input is never mutated.
 */
function redact(value: unknown): unknown {
    if (value === null || typeof value !== 'object') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(redact);
    }
    const copy: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
        copy[key] = REDACT_KEYS.has(key.toLowerCase()) ? REDACTED : redact(nested);
    }
    return copy;
}
