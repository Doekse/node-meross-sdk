import { EventEmitter } from 'node:events';

import { CloudClient } from './cloud';
import type { CloudClientOptions, CloudDevice, CloudSubDevice } from './cloud';
import { Endpoint } from './endpoint';
import { AuthError, MerossError } from './errors';
import {
    ABILITY_NAMESPACE,
    DeviceGraph,
    SYSTEM_ALL_NAMESPACE,
    decodeAbilityGetAck,
    type EnrollResult,
    type PhysicalDevice
} from './device';
import { attachEndpoint } from './device/attach';
import { DeviceRuntime } from './device/runtime';
import { Inventory } from './inventory';
import type { LogLevel, SessionLogger } from './log';
import {
    DEFAULT_POLL_INTERVAL_MS,
    POLL_START_STAGGER_MS,
    buildPollJobs
} from './poll';
import {
    ONLINE_NAMESPACE,
    decodeOnlineStatus
} from './protocol/codecs/online';
import { ProtocolDispatcher } from './protocol/dispatcher';
import {
    LanEncryptionKeys,
    macAddressFromUuid,
    supportsLanEncryption
} from './protocol/encryption';
import { EMPTY_PAYLOAD, uuidFromHeader, type MerossMessage } from './protocol/message';
import { HUB_SUBDEVICE_LIST_NAMESPACE } from './protocol/namespaces';
import type { DeviceRequest } from './request';
import {
    LanHttpTransport,
    MqttTransport,
    TransportRouter,
    type MqttConnectFn
} from './transport';

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
 * Test hooks and host overrides. Transports stay internal; only cloud `fetch`,
 * MQTT connect, and LAN `fetch` are injectable so CI can run without a broker.
 */
export interface SessionOptions {
    cloud?: CloudClientOptions;
    mqttConnect?: MqttConnectFn;
    lanFetch?: typeof globalThis.fetch;
    /**
     * Single host sink. Not a field on {@link CloudClientOptions}; login/restore
     * copy it onto the internal cloud client so sign-in is visible.
     */
    logger?: SessionLogger;
    /** Floor when `logger` is set; omitted means `debug` at emit time. */
    logLevel?: LogLevel;
}

/**
 * Allowlist for {@link Session.connect} / {@link Session.sync}.
 * Physical uuids only — not inventory ids (`{uuid}:0`).
 */
export interface SyncOptions {
    /** Omitted or `undefined` enrolls the whole online account; `[]` enrolls nothing. */
    uuids?: readonly string[];
}

/**
 * Physical devices on the account, not enrolled {@link Inventory} rows.
 * `name`/`model` match InventoryRow; identity is `uuid` (inventory `id` is `{uuid}:0`).
 */
export type DeviceList = readonly {
    uuid: string;
    name: string;
    model: string;
    /** Regional / plug-form variant from cloud `subType` (e.g. `eu`, `us`). */
    subType: string;
    onlineStatus: number;
    channels: readonly unknown[];
}[];

interface SessionEvents {
    connection: [connected: boolean];
    ratelimit: [uuid: string, dropped: number];
    /**
     * Per-device failure {@link Session.enroll} / {@link Session.sync} swallowed
     * to keep going. Typical cases are an Ability / System.All timeout, or a
     * hub cloud `listSubDevices` failure (digest children still enroll; cloud
     * names / extra ids are omitted). Cloud-level failures still reject the
     * call itself, so a stale token surfaces there rather than here.
     *
     * Deliberately not named `error`: Node throws on an unhandled `error` emit,
     * which would turn one unreachable device into a crashed host process.
     */
    warning: [error: Error];
}

/**
 * Enrollment is two round trips per device, so running devices one after another
 * makes a large account take minutes; unbounded would put every device's Ability
 * GET on the wire at once.
 */
const ENROLL_CONCURRENCY = 4;

/**
 * Cloud credentials plus live inventory. Hosts persist {@link TokenData}
 * and rebuild a session with {@link Session.restore}.
 */
