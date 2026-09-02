import { EventEmitter } from 'node:events';

import { CloudClient } from './cloud';
import type { CloudClientOptions, CloudDevice } from './cloud';
import { Endpoint } from './endpoint';
import type { TraitName } from './endpoint';
import { MerossError } from './errors';
import {
    ABILITY_NAMESPACE,
    DeviceGraph,
    SYSTEM_ALL_NAMESPACE,
    decodeAbilityGetAck
} from './device';
import type { EnrollResult, GraphEndpoint, PhysicalDevice } from './device';
import { DeviceAvailability } from './device/availability';
import {
    DEFAULT_POLL_INTERVAL_MS,
    POLL_START_STAGGER_MS,
    buildPollJobs
} from './poll';
import { DevicePoller } from './poll/poller';
import { Inventory } from './inventory';
import {
    CONSUMPTIONH_NAMESPACE,
    CONSUMPTIONX_NAMESPACE,
    ELECTRICITY_NAMESPACE,
    ELECTRICITYX_NAMESPACE,
    LIGHT_EFFECT_NAMESPACE,
    ProtocolDispatcher,
    TIMERX_NAMESPACE,
    TOGGLEX_NAMESPACE,
    TRIGGERX_NAMESPACE,
    uuidFromHeader,
    deriveEncryptionKey,
    macAddressFromUuid,
    supportsLanEncryption,
    type MerossMessage
} from './protocol';
import {
    LanHttpTransport,
    MqttTransport,
    TransportRouter,
    type MqttConnectFn,
    type RoutedRequestOptions
} from './transport';
import { AlarmTrait } from './traits/alarm';
import { ClimateTrait } from './traits/climate';
import type { ThermostatGeneration } from './traits/climate';
import { CoverTrait } from './traits/cover';
import { DiffuserTrait } from './traits/diffuser';
import { DndTrait } from './traits/dnd';
import { EnergyTrait } from './traits/energy';
import { FanTrait } from './traits/fan';
import { LightTrait } from './traits/light';
import { MediaTrait } from './traits/media';
import { PresenceTrait } from './traits/presence';
import { SENSOR_FAMILY_MAP, SensorTrait } from './traits/sensor';
import { SprayTrait } from './traits/spray';
import { SprinklerTrait } from './traits/sprinkler';
import { SwitchTrait } from './traits/switch';
import { SystemTrait } from './traits/system';
import { TimerTrait } from './traits/timer';
import type { TimerGeneration } from './traits/timer';
import { TriggerTrait } from './traits/trigger';
import type { TriggerGeneration } from './traits/trigger';

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
}

