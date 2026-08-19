import { CloudClient } from './cloud';
import type { CloudClientOptions, CloudDevice } from './cloud';
import { Endpoint } from './endpoint';
import { MerossError } from './errors';
import {
    ABILITY_NAMESPACE,
    DeviceGraph,
    SYSTEM_ALL_NAMESPACE,
    decodeAbilityGetAck
} from './graph';
import type { GraphEndpoint, PhysicalDevice } from './graph';
import { DeviceAvailability } from './graph/availability';
import { Inventory } from './inventory';
import {
    CONSUMPTIONH_NAMESPACE,
    CONSUMPTIONX_NAMESPACE,
    ELECTRICITY_NAMESPACE,
    ELECTRICITYX_NAMESPACE,
    LIGHT_EFFECT_NAMESPACE,
    ProtocolDispatcher,
    TOGGLEX_NAMESPACE,
    deriveEncryptionKey,
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
import { ClimateTrait } from './traits/climate';
import type { ThermostatGeneration } from './traits/climate';
import { CoverTrait } from './traits/cover';
import { DiffuserTrait } from './traits/diffuser';
import { EnergyTrait } from './traits/energy';
import { FanTrait } from './traits/fan';
import { LightTrait } from './traits/light';
import { MediaTrait } from './traits/media';
import { PresenceTrait } from './traits/presence';
import { SENSOR_FAMILY_MAP, SensorTrait } from './traits/sensor';
import { SprayTrait } from './traits/spray';
import { SprinklerTrait } from './traits/sprinkler';
import { SwitchTrait } from './traits/switch';

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

/**
 * Cloud credentials plus live inventory. Homey persists {@link TokenData}
 * via `storeData` and rebuilds a session with {@link Session.restore}.
 */
export class Session {
    readonly inventory: Inventory;

    private readonly cloud: CloudClient;
    private readonly token: TokenData;
    private readonly mqttConnect?: MqttConnectFn;
    private readonly lanFetch?: typeof globalThis.fetch;
    private graph = new DeviceGraph();
    private readonly endpoints = new Map<string, Endpoint>();
    private readonly availability = new Map<string, DeviceAvailability>();
    private router: TransportRouter | undefined;

    private constructor(
        token: TokenData,
        cloud: CloudClient,
        options: SessionOptions = {}
    ) {
        this.token = token;
        this.cloud = cloud;
        this.mqttConnect = options.mqttConnect;
        this.lanFetch = options.lanFetch;
        this.inventory = new Inventory();
    }

    /**
     * Exchanges email/password (and optional MFA) for a session.
     */
    static async login(
        options: LoginOptions,
        sessionOptions: SessionOptions = {}
    ): Promise<Session> {
        const cloud = await CloudClient.login(options, sessionOptions.cloud);
        return new Session(cloud.getToken(), cloud, sessionOptions);
    }

    /**
     * Rebuilds a session from a previously stored token without a password.
     */
    static restore(token: TokenData, sessionOptions: SessionOptions = {}): Session {
        const cloud = CloudClient.restore(token, sessionOptions.cloud);
        return new Session(cloud.getToken(), cloud, sessionOptions);
    }

    /**
     * Returns a copy of the stored token so callers can persist it safely.
     */
    getToken(): TokenData {
        return { ...this.token };
    }

    /**
     * Opens MQTT/LAN transports, enrolls devices from Ability + System.All,
     * and refreshes {@link Inventory}.
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
            connect: this.mqttConnect
        });
        const lan = new LanHttpTransport({
            key: this.token.key,
            from: mqtt.clientResponseTopic,
            dispatcher,
            fetch: this.lanFetch
        });
        this.router = new TransportRouter({ mqtt, lan });
        await this.router.connect();
        await this.sync();
    }

    /**
     * Re-lists the cloud account and protocol-enrolls boards that are not in
     * inventory yet. Offline or unreachable boards are skipped.
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
        for (const endpoint of this.endpoints.values()) {
            endpoint.energy?.stop();
        }
        this.endpoints.clear();
        this.stopAvailability();
        this.graph = new DeviceGraph();
        this.inventory.replace([]);
        const router = this.router;
        this.router = undefined;
        await router?.disconnect();
    }

    /**
     * Returns the Homey-facing device for an inventory row id.
     */
    endpoint(id: string): Endpoint {
        const endpoint = this.endpoints.get(id);
        if (!endpoint) {
            throw new MerossError(`Unknown endpoint: ${id}`, 'ENDPOINT_NOT_FOUND');
        }
        return endpoint;
    }

    private handlePush(message: MerossMessage): void {
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
        }
    }

    private handleInbound(message: MerossMessage): void {
        for (const monitor of this.availability.values()) {
            monitor.handleMessage(message);
        }
    }

    private stopAvailability(): void {
        for (const monitor of this.availability.values()) {
            monitor.stop();
        }
        this.availability.clear();
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
            if (this.availability.has(uuid)) {
                continue;
            }
            const physical = this.graph.getPhysical(uuid)!;
            const request = this.deviceRequest(physical);
            const monitor = new DeviceAvailability({
                uuid,
                initialOnline: physical.online,
                endpoints,
                request: (namespace, method, payload) => request({
                    namespace,
                    method,
                    payload: payload ?? {}
                })
            });
            this.availability.set(uuid, monitor);
            monitor.start();
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
        if (graphEndpoint.traits.includes('switch')) {
            if (graphEndpoint.subDeviceId) {
                switchTrait = new SwitchTrait({
                    kind: 'hub',
                    uuid: physical.uuid,
                    subDeviceId: graphEndpoint.subDeviceId,
                    initialOn: graphEndpoint.on,
                    request,
                    emitChange: (on) => endpoint.emit('change', { trait: 'switch', values: { on } })
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
                    emitChange: (on) => endpoint.emit('change', { trait: 'switch', values: { on } })
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
            initialOnline: graphEndpoint.online
        });
        energyTrait?.start();
        lightTrait?.start();
        coverTrait?.start();
        climateTrait?.start();
        sensorTrait?.start();
        presenceTrait?.start();
        sprinklerTrait?.start();
        sprayTrait?.start();
        fanTrait?.start();
        diffuserTrait?.start();
        mediaTrait?.start();
        return endpoint;
    }

    private deviceRequest(physical: PhysicalDevice) {
        const encryptionKey = supportsLanEncryption(physical.ability) && physical.macAddress
            ? deriveEncryptionKey(physical.uuid, this.token.key, physical.macAddress)
            : undefined;
        return (options: Omit<RoutedRequestOptions, 'uuid' | 'ip' | 'encryptionKey'>) =>
            this.router!.request({
                uuid: physical.uuid,
                ip: physical.innerIp,
                encryptionKey,
                ...options
            });
    }
}