export class Session extends EventEmitter<SessionEvents> {
    readonly inventory: Inventory;

    private readonly cloud: CloudClient;
    private token: TokenData;
    private readonly mqttConnect?: MqttConnectFn;
    private readonly lanFetch?: typeof globalThis.fetch;
    private readonly logger?: SessionLogger;
    private readonly logLevel?: LogLevel;
    private graph = new DeviceGraph();
    private readonly endpoints = new Map<string, Endpoint>();
    private readonly devices = new Map<string, DeviceRuntime>();
    /** Monotonic so devices enrolled by a later sync keep spreading their ticks. */
    private startedDevices = 0;
    private router: TransportRouter | undefined;
    /**
     * Handshake of the {@link Session.connect} that opened {@link router}.
     * `router` is assigned before it settles, so a concurrent connect must
     * await this rather than read a set `router` as "already connected" and
     * enroll over a broker that is not up yet.
     */
    private connecting: Promise<void> | undefined;
    /**
     * In-flight {@link Session.sync} drain. Overlapping callers replace
     * {@link pendingSyncOptions} with their options and await this promise.
     */
    private syncing: Promise<void> | undefined;
    /**
     * Latest overlapping `sync` options. One slot so concurrent callers cannot
     * start a second enroll pass; never a session-wide filtered mode.
     */
    private pendingSyncOptions: SyncOptions | undefined;
    /**
     * One Ability / System.All pass per uuid. Concurrent {@link enroll} callers
     * for the same uuid join this promise instead of starting a second pass.
     */
    private readonly enrolling = new Map<string, Promise<void>>();
    /**
     * Shared cloud `devList` for overlapping {@link enroll} calls. Cleared in
     * `finally` so a later enroll lists again.
     */
    private listing: Promise<CloudDevice[]> | undefined;
    /**
     * Settles when every {@link enroll} in the list-or-register phase has
     * registered its per-uuid passes, so {@link unenroll} cannot finish during
     * the shared `devList` gap before `enrolling` has an entry.
     */
    private listingBarrier: Promise<void> | undefined;
    private releaseListingBarrier: (() => void) | undefined;
    /** {@link enroll} callers still inside list-or-register. */
    private listingPending = 0;
    /** Slots held under {@link withEnrollSlot}; capped by {@link ENROLL_CONCURRENCY}. */
    private activeEnrolls = 0;
    /** Resolvers waiting for a free {@link withEnrollSlot} slot. */
    private readonly enrollWaiters: Array<() => void> = [];
    /**
     * Set for the whole {@link disconnect}, including the wait for in-flight
     * enrolls. Those passes must not start pollers after transports tear down.
     */
    private closing = false;
    /** Shared by overlapping {@link disconnect} calls so teardown runs once. */
    private disconnectPromise: Promise<void> | undefined;
    /** Session-owned LAN AES memo; fingerprint misses when key or MAC changes. */
    private readonly lanEncryptionKeys = new LanEncryptionKeys();
    /** False after {@link logout}; {@link getToken} rejects until {@link reauthenticate}. */
    private credentialsValid = true;

    private constructor(
        token: TokenData,
        cloud: CloudClient,
        options: SessionOptions = {}
    ) {
        super();
        this.token = token;
        this.cloud = cloud;
        this.mqttConnect = options.mqttConnect;
        this.lanFetch = options.lanFetch;
        this.logger = options.logger;
        this.logLevel = options.logLevel;
        this.inventory = new Inventory();
    }

    /**
     * Password is not stored; only {@link TokenData} is kept for {@link restore}.
     */
    static async login(
        options: LoginOptions,
        sessionOptions: SessionOptions = {}
    ): Promise<Session> {
        const cloud = await CloudClient.login(options, {
            ...sessionOptions.cloud,
            logger: sessionOptions.logger,
            logLevel: sessionOptions.logLevel
        });
        return new Session(cloud.getToken(), cloud, sessionOptions);
    }