interface SessionEvents {
    connection: [connected: boolean];
    ratelimit: [uuid: string, dropped: number];
    /**
     * Per-device failure {@link Session.sync} swallowed to keep going, typically
     * an Ability / System.All timeout. Cloud-level failures still reject `sync`
     * itself, so a stale token surfaces there rather than here.
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

/** Timers and endpoints owned by one enrolled device, torn down as a unit. */
interface DeviceRuntime {
    availability: DeviceAvailability;
    poller: DevicePoller;
    endpoints: readonly Endpoint[];
}

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
    private graph = new DeviceGraph();
    private readonly endpoints = new Map<string, Endpoint>();
    private readonly devices = new Map<string, DeviceRuntime>();
    /** Monotonic so devices enrolled by a later sync keep spreading their ticks. */
    private startedDevices = 0;
    private router: TransportRouter | undefined;
    /** In-flight {@link Session.sync}, shared by overlapping callers. */
    private syncing: Promise<void> | undefined;

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
        this.inventory = new Inventory();
    }

    /**
     * Password is not stored; only {@link TokenData} is kept for {@link restore}.
     */
    static async login(
        options: LoginOptions,
        sessionOptions: SessionOptions = {}
    ): Promise<Session> {
        const cloud = await CloudClient.login(options, sessionOptions.cloud);
        return new Session(cloud.getToken(), cloud, sessionOptions);
    }

    /**
     * Rebuilds a session from a stored token without a password.
     */
    static restore(token: TokenData, sessionOptions: SessionOptions = {}): Session {
        const cloud = CloudClient.restore(token, sessionOptions.cloud);
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
            onPush: (message) => this.handlePush(message),
            onInbound: (message, originUuid) => this.handleInbound(message, originUuid)
        });
        const mqtt = new MqttTransport({
            userId: this.token.userId,
            key: this.token.key,
            mqttDomain: this.token.mqttDomain,
            dispatcher,
            connect: this.mqttConnect,
            onConnectionChange: (connected) => {
                if (!connected) {
                    for (const runtime of this.devices.values()) {
                        runtime.poller.clearMqtt();
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
            fetch: this.lanFetch
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
     * HTTP applies on the Device that POSTed; MQTT looks up by header/`from`.
     * SETACK and ERROR are skipped so they are not parsed as GETACK.
     */
    private handlePush(message: MerossMessage, originUuid?: string): void {
        const runtime = this.deviceRuntime(message, originUuid);
        if (!runtime) {
            return;
        }
        const method = message.header.method;
        if (method === 'ERROR' || method === 'SETACK') {
            return;
        }
        for (const endpoint of runtime.endpoints) {
            endpoint.handlePush(message);
        }
    }

    /**
     * Same lookup as {@link handlePush} so LAN GETACK still counts as liveness.
     * MQTT inbound (no POST uuid) marks the broker live, including GETACK;
     * LAN always passes the POST uuid so HTTP replies do not.
     */
    private handleInbound(message: MerossMessage, originUuid?: string): void {
        const runtime = this.deviceRuntime(message, originUuid);
        if (!runtime) {
            return;
        }
        if (originUuid === undefined) {
            runtime.poller.recordPush();
        }
        runtime.availability.handleMessage(message);
    }

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
        const runtime = this.devices.get(uuid);
        if (!runtime) {
            return;
        }
        runtime.poller.stop();
        runtime.availability.stop();
        for (const endpoint of runtime.endpoints) {
            this.endpoints.delete(endpoint.id);
        }
        this.devices.delete(uuid);
    }

    private async enroll(cloudDevice: CloudDevice): Promise<EnrollResult> {
        const [abilityReply, allReply] = await this.connectedRouter.requestGets({
            uuid: cloudDevice.uuid,
            gets: [
                { namespace: ABILITY_NAMESPACE, payload: {} },
                { namespace: SYSTEM_ALL_NAMESPACE, payload: {} }
            ]
        });

        const ability = decodeAbilityGetAck(abilityReply.payload);
        return this.graph.enroll({
            abilityPayload: abilityReply.payload,
            allPayload: allReply.payload,
            cloud: cloudDevice,
            subDevices: 'Appliance.Hub.SubdeviceList' in ability
                ? await this.cloud.listSubDevices(cloudDevice.uuid).catch(() => [])
                : undefined
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
        for (const row of rows) {
            const graphEndpoint = this.graph.getEndpoint(row.id)!;
            let endpoint = this.endpoints.get(row.id);
            if (!endpoint) {
                endpoint = this.createEndpoint(graphEndpoint);
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
            const request = this.deviceRequest(physical);
            const startDelayMs = (this.startedDevices * POLL_START_STAGGER_MS) % DEFAULT_POLL_INTERVAL_MS;
            this.startedDevices += 1;
            const availability = new DeviceAvailability({
                uuid,
                initialOnline: physical.online,
                endpoints,
                request: (namespace, method, payload) => request({
                    namespace,
                    method,
                    payload: payload ?? {},
                    priority: 'background'
                }),
                onOnlineChange: (online) => poller.setOnline(online),
                onInnerIp: (innerIp) => {
                    physical.innerIp = innerIp;
                }
            });
            // Mutually referential with `availability`; both only read each
            // other from callbacks, so declaration order is safe.
            const poller: DevicePoller = new DevicePoller({
                isOnline: () => availability.isOnline(),
                isCloudPath: () => this.connectedRouter.isCloudPath(uuid, physical.innerIp),
                httpDown: () => this.connectedRouter.isHttpDown(uuid),
                maxCmdNum: () => physical.maxCmdNum,
                requestGets: (gets, maxCmdNum) => this.connectedRouter.requestGets({
                    uuid,
                    gets,
                    maxCmdNum,
                    priority: 'background',
                    ...this.lanBind(physical),
                    onPackedFallback: () => poller.shrinkResponseBudget()
                }),
                onAck: (message) => this.handlePush(message, uuid),
                jobs: buildPollJobs(physical.ability, physical.endpoints, physical.digestNamespaces),
                startDelayMs
            });
            this.devices.set(uuid, { availability, poller, endpoints });
            availability.start();
            poller.start();
        }
    }

    private createEndpoint(graphEndpoint: GraphEndpoint): Endpoint {
        const physical = this.graph.getPhysical(graphEndpoint.uuid)!;
        const channel = graphEndpoint.channel ?? 0;
        const namespaces = new Set(Object.keys(physical.ability));
        const request = this.deviceRequest(physical);
        // Assigned after traits so emitChange closures can capture the binding.
        // eslint-disable-next-line prefer-const -- definite assignment; constructed below
        let endpoint!: Endpoint;
        /**
         * Each trait declares its own `Values` interface, so the parameter is
         * widened to `object`; the spread is what gives {@link EndpointChange}
         * an indexable type.
         */
        const changeEmitter = (trait: TraitName) => (values: object) => {
            endpoint.emit('change', { trait, values: { ...values } });
        };
        let switchTrait: SwitchTrait | undefined;
        let energyTrait: EnergyTrait | undefined;
        let lightTrait: LightTrait | undefined;
        let coverTrait: CoverTrait | undefined;
        let climateTrait: ClimateTrait | undefined;
        let sensorTrait: SensorTrait | undefined;
        let presenceTrait: PresenceTrait | undefined;
        let sprinklerTrait: SprinklerTrait | undefined;
        let sprayTrait: SprayTrait | undefined;
        let fanTrait: FanTrait | undefined;
        let diffuserTrait: DiffuserTrait | undefined;
        let mediaTrait: MediaTrait | undefined;
        let alarmTrait: AlarmTrait | undefined;
        let dndTrait: DndTrait | undefined;
        let systemTrait: SystemTrait | undefined;
        let timerTrait: TimerTrait | undefined;
        let triggerTrait: TriggerTrait | undefined;
        if (graphEndpoint.traits.includes('switch')) {
            if (graphEndpoint.subDeviceId) {
                switchTrait = new SwitchTrait({
                    kind: 'hub',
                    uuid: physical.uuid,
                    subDeviceId: graphEndpoint.subDeviceId,
                    initialOn: graphEndpoint.on,
                    namespaces,
                    request,
                    emitChange: changeEmitter('switch')
                });
            } else {
                switchTrait = new SwitchTrait({
                    kind: 'board',
                    uuid: physical.uuid,
                    channel,
                    namespace: 'Appliance.Control.Toggle' in physical.ability && !(TOGGLEX_NAMESPACE in physical.ability)
                        ? 'Appliance.Control.Toggle'
                        : TOGGLEX_NAMESPACE,
                    initialOn: graphEndpoint.on,
                    request,
                    emitChange: changeEmitter('switch')
                });
            }
        }
        if (graphEndpoint.traits.includes('energy')) {
            const hasElectricity = ELECTRICITY_NAMESPACE in physical.ability;
            energyTrait = new EnergyTrait({
                uuid: physical.uuid,
                channel,
                hasElectricity,
                hasElectricityX: !hasElectricity && ELECTRICITYX_NAMESPACE in physical.ability,
                hasConsumptionX: CONSUMPTIONX_NAMESPACE in physical.ability,
                hasConsumptionH: CONSUMPTIONH_NAMESPACE in physical.ability,
                namespaces,
                request,
                emitChange: changeEmitter('energy')
            });
        }

        if (graphEndpoint.traits.includes('light')) {
            const abilityLight = physical.ability['Appliance.Control.Light'];
            const guessedCapacity = abilityLight && typeof abilityLight === 'object'
                ? typeof (abilityLight as { capacity?: unknown }).capacity === 'number'
                    ? (abilityLight as { capacity: number }).capacity
                    : 0
                : 0;

            const hasToggleX = TOGGLEX_NAMESPACE in physical.ability;
            const hasToggle = !hasToggleX && 'Appliance.Control.Toggle' in physical.ability;
            const hasLightEffect = LIGHT_EFFECT_NAMESPACE in physical.ability;

            lightTrait = new LightTrait({
                uuid: physical.uuid,
                channel,
                hasToggleX,
                hasToggle,
                hasLightEffect,
                lightCapacity: guessedCapacity,
                request,
                emitChange: changeEmitter('light')
            });
        }
        if (graphEndpoint.traits.includes('cover')) {
            const kind: 'garage' | 'shutter' = 'Appliance.RollerShutter.State' in physical.ability
                ? 'shutter'
                : 'garage';
            coverTrait = new CoverTrait({
                uuid: physical.uuid,
                channel,
                kind,
                namespaces,
                initialOpen: graphEndpoint.on,
                request,
                emitChange: changeEmitter('cover')
            });
        }
        if (graphEndpoint.traits.includes('climate')) {
            if (graphEndpoint.subDeviceId) {
                climateTrait = new ClimateTrait({
                    kind: 'hub',
                    uuid: physical.uuid,
                    subDeviceId: graphEndpoint.subDeviceId,
                    namespaces,
                    request,
                    emitChange: changeEmitter('climate')
                });
            } else {
                const generation: ThermostatGeneration =
                    'Appliance.Control.Thermostat.ModeC' in physical.ability ? 'modeC'
                        : 'Appliance.Control.Thermostat.ModeB' in physical.ability ? 'modeB'
                            : 'mode';
                climateTrait = new ClimateTrait({
                    kind: 'board',
                    uuid: physical.uuid,
                    channel,
                    generation,
                    namespaces,
                    request,
                    emitChange: changeEmitter('climate')
                });
            }
        }
        if (graphEndpoint.traits.includes('sensor') && graphEndpoint.subDeviceId) {
            const family = SENSOR_FAMILY_MAP.get(graphEndpoint.model.toLowerCase());
            if (family) {
                sensorTrait = new SensorTrait({
                    uuid: physical.uuid,
                    subDeviceId: graphEndpoint.subDeviceId,
                    family,
                    namespaces,
                    request,
                    emitChange: changeEmitter('sensor')
                });
            }
        }
        if (graphEndpoint.traits.includes('presence')) {
            presenceTrait = new PresenceTrait({
                uuid: physical.uuid,
                channel,
                namespaces,
                request,
                emitChange: changeEmitter('presence')
            });
        }
        if (graphEndpoint.traits.includes('sprinkler') && graphEndpoint.subDeviceId) {
            sprinklerTrait = new SprinklerTrait({
                uuid: physical.uuid,
                subDeviceId: graphEndpoint.subDeviceId,
                namespaces,
                request,
                emitChange: changeEmitter('sprinkler')
            });
        }
        if (graphEndpoint.traits.includes('spray')) {
            sprayTrait = new SprayTrait({
                uuid: physical.uuid,
                channel,
                request,
                emitChange: changeEmitter('spray')
            });
        }
        if (graphEndpoint.traits.includes('fan')) {
            fanTrait = new FanTrait({
                uuid: physical.uuid,
                channel,
                namespaces,
                hasToggleX: TOGGLEX_NAMESPACE in physical.ability,
                hasToggle: !(TOGGLEX_NAMESPACE in physical.ability)
                    && 'Appliance.Control.Toggle' in physical.ability,
                request,
                emitChange: changeEmitter('fan')
            });
        }
        if (graphEndpoint.traits.includes('diffuser')) {
            diffuserTrait = new DiffuserTrait({
                uuid: physical.uuid,
                channel,
                namespaces,
                request,
                emitChange: changeEmitter('diffuser')
            });
        }
        if (graphEndpoint.traits.includes('media')) {
            mediaTrait = new MediaTrait({
                uuid: physical.uuid,
                channel,
                request,
                emitChange: changeEmitter('media')
            });
        }
        if (graphEndpoint.traits.includes('alarm')) {
            alarmTrait = new AlarmTrait({
                uuid: physical.uuid,
                channel,
                namespaces,
                request,
                emitChange: changeEmitter('alarm')
            });
        }
        if (graphEndpoint.traits.includes('dnd')) {
            dndTrait = new DndTrait({
                uuid: physical.uuid,
                request,
                emitChange: (on) => endpoint.emit('change', { trait: 'dnd', values: { on } })
            });
        }
        if (graphEndpoint.traits.includes('system')) {
            systemTrait = new SystemTrait({
                uuid: physical.uuid,
                initialFirmware: physical.system.firmware,
                initialHardware: physical.system.hardware,
                initialTime: physical.system.time,
                request,
                emitChange: changeEmitter('system')
            });
        }
        if (graphEndpoint.traits.includes('timer')) {
            const generation: TimerGeneration = TIMERX_NAMESPACE in physical.ability
                ? 'x'
                : 'legacy';
            timerTrait = new TimerTrait({
                uuid: physical.uuid,
                channel,
                generation,
                namespaces,
                request,
                emitChange: changeEmitter('timer')
            });
        }
        if (graphEndpoint.traits.includes('trigger')) {
            const generation: TriggerGeneration = TRIGGERX_NAMESPACE in physical.ability
                ? 'x'
                : 'legacy';
            triggerTrait = new TriggerTrait({
                uuid: physical.uuid,
                channel,
                generation,
                namespaces,
                request,
                emitChange: changeEmitter('trigger')
            });
        }
        endpoint = new Endpoint({
            id: graphEndpoint.id,
            traits: graphEndpoint.traits,
            switch: switchTrait,
            energy: energyTrait,
            light: lightTrait,
            cover: coverTrait,
            climate: climateTrait,
            sensor: sensorTrait,
            presence: presenceTrait,
            sprinkler: sprinklerTrait,
            spray: sprayTrait,
            fan: fanTrait,
            diffuser: diffuserTrait,
            media: mediaTrait,
            alarm: alarmTrait,
            dnd: dndTrait,
            system: systemTrait,
            timer: timerTrait,
            trigger: triggerTrait,
            initialOnline: graphEndpoint.online
        });
        return endpoint;
    }

    private lanBind(physical: PhysicalDevice) {
        return {
            ip: physical.innerIp,
            encryptionKey: supportsLanEncryption(physical.ability)
                ? deriveEncryptionKey(
                    physical.uuid,
                    this.token.key,
                    physical.macAddress ?? macAddressFromUuid(physical.uuid)
                )
                : undefined
        };
    }

    private deviceRequest(physical: PhysicalDevice) {
        return (options: Omit<RoutedRequestOptions, 'uuid' | 'ip' | 'encryptionKey'>) =>
            this.connectedRouter.request({
                uuid: physical.uuid,
                ...this.lanBind(physical),
                ...options
            });
    }
}
