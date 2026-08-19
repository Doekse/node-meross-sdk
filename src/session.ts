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
import { Inventory } from './inventory';
import { ProtocolDispatcher, TOGGLEX_NAMESPACE, type MerossMessage } from './protocol';
import {
    LanHttpTransport,
    MqttTransport,
    TransportRouter,
    type MqttConnectFn
} from './transport';
import { EnergyTrait } from './traits/energy';
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
 * Test hooks and host overrides. Transports stay internal; only cloud `fetch`
 * and MQTT connect are injectable so CI can run without a broker.
 */
export interface SessionOptions {
    cloud?: CloudClientOptions;
    mqttConnect?: MqttConnectFn;
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
    private readonly graph = new DeviceGraph();
    private readonly endpoints = new Map<string, Endpoint>();
    private router: TransportRouter | undefined;

    private constructor(
        token: TokenData,
        cloud: CloudClient,
        options: SessionOptions = {}
    ) {
        this.token = token;
        this.cloud = cloud;
        this.mqttConnect = options.mqttConnect;
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

        const dispatcher = new ProtocolDispatcher((message) => this.handlePush(message));
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
            dispatcher
        });
        this.router = new TransportRouter({ mqtt, lan });
        await this.router.connect();

        for (const cloudDevice of await this.cloud.listDevices()) {
            try {
                await this.enroll(cloudDevice);
            } catch {
                // Offline or unreachable boards stay out of inventory until a later connect.
            }
        }

        const rows = this.graph.inventoryRows();
        this.inventory.replace(rows);
        this.endpoints.clear();
        for (const row of rows) {
            let endpoint!: Endpoint;
            let switchTrait: SwitchTrait | undefined;
            if (row.traits.includes('switch')) {
                const graphEndpoint = this.graph.getEndpoint(row.id)!;
                const physical = this.graph.getPhysical(graphEndpoint.uuid)!;
                switchTrait = new SwitchTrait({
                    uuid: physical.uuid,
                    channel: graphEndpoint.channel ?? 0,
                    namespace: 'Appliance.Control.ToggleX' in physical.ability
                        ? TOGGLEX_NAMESPACE
                        : 'Appliance.Control.Toggle',
                    request: (options) => this.router!.request({
                        uuid: physical.uuid,
                        ip: physical.innerIp,
                        ...options
                    }),
                    emitChange: (on) => endpoint.emit('change', { trait: 'switch', values: { on } })
                });
            }
            endpoint = new Endpoint({
                id: row.id,
                traits: row.traits,
                switch: switchTrait,
                energy: row.traits.includes('energy') ? new EnergyTrait() : undefined
            });
            this.endpoints.set(row.id, endpoint);
        }
    }

    /**
     * Closes transports without discarding the stored token.
     */
    async disconnect(): Promise<void> {
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
        }
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
}