    /**
     * Rebuilds a session from a stored token without a password.
     */
    static restore(token: TokenData, sessionOptions: SessionOptions = {}): Session {
        const cloud = CloudClient.restore(token, {
            ...sessionOptions.cloud,
            logger: sessionOptions.logger,
            logLevel: sessionOptions.logLevel
        });
        return new Session(cloud.getToken(), cloud, sessionOptions);
    }

    /**
     * Returns a copy so callers can persist the token without mutating session state.
     */
    getToken(): TokenData {
        if (!this.credentialsValid) {
            throw new AuthError('Not authenticated');
        }
        return { ...this.token };
    }

    /**
     * Opens MQTT and LAN, then enrolls devices into {@link Inventory}.
     * Transports stay internal; hosts only see inventory after this.
     * A failed attempt clears the router so a later call can retry.
     *
     * Once the transports are open, a bare call is a no-op; passing `uuids`
     * (including `[]`, but not `undefined`) re-runs {@link sync} so hosts can
     * tighten the set.
     */
    async connect(options: SyncOptions = {}): Promise<void> {
        if (this.router) {
            // Settled once connected, so this only waits for a first connect
            // that is still mid-handshake.
            await this.connecting;
            if (options.uuids !== undefined) {
                await this.sync(options);
            }
            return;
        }
        const router = this.createRouter();
        this.router = router;
        this.connecting = router.connect();
        try {
            await this.connecting;
            await this.sync(options);
        } catch (error) {
            await this.teardownRouter();
            throw error;
        }
    }

    /**
     * Swaps in fresh cloud credentials without discarding inventory, so a host
     * that hits `TOKEN_EXPIRED` can recover in place instead of rebuilding every
     * Endpoint and re-registering its listeners. Transports are only replaced
     * when the broker credentials actually changed, and the old router stays
     * live until the new one connects.
     */
    async reauthenticate(options: LoginOptions): Promise<TokenData> {
        const previous = this.token;
        this.token = await this.cloud.login(options);
        this.credentialsValid = true;
        const stale = this.router;
        if (!stale || !this.brokerChanged(previous)) {
            return this.getToken();
        }

        const fresh = this.createRouter();
        await fresh.connect();
        this.router = fresh;
        await stale.disconnect();
        return this.getToken();
    }

    /**
     * HTTP `devList` only — no MQTT, Ability, or inventory mutation.
     * Hosts use this for pairing UIs; {@link inventory} is the enrolled set.
     */
    async listDevices(): Promise<DeviceList> {
        const cloudDevices = await this.cloud.listDevices();
        return cloudDevices.map((cloudDevice) => ({
            uuid: cloudDevice.uuid,
            name: cloudDevice.devName,
            model: cloudDevice.deviceType,
            subType: cloudDevice.subType ?? '',
            onlineStatus: cloudDevice.onlineStatus,
            channels: [...cloudDevice.channels]
        }));
    }

    /**
     * Reconciles inventory with the cloud account: devices that left (or are
     * outside an explicit `uuids` allowlist) are dropped, and new online devices
     * are enrolled. Already-enrolled uuids are left alone (use {@link unenroll}
     * then {@link enroll} to force a re-read). Unreachable devices are skipped
     * so one timeout cannot block the rest; each skip is reported on `warning`.
     *
     * Omit `uuids`, or pass it as `undefined`, to enroll every online cloud
     * device. Pass `uuids: []` to enroll nothing. Overlapping callers share the
     * drain already in flight and leave one follow-up with the latest options
     * so two enroll passes never run at once.
     */
    async sync(options: SyncOptions = {}): Promise<void> {
        this.throwIfNotConnected();
        if (this.syncing) {
            this.pendingSyncOptions = options;
            return this.syncing;
        }
        this.syncing = this.drainSync(options);
        return this.syncing;
    }

