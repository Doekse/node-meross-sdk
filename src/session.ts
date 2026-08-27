import { EventEmitter } from 'node:events';

import { CloudClient } from './cloud';
import type { CloudClientOptions, CloudDevice } from './cloud';
import { Endpoint } from './endpoint';
import { MerossError } from './errors';
import {
    ABILITY_NAMESPACE,
    DeviceGraph,
    SYSTEM_ALL_NAMESPACE,
    buildPollJobs,
    decodeAbilityGetAck
} from './graph';
import type { GraphEndpoint, PhysicalDevice } from './graph';
import { DeviceAvailability } from './graph/availability';
import { DevicePoller } from './graph/poller';
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
}

/**
 * Cloud credentials plus live inventory. Hosts persist {@link TokenData}
 * and rebuild a session with {@link Session.restore}.
 */
export class Session extends EventEmitter<SessionEvents> {
    readonly inventory: Inventory;

    private readonly cloud: CloudClient;
    private readonly token: TokenData;
    private readonly mqttConnect?: MqttConnectFn;
    private readonly lanFetch?: typeof globalThis.fetch;
    private graph = new DeviceGraph();
    private readonly endpoints = new Map<string, Endpoint>();
    private readonly boards = new Map<string, {
        availability: DeviceAvailability;
        poller: DevicePoller;
    }>();
    private router: TransportRouter | undefined;

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
     * Opens MQTT and LAN, then enrolls boards into {@link Inventory}.
     * Transports stay internal; hosts only see inventory after this.
     * A failed attempt clears the router so a later call can retry.
     */
    async connect(): Promise<void> {
        if (this.router) {
            return;
        }

        const dispatcher = new ProtocolDispatcher({
            onPush: (message) => this.handlePush(message),
            onInbound: (message) => this.handleInbound(message)
        });
        const mqtt = new MqttTransport({
            userId: this.token.userId,
            key: this.token.key,
            mqttDomain: this.token.mqttDomain,
            dispatcher,
            connect: this.mqttConnect,
            onConnectionChange: (connected) => this.emit('connection', connected),
            onRateLimit: (uuid, dropped) => this.emit('ratelimit', uuid, dropped)
        });
        const lan = new LanHttpTransport({
            key: this.token.key,
            from: mqtt.clientResponseTopic,
            dispatcher,
            fetch: this.lanFetch
        });
        this.router = new TransportRouter({ mqtt, lan });
        try {
            await this.router.connect();
            await this.sync();
        } catch (error) {
            await this.teardownRouter();
            throw error;
        }
    }

    /**
     * Re-lists the cloud account and enrolls boards not yet in inventory.
     * Offline or unreachable boards are skipped so one timeout cannot block the rest.
     */
    async sync(): Promise<void> {
        if (!this.router) {
            throw new MerossError('Session is not connected', 'NOT_CONNECTED');
        }
        for (const cloudDevice of await this.cloud.listDevices()) {
            if (this.graph.getPhysical(cloudDevice.uuid) || cloudDevice.onlineStatus !== 1) {
                continue;
            }
            try {
                await this.enroll(cloudDevice);
            } catch {
                // Ability / System.All timed out; leave the board out of inventory.
            }
        }
        this.materializeEndpoints();
    }

