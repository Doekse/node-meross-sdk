import { EventEmitter } from 'node:events';

import { CloudClient } from './cloud';
import type { CloudClientOptions, CloudDevice, CloudSubDevice } from './cloud';
import { Endpoint } from './endpoint';
import { MerossError } from './errors';
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

interface SessionEvents {
    connection: [connected: boolean];
    ratelimit: [uuid: string, dropped: number];
    /**
     * Per-device failure {@link Session.sync} swallowed to keep going.
     * Typical cases are an Ability / System.All timeout, or a hub cloud
     * `listSubDevices` failure (digest children still enroll; cloud names /
     * extra ids are omitted). Cloud-level failures still reject `sync` itself,
     * so a stale token surfaces there rather than here.
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
    /** In-flight {@link Session.sync}, shared by overlapping callers. */
    private syncing: Promise<void> | undefined;
    /** Session-owned LAN AES memo; fingerprint misses when key or MAC changes. */
    private readonly lanEncryptionKeys = new LanEncryptionKeys();

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
        return { ...this.token };
    }

    /**
     * Opens MQTT and LAN, then enrolls devices into {@link Inventory}.
     * Transports stay internal; hosts only see inventory after this.
     * A failed attempt clears the router so a later call can retry.
     */
    async connect(): Promise<void> {
        if (this.router) {
            return;
        }
        this.router = this.createRouter();
        try {
            await this.router.connect();
            await this.sync();
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
     * Reconciles inventory with the cloud account: devices that left are dropped,
     * new online devices are enrolled, and known devices are re-read so a firmware
     * update that changed abilities takes effect. Unreachable devices are skipped
     * so one timeout cannot block the rest; each skip is reported on `warning`.
     *
     * Overlapping callers join the run already in flight rather than starting a
     * second one, because two passes would interleave device removal with
     * endpoint materialization and could drop a device the other just enrolled.
     */
    async sync(): Promise<void> {
        if (!this.router) {
            throw new MerossError('Session is not connected', 'NOT_CONNECTED');
        }
        this.syncing ??= this.runSync().finally(() => {
            this.syncing = undefined;
        });
        return this.syncing;
    }

    private async runSync(): Promise<void> {
        const cloudDevices = await this.cloud.listDevices();
        const listed = new Set(cloudDevices.map((cloudDevice) => cloudDevice.uuid));
        for (const uuid of this.graph.uuids()) {
            if (!listed.has(uuid)) {
                this.stopDevice(uuid);
                this.graph.remove(uuid);
            }
        }

        // Offline devices answer neither Ability nor System.All; a later sync picks them up.
        const online = cloudDevices.filter((cloudDevice) => cloudDevice.onlineStatus === 1);
        this.materializeEndpoints(await this.enrollAll(online));
    }

    /**
     * Closes transports without discarding the stored token.
     */
    async disconnect(): Promise<void> {
        this.stopAllDevices();
        this.graph = new DeviceGraph();
        this.inventory.replace([]);
        this.lanEncryptionKeys.clear();
        await this.teardownRouter();
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
        await router?.disconnect();
    }

    private emitWarning(error: unknown): void {
        this.emit('warning', error instanceof Error ? error : new Error(String(error)));
    }

    /**
     * Enrolls up to {@link ENROLL_CONCURRENCY} devices at a time, collecting the
     * uuids whose shape changed so the caller can rebuild just those.
     */
    private async enrollAll(cloudDevices: readonly CloudDevice[]): Promise<Set<string>> {
        const reshaped = new Set<string>();
        let next = 0;
        const worker = async (): Promise<void> => {
            while (next < cloudDevices.length) {
                const cloudDevice = cloudDevices[next++]!;
                try {
                    if ((await this.enroll(cloudDevice)).reshaped) {
                        reshaped.add(cloudDevice.uuid);
                    }
                } catch (error) {
                    this.emitWarning(error);
                }
            }
        };
        await Promise.all(Array.from({ length: ENROLL_CONCURRENCY }, worker));
        return reshaped;
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
     * Runtime for `originUuid` when set, otherwise for the uuid in the
     * message header/`from`.
     */
    private deviceRuntime(
        message: MerossMessage,
        originUuid?: string
    ): DeviceRuntime | undefined {
        const uuid = originUuid ?? uuidFromHeader(message.header);
        return uuid ? this.devices.get(uuid) : undefined;
    }

    private stopAllDevices(): void {
        for (const uuid of this.devices.keys()) {
            this.stopDevice(uuid);
        }
    }

    /**
     * Stops a device's timers and forgets the endpoints it owns. The graph entry
     * stays so {@link materializeEndpoints} can rebuild from a fresh enrollment.
     */
    private stopDevice(uuid: string): void {
        this.lanEncryptionKeys.remove(uuid);
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
     * Ability and System.All failures reject so {@link enrollAll} can skip the
     * device. A hub `listSubDevices` failure is emitted as `warning` instead,
     * so digest children still enroll without the cloud name overlay.
     */
    private async enroll(cloudDevice: CloudDevice): Promise<EnrollResult> {
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