    /**
     * Overlapping callers must not start a second enroll pass; this loop
     * applies the latest follow-up only after the active run. Both slots are
     * cleared inside the drain rather than from a `.finally()` on it, so a
     * caller cannot join a drain that has already stopped reading follow-ups.
     * {@link closing} stops the loop so disconnect does not start another pass.
     */
    private async drainSync(current: SyncOptions): Promise<void> {
        this.pendingSyncOptions = undefined;
        try {
            while (!this.closing) {
                await this.runSync(current);
                const followUp = this.pendingSyncOptions;
                if (this.closing || followUp === undefined) {
                    return;
                }
                this.pendingSyncOptions = undefined;
                current = followUp;
            }
        } finally {
            this.syncing = undefined;
            this.pendingSyncOptions = undefined;
        }
    }

    /**
     * Account (and allowlisted) devices stay in the graph even when offline;
     * Ability / System.All only run for online rows not yet enrolled.
     */
    private async runSync(options: SyncOptions): Promise<void> {
        const cloudDevices = await this.cloud.listDevices();
        if (this.closing) {
            return;
        }
        const allowlist = options.uuids === undefined ? undefined : new Set(options.uuids);
        const keepUuids = new Set<string>();
        const wanted: CloudDevice[] = [];
        for (const cloudDevice of cloudDevices) {
            if (allowlist !== undefined && !allowlist.has(cloudDevice.uuid)) {
                continue;
            }
            keepUuids.add(cloudDevice.uuid);
            if (cloudDevice.onlineStatus === 1) {
                wanted.push(cloudDevice);
            }
        }
        const removals: Promise<void>[] = [];
        for (const uuid of this.graph.uuids()) {
            if (!keepUuids.has(uuid)) {
                removals.push(this.dropDevice(uuid));
            }
        }
        await Promise.all(removals);
        if (this.closing) {
            return;
        }
        await Promise.all(wanted.map((cloudDevice) => this.enrollDevice(cloudDevice)));
        // Already-enrolled uuids skip materialize, so a sync whose adds all
        // took that path still needs one publish from the graph.
        if (!this.closing) {
            this.inventory.replace(this.graph.inventoryRows());
        }
    }

    /**
     * Adds online cloud devices to inventory. Additive and idempotent: a uuid
     * already enrolled (or mid-pass) does not list the account or contact the
     * device again. Concurrent callers share one in-flight `devList` and one
     * Ability / System.All pass per uuid; passes are bounded by
     * {@link ENROLL_CONCURRENCY} across calls. Omit `uuids` to enroll every
     * online device not yet enrolled; pass `[]` to enroll nothing. Offline rows
     * and uuids absent from the account are skipped silently; a reachable
     * device that fails is reported on `warning` and the rest continue.
     */
    async enroll(uuids?: readonly string[]): Promise<void> {
        this.throwIfNotConnected();
        await this.connecting;
        this.throwIfNotConnected();

        const allowlist = uuids === undefined ? undefined : new Set(uuids);
        const joined: Promise<void>[] = [];
        let needsList = false;
        if (allowlist === undefined) {
            needsList = true;
        } else {
            for (const uuid of allowlist) {
                const inFlight = this.enrolling.get(uuid);
                if (inFlight) {
                    joined.push(inFlight);
                } else if (!this.devices.has(uuid)) {
                    needsList = true;
                }
            }
        }
        if (!needsList) {
            await Promise.all(joined);
            this.throwIfNotConnected();
            return;
        }

        this.enterListingPhase();
        const passes: Promise<void>[] = [];
        try {
            const cloudDevices = await this.listCloudDevices();
            this.throwIfNotConnected();
            for (const cloudDevice of cloudDevices) {
                if (cloudDevice.onlineStatus !== 1) {
                    continue;
                }
                if (allowlist !== undefined && !allowlist.has(cloudDevice.uuid)) {
                    continue;
                }
                passes.push(this.enrollDevice(cloudDevice));
            }
        } finally {
            this.releaseListingPhase();
        }
        await Promise.all([...passes, ...joined]);
        this.throwIfNotConnected();
    }