    /**
     * Closes transports without discarding the stored token.
     */
    async disconnect(): Promise<void> {
        this.endpoints.clear();
        this.stopBoards();
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

    private async teardownRouter(): Promise<void> {
        const router = this.router;
        this.router = undefined;
        await router?.disconnect();
    }

    private handlePush(message: MerossMessage): void {
        if (message.header.method === 'PUSH') {
            const uuid = message.header.uuid
                ?? /^\/appliance\/([^/]+)\//.exec(message.header.from)?.[1];
            if (uuid) {
                this.boards.get(uuid)?.poller.recordPush(message);
            }
        }
        for (const endpoint of this.endpoints.values()) {
            endpoint.switch?.handlePush(message);
            endpoint.energy?.handlePush(message);
            endpoint.light?.handlePush(message);
            endpoint.cover?.handlePush(message);
            endpoint.climate?.handlePush(message);
            endpoint.sensor?.handlePush(message);
            endpoint.presence?.handlePush(message);
            endpoint.sprinkler?.handlePush(message);
            endpoint.spray?.handlePush(message);
            endpoint.fan?.handlePush(message);
            endpoint.diffuser?.handlePush(message);
            endpoint.media?.handlePush(message);
            endpoint.alarm?.handlePush(message);
            endpoint.dnd?.handlePush(message);
            endpoint.system?.handlePush(message);
            endpoint.timer?.handlePush(message);
            endpoint.trigger?.handlePush(message);
        }
    }

    private handleInbound(message: MerossMessage): void {
        for (const { availability } of this.boards.values()) {
            availability.handleMessage(message);
        }
    }

    private stopBoards(): void {
        for (const { availability, poller } of this.boards.values()) {
            poller.stop();
            availability.stop();
        }
        this.boards.clear();
    }

    private async enroll(cloudDevice: CloudDevice): Promise<void> {
        const [abilityReply, allReply] = await this.router!.requestGets({
            uuid: cloudDevice.uuid,
            gets: [
                { namespace: ABILITY_NAMESPACE, payload: {} },
                { namespace: SYSTEM_ALL_NAMESPACE, payload: {} }
            ]
        });

        const ability = decodeAbilityGetAck(abilityReply.payload);
        this.graph.enroll({
            abilityPayload: abilityReply.payload,
            allPayload: allReply.payload,
            cloud: cloudDevice,
            subDevices: 'Appliance.Hub.SubdeviceList' in ability
                ? await this.cloud.listSubDevices(cloudDevice.uuid).catch(() => [])
                : undefined
        });
    }

    private materializeEndpoints(): void {
        const rows = this.graph.inventoryRows();
        this.inventory.replace(rows);
        for (const row of rows) {
            if (!this.endpoints.has(row.id)) {
                this.endpoints.set(row.id, this.createEndpoint(this.graph.getEndpoint(row.id)!));
            }
        }
        const byUuid = new Map<string, Endpoint[]>();
        for (const row of rows) {
            const uuid = this.graph.getEndpoint(row.id)!.uuid;
            const group = byUuid.get(uuid) ?? [];
            group.push(this.endpoints.get(row.id)!);
            byUuid.set(uuid, group);
        }
        for (const [uuid, endpoints] of byUuid) {
            if (this.boards.has(uuid)) {
                continue;
            }
            const physical = this.graph.getPhysical(uuid)!;
            const request = this.deviceRequest(physical);
            let poller!: DevicePoller;
            const availability = new DeviceAvailability({
                uuid,
                initialOnline: physical.online,
                endpoints,
                request: (namespace, method, payload) => request({
                    namespace,
                    method,
                    payload: payload ?? {}
                }),
                onOnlineChange: (online) => poller.setOnline(online),
                onInnerIp: (innerIp) => {
                    physical.innerIp = innerIp;
                }
            });
            poller = new DevicePoller({
                uuid,
                isOnline: () => availability.isOnline(),
                isCloudPath: () => this.router!.isCloudPath(uuid, physical.innerIp),
                maxCmdNum: () => physical.maxCmdNum,
                requestGets: (gets, maxCmdNum) => this.router!.requestGets({
                    uuid,
                    gets,
                    maxCmdNum,
                    ...this.lanBind(physical)
                }),
                onAck: (message) => this.handlePush(message),
                jobs: buildPollJobs(physical.ability, physical.endpoints)
            });
            this.boards.set(uuid, { availability, poller });
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
                    emitChange: (values) => endpoint.emit('change', {
                        trait: 'switch',
                        values: { ...values }
                    })
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
                    emitChange: (values) => endpoint.emit('change', {
                        trait: 'switch',
                        values: { ...values }
                    })
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
                emitChange: (values) => endpoint.emit('change', {
                    trait: 'energy',
                    values: { ...values }
                })
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
                emitChange: (values) => endpoint.emit('change', {
                    trait: 'light',
                    values: { ...values }
                })
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
                namespaces: new Set(Object.keys(physical.ability)),
                request,
                emitChange: (values) => endpoint.emit('change', {
                    trait: 'cover',
                    values: { ...values }
                })
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
                    emitChange: (values) => endpoint.emit('change', {
                        trait: 'climate',
                        values: { ...values }
                    })
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
                    emitChange: (values) => endpoint.emit('change', {
                        trait: 'climate',
                        values: { ...values }
                    })
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
                    emitChange: (values) => endpoint.emit('change', {
                        trait: 'sensor',
                        values: { ...values }
                    })
                });
            }
        }
        if (graphEndpoint.traits.includes('presence')) {
            presenceTrait = new PresenceTrait({
                uuid: physical.uuid,
                channel,
                namespaces,
                request,
                emitChange: (values) => endpoint.emit('change', {
                    trait: 'presence',
                    values: { ...values }
                })
            });
        }
        if (graphEndpoint.traits.includes('sprinkler') && graphEndpoint.subDeviceId) {
            sprinklerTrait = new SprinklerTrait({
                uuid: physical.uuid,
                subDeviceId: graphEndpoint.subDeviceId,
                namespaces,
                request,
                emitChange: (values) => endpoint.emit('change', {
                    trait: 'sprinkler',
                    values: { ...values }
                })
            });
        }
        if (graphEndpoint.traits.includes('spray')) {
            sprayTrait = new SprayTrait({
                uuid: physical.uuid,
                channel,
                request,
                emitChange: (values) => endpoint.emit('change', {
                    trait: 'spray',
                    values: { ...values }
                })
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
                emitChange: (values) => endpoint.emit('change', {
                    trait: 'fan',
                    values: { ...values }
                })
            });
        }
        if (graphEndpoint.traits.includes('diffuser')) {
            diffuserTrait = new DiffuserTrait({
                uuid: physical.uuid,
                channel,
                namespaces,
                request,
                emitChange: (values) => endpoint.emit('change', {
                    trait: 'diffuser',
                    values: { ...values }
                })
            });
        }
        if (graphEndpoint.traits.includes('media')) {
            mediaTrait = new MediaTrait({
                uuid: physical.uuid,
                channel,
                request,
                emitChange: (values) => endpoint.emit('change', {
                    trait: 'media',
                    values: { ...values }
                })
            });
        }
        if (graphEndpoint.traits.includes('alarm')) {
            alarmTrait = new AlarmTrait({
                uuid: physical.uuid,
                channel,
                namespaces,
                request,
                emitChange: (values) => endpoint.emit('change', {
                    trait: 'alarm',
                    values: { ...values }
                })
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
                emitChange: (values) => endpoint.emit('change', {
                    trait: 'system',
                    values: { ...values }
                })
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
                emitChange: (values) => endpoint.emit('change', {
                    trait: 'timer',
                    values: { ...values }
                })
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
                emitChange: (values) => endpoint.emit('change', {
                    trait: 'trigger',
                    values: { ...values }
                })
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
            this.router!.request({
                uuid: physical.uuid,
                ...this.lanBind(physical),
                ...options
            });
    }
}