    /**
     * Joins the phase {@link listingBarrier} covers. Called before `devList`
     * so {@link unenroll} cannot finish before {@link enrollDevice} stores passes.
     */
    private enterListingPhase(): void {
        if (this.listingBarrier === undefined) {
            this.listingBarrier = new Promise<void>((resolve) => {
                this.releaseListingBarrier = resolve;
            });
        }
        this.listingPending += 1;
    }

    /**
     * Leaves the list-or-register phase. The last caller opens
     * {@link listingBarrier}. Runs after passes are stored, and also when
     * listing fails, so {@link unenroll} cannot wait forever.
     */
    private releaseListingPhase(): void {
        this.listingPending -= 1;
        if (this.listingPending > 0) {
            return;
        }
        this.releaseListingBarrier?.();
        this.releaseListingBarrier = undefined;
        this.listingBarrier = undefined;
    }

    /**
     * Stops a device's runtime and drops its graph / inventory rows. Awaits an
     * in-flight enroll for that uuid first so a poller cannot start afterward.
     * Safe when the session is not connected.
     */
    async unenroll(uuid: string): Promise<void> {
        await this.listingBarrier?.catch(() => undefined);
        await this.dropDevice(uuid);
    }

    /**
     * Sync removals share this with {@link unenroll}. Waiting out the in-flight
     * pass first keeps that pass from starting a poller after the row is gone.
     */
    private async dropDevice(uuid: string): Promise<void> {
        await this.enrolling.get(uuid)?.catch(() => undefined);
        this.stopDevice(uuid);
        this.graph.remove(uuid);
        this.inventory.replace(this.graph.inventoryRows());
    }

    /**
     * Closes transports without discarding the stored token.
     * Pollers are stopped before in-flight enrolls resume, and again after
     * they settle, so a pass cannot start a poller once teardown has begun.
     */
    async disconnect(): Promise<void> {
        if (this.disconnectPromise) {
            return this.disconnectPromise;
        }
        this.closing = true;
        this.pendingSyncOptions = undefined;
        this.dropEnrollment();
        this.disconnectPromise = this.finishDisconnect();
        try {
            await this.disconnectPromise;
        } finally {
            this.disconnectPromise = undefined;
            this.closing = false;
        }
    }

    /**
     * In-flight enrolls may finish their cloud / Ability reads; materialize is
     * skipped via {@link closing}. Enrollment is dropped again in case a device
     * was still written into the graph.
     */
    private async finishDisconnect(): Promise<void> {
        await Promise.allSettled(this.enrolling.values());
        this.dropEnrollment();
        await this.teardownRouter();
    }

    /** Stops pollers and drops enrolled devices without touching transports. */
    private dropEnrollment(): void {
        this.stopAllDevices();
        this.graph = new DeviceGraph();
        this.inventory.replace([]);
        this.lanEncryptionKeys.clear();
    }

    /**
     * {@link disconnect} rejects new work while {@link closing} is set. After
     * it finishes, {@link closing} is clear and {@link router} is gone.
     */
    private throwIfNotConnected(): void {
        if (this.closing || !this.router) {
            throw new MerossError('Session is not connected', 'NOT_CONNECTED');
        }
    }

    /**
     * Closes transports, invalidates the cloud token, and clears local
     * credentials. Unlike {@link disconnect}, the stored token must not be
     * persisted or passed to {@link Session.restore} afterward. Idempotent when
     * already logged out.
     */
    async logout(): Promise<void> {
        if (!this.credentialsValid) {
            return;
        }
        await this.disconnect();
        await this.cloud.logout();
        this.credentialsValid = false;
    }

    /**
     * Looks up an enrolled endpoint by inventory row id.
     */
    endpoint(id: string): Endpoint {
        const endpoint = this.endpoints.get(id);
        if (!endpoint) {
            throw new MerossError(`Unknown endpoint: ${id}`, 'ENDPOINT_NOT_FOUND');
        }
        return endpoint;
    }

    /**
     * Transports only exist between {@link connect} and {@link disconnect}, and
     * device timers can outlive a teardown by one tick, so reads go through here
     * to fail as NOT_CONNECTED instead of a TypeError.
     */
    private get connectedRouter(): TransportRouter {
        if (!this.router) {
            throw new MerossError('Session is not connected', 'NOT_CONNECTED');
        }
        return this.router;
    }

    private createRouter(): TransportRouter {
        const dispatcher = new ProtocolDispatcher({
            onPush: (message) => this.deviceRuntime(message)?.handlePush(message),
            onInbound: (message, originUuid) => this.handleInbound(message, originUuid)
        });
        const mqtt = new MqttTransport({
            userId: this.token.userId,
            key: this.token.key,
            mqttDomain: this.token.mqttDomain,
            dispatcher,
            connect: this.mqttConnect,
            logger: this.logger,
            logLevel: this.logLevel,
            onConnectionChange: (connected) => {
                if (!connected) {
                    for (const runtime of this.devices.values()) {
                        runtime.clearMqtt();
                    }
                }
                this.emit('connection', connected);
            },
            onRateLimit: (uuid, dropped) => this.emit('ratelimit', uuid, dropped)
        });
        const lan = new LanHttpTransport({
            key: this.token.key,
            from: mqtt.clientResponseTopic,
            dispatcher,
            fetch: this.lanFetch,
            logger: this.logger,
            logLevel: this.logLevel
        });
        return new TransportRouter({ mqtt, lan });
    }

    /** MQTT credentials and topics; a change means the transports are stale. */
    private brokerChanged(previous: TokenData): boolean {
        return this.token.key !== previous.key
            || this.token.userId !== previous.userId
            || this.token.mqttDomain !== previous.mqttDomain;
    }

    private async teardownRouter(): Promise<void> {
        const router = this.router;
        this.router = undefined;
        this.connecting = undefined;
        await router?.disconnect();
    }

    private emitWarning(error: unknown): void {
        this.emit('warning', error instanceof Error ? error : new Error(String(error)));
    }

    /**
     * Shared `devList` so concurrent {@link enroll} calls do not list twice.
     */
    private listCloudDevices(): Promise<CloudDevice[]> {
        this.listing ??= this.cloud.listDevices().finally(() => {
            this.listing = undefined;
        });
        return this.listing;
    }

    /**
     * One pass per uuid. A repeat caller joins the in-flight promise, and an
     * already-enrolled uuid must not contact the device again.
     */
    private enrollDevice(cloudDevice: CloudDevice): Promise<void> {
        const uuid = cloudDevice.uuid;
        const inFlight = this.enrolling.get(uuid);
        if (inFlight) {
            return inFlight;
        }
        if (this.devices.has(uuid)) {
            return Promise.resolve();
        }
        const pass = this.runEnroll(cloudDevice).finally(() => {
            this.enrolling.delete(uuid);
        });
        this.enrolling.set(uuid, pass);
        return pass;
    }

    /**
     * One Ability / System.All pass under the global slot limiter. Skips
     * materialize when {@link closing} so disconnect cannot leave a poller.
     */
    private async runEnroll(cloudDevice: CloudDevice): Promise<void> {
        await this.withEnrollSlot(async () => {
            if (this.closing) {
                return;
            }
            try {
                const { reshaped } = await this.readDevice(cloudDevice);
                if (this.closing) {
                    return;
                }
                this.materializeEndpoints(reshaped ? new Set([cloudDevice.uuid]) : new Set());
            } catch (error) {
                this.emitWarning(error);
            }
        });
    }

    /**
     * Caps concurrent Ability / System.All passes at {@link ENROLL_CONCURRENCY}
     * across overlapping {@link enroll} / {@link sync} callers. Re-checks after
     * each wake so a new caller cannot steal the slot a waiter was promised.
     */
    private async withEnrollSlot<T>(run: () => Promise<T>): Promise<T> {
        while (this.activeEnrolls >= ENROLL_CONCURRENCY) {
            await new Promise<void>((resolve) => {
                this.enrollWaiters.push(resolve);
            });
        }
        this.activeEnrolls += 1;
        try {
            return await run();
        } finally {
            this.activeEnrolls -= 1;
            const next = this.enrollWaiters.shift();
            next?.();
        }
    }

    /**
     * Forwards one inbound frame to the matching runtime. MQTT
     * (`originUuid` omitted) records liveness, except System.Online that is
     * not PUSH with status 1. LAN (POST uuid) applies
     * {@link DeviceRuntime.handleMessage} without recording liveness.
     */
    private handleInbound(message: MerossMessage, originUuid?: string): void {
        const runtime = this.deviceRuntime(message, originUuid);
        if (!runtime) {
            return;
        }
        if (
            originUuid === undefined
            && message.header.namespace === ONLINE_NAMESPACE
            && (
                message.header.method !== 'PUSH'
                || decodeOnlineStatus(message.payload) !== 1
            )
        ) {
            return;
        }
        if (originUuid === undefined) {
            runtime.recordPush();
        }
        runtime.handleMessage(message);
    }

    /**
     * Runtime for a non-empty `originUuid` when set, otherwise for the uuid
     * in the message header/`from`.
     */
    private deviceRuntime(
        message: MerossMessage,
        originUuid?: string
    ): DeviceRuntime | undefined {
        const uuid = originUuid || uuidFromHeader(message.header);
        return uuid ? this.devices.get(uuid) : undefined;
    }

    private stopAllDevices(): void {
        for (const uuid of this.devices.keys()) {
            this.stopDevice(uuid);
        }
    }

    /**
     * Stops a device's timers and forgets the endpoints it owns. Per-uuid
     * stale-PUSH timestamps, MQTT windows, and HTTP-down go with it so a
     * later enrollment cannot inherit them. The graph entry stays so
     * {@link materializeEndpoints} can rebuild from a fresh enrollment.
     */
    private stopDevice(uuid: string): void {
        this.lanEncryptionKeys.remove(uuid);
        this.router?.forget(uuid);
        const runtime = this.devices.get(uuid);
        if (!runtime) {
            return;
        }
        runtime.stop();
        for (const endpoint of runtime.endpoints) {
            this.endpoints.delete(endpoint.id);
        }
        this.devices.delete(uuid);
    }

    /**
     * Ability and System.All failures reject so {@link runEnroll} can skip the
     * device. A hub `listSubDevices` failure is emitted as `warning` instead,
     * so digest children still enroll without the cloud name overlay.
     */
    private async readDevice(cloudDevice: CloudDevice): Promise<EnrollResult> {
        const [abilityReply, allReply] = await this.connectedRouter.requestGets({
            uuid: cloudDevice.uuid,
            gets: [
                { namespace: ABILITY_NAMESPACE, payload: EMPTY_PAYLOAD },
                { namespace: SYSTEM_ALL_NAMESPACE, payload: EMPTY_PAYLOAD }
            ]
        });

        const ability = decodeAbilityGetAck(abilityReply.payload);
        let subDevices: CloudSubDevice[] | undefined;
        if (HUB_SUBDEVICE_LIST_NAMESPACE in ability) {
            try {
                subDevices = await this.cloud.listSubDevices(cloudDevice.uuid);
            } catch (error) {
                // Leave subDevices undefined: digest children still enroll;
                // only the cloud name overlay is lost.
                this.emitWarning(error);
            }
        }
        return this.graph.enroll({
            abilityPayload: abilityReply.payload,
            allPayload: allReply.payload,
            cloud: cloudDevice,
            subDevices
        });
    }

    /**
     * Reshaped devices are torn down before being rebuilt, because their traits
     * captured the previous ability snapshot at construction.
     */
    private materializeEndpoints(reshaped: ReadonlySet<string>): void {
        for (const uuid of reshaped) {
            this.stopDevice(uuid);
        }

        const rows = this.graph.inventoryRows();
        this.inventory.replace(rows);
        const byUuid = new Map<string, Endpoint[]>();
        const deviceRequests = new Map<string, DeviceRequest>();
        const abilityNamespaces = new Map<string, ReadonlySet<string>>();
        for (const row of rows) {
            const graphEndpoint = this.graph.getEndpoint(row.id)!;
            let endpoint = this.endpoints.get(row.id);
            if (!endpoint) {
                const physical = this.graph.getPhysical(graphEndpoint.uuid)!;
                let request = deviceRequests.get(physical.uuid);
                if (!request) {
                    request = this.deviceRequest(physical);
                    deviceRequests.set(physical.uuid, request);
                }
                let namespaces = abilityNamespaces.get(physical.uuid);
                if (!namespaces) {
                    namespaces = new Set(Object.keys(physical.ability));
                    abilityNamespaces.set(physical.uuid, namespaces);
                }
                endpoint = attachEndpoint(graphEndpoint, request, physical, namespaces);
                this.endpoints.set(row.id, endpoint);
            }
            const group = byUuid.get(graphEndpoint.uuid) ?? [];
            group.push(endpoint);
            byUuid.set(graphEndpoint.uuid, group);
        }

        for (const [uuid, endpoints] of byUuid) {
            if (this.devices.has(uuid)) {
                continue;
            }
            const physical = this.graph.getPhysical(uuid)!;
            let request = deviceRequests.get(physical.uuid);
            if (!request) {
                request = this.deviceRequest(physical);
                deviceRequests.set(physical.uuid, request);
            }
            const startDelayMs = (this.startedDevices * POLL_START_STAGGER_MS) % DEFAULT_POLL_INTERVAL_MS;
            this.startedDevices += 1;
            const runtime = new DeviceRuntime({
                uuid,
                initialOnline: physical.online,
                endpoints,
                request: (namespace, method, payload) => request({
                    namespace,
                    method,
                    payload: payload ?? EMPTY_PAYLOAD,
                    priority: 'background'
                }),
                onInnerIp: (innerIp) => {
                    physical.innerIp = innerIp;
                },
                isCloudPath: () => this.connectedRouter.isCloudPath(uuid, physical.innerIp),
                httpDown: () => this.connectedRouter.isHttpDown(uuid),
                maxCmdNum: () => physical.maxCmdNum,
                requestGets: (gets, maxCmdNum, onPackedFallback) => this.connectedRouter.requestGets({
                    uuid,
                    gets,
                    maxCmdNum,
                    priority: 'background',
                    ...this.lanBind(physical),
                    onPackedFallback
                }),
                onAck: (message) => this.deviceRuntime(message, uuid)?.handlePush(message),
                jobs: buildPollJobs(physical.ability, physical.endpoints, physical.digestNamespaces),
                startDelayMs
            });
            this.devices.set(uuid, runtime);
            runtime.start();
        }
    }

    private lanBind(physical: PhysicalDevice) {
        if (!supportsLanEncryption(physical.ability)) {
            this.lanEncryptionKeys.remove(physical.uuid);
            return { ip: physical.innerIp };
        }
        const mac = physical.macAddress ?? macAddressFromUuid(physical.uuid);
        return {
            ip: physical.innerIp,
            encryptionKey: this.lanEncryptionKeys.derive(
                physical.uuid,
                this.token.key,
                mac
            )
        };
    }

    private deviceRequest(physical: PhysicalDevice): DeviceRequest {
        return (options) =>
            this.connectedRouter.request({
                uuid: physical.uuid,
                ...this.lanBind(physical),
                ...options
            }).finally(() => {
                this.devices.get(physical.uuid)?.publishProtocol();
            });
    }
}
