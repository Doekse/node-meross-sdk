import type { CloudDevice, CloudSubDevice } from '../cloud';
import { Endpoint } from '../endpoint';
import { MerossError } from '../errors';
import type { InventoryRow } from '../inventory';
import { buildPollJobs } from '../poll';
import {
    ONLINE_NAMESPACE,
    decodeOnlineStatus
} from '../protocol/codecs/online';
import {
    LanEncryptionKeys,
    macAddressFromUuid,
    supportsLanEncryption
} from '../protocol/encryption';
import { EMPTY_PAYLOAD, type MerossMessage, type MerossPayload } from '../protocol/message';
import { HUB_SUBDEVICE_LIST_NAMESPACE } from '../protocol/namespaces';
import type { DeviceRequest } from '../request';
import type { GetCommand } from '../transport/router';
import { attachEndpoint } from './attach';
import {
    ABILITY_NAMESPACE,
    SYSTEM_ALL_NAMESPACE,
    decodeAbilityGetAck,
    enrollPhysicalDevice,
    projectInventoryRows,
    type PhysicalDevice
} from './index';
import { DeviceRuntime } from './runtime';

/**
 * Transport and session hooks Board needs without owning the router or cloud
 * client. Scoped to this board's uuid by the Session that constructs it.
 */
export interface BoardDeps {
    request: (options: {
        namespace: string;
        method: string;
        payload?: MerossPayload;
        priority?: 'user' | 'background';
        ip?: string | null;
        encryptionKey?: Buffer;
    }) => Promise<MerossMessage>;
    requestGets: (options: {
        gets: GetCommand[];
        maxCmdNum?: number;
        priority?: 'user' | 'background';
        ip?: string | null;
        encryptionKey?: Buffer;
        onPackedFallback?: () => void;
    }) => Promise<MerossMessage[]>;
    isCloudPath: (ip?: string | null) => boolean;
    isHttpDown: () => boolean;
    /** Account key so reauthenticate refreshes the next LAN wrap. */
    userKey: () => string;
    listSubDevices: (uuid: string) => Promise<CloudSubDevice[]>;
    warn: (error: unknown, uuid?: string) => void;
    /** Called only when a runtime is constructed. */
    nextStartDelayMs: () => number;
    isClosing: () => boolean;
}

/**
 * One physical device: enroll, endpoints, poller/availability runtime, and that
 * uuid's LAN key memo. Session keeps credentials, transports, and membership.
 */
export class Board {
    readonly uuid: string;
    private readonly deps: BoardDeps;
    private readonly lanKeys = new LanEncryptionKeys();
    private readonly endpoints = new Map<string, Endpoint>();
    private physical: PhysicalDevice | undefined;
    private runtime: DeviceRuntime | undefined;
    /** After {@link stop}, {@link request} rejects like an unenrolled device. */
    private stopped = false;

    constructor(uuid: string, deps: BoardDeps) {
        this.uuid = uuid;
        this.deps = deps;
    }

    /**
     * Ability + System.All, then attach and construct the runtime. Create-once:
     * Session never re-reads a live board. Does not start the poller — Session
     * registers the board before {@link start} so push lookup cannot miss the
     * first tick. Returns false when closing after the Ability await.
     */
    async enroll(cloudDevice: CloudDevice): Promise<boolean> {
        if (this.runtime || this.physical) {
            throw new MerossError(
                `Board already enrolled: ${this.uuid}`,
                'ALREADY_ENROLLED'
            );
        }
        const [abilityReply, allReply] = await this.deps.requestGets({
            gets: [
                { namespace: ABILITY_NAMESPACE, payload: EMPTY_PAYLOAD },
                { namespace: SYSTEM_ALL_NAMESPACE, payload: EMPTY_PAYLOAD }
            ]
        });

        const ability = decodeAbilityGetAck(abilityReply.payload);
        let subDevices: CloudSubDevice[] | undefined;
        if (HUB_SUBDEVICE_LIST_NAMESPACE in ability) {
            try {
                subDevices = await this.deps.listSubDevices(cloudDevice.uuid);
            } catch (error) {
                // Digest children still enroll; only the cloud name overlay is lost.
                this.deps.warn(error, cloudDevice.uuid);
            }
        }

        if (this.deps.isClosing()) {
            return false;
        }

        this.physical = enrollPhysicalDevice({
            abilityPayload: abilityReply.payload,
            allPayload: allReply.payload,
            cloud: cloudDevice,
            subDevices
        });
        this.materialize();
        return true;
    }

    /**
     * Session calls after `boards.set` so a start failure still counts as enrolled.
     */
    start(): void {
        this.runtime?.start();
    }

    /**
     * Inventory ids for this uuid only. Session flatMaps every board.
     */
    inventoryRows(): InventoryRow[] {
        return this.physical ? projectInventoryRows(this.physical) : [];
    }

    endpoint(id: string): Endpoint {
        const endpoint = this.endpoints.get(id);
        if (!endpoint) {
            throw new MerossError(`Unknown endpoint: ${id}`, 'ENDPOINT_NOT_FOUND');
        }
        return endpoint;
    }

    handlePush(message: MerossMessage): void {
        this.runtime?.handlePush(message);
    }

    /**
     * MQTT (`originUuid` omitted) records liveness, except System.Online that
     * is not PUSH with status 1. LAN (POST uuid) applies handleMessage without
     * recording liveness.
     */
    handleInbound(message: MerossMessage, originUuid?: string): void {
        if (!this.runtime) {
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
            this.runtime.recordPush();
        }
        this.runtime.handleMessage(message);
    }

    clearMqtt(): void {
        this.runtime?.clearMqtt();
    }

    /**
     * Stops the runtime and drops the LAN key. Session still calls
     * `router.forget` because it owns the router.
     */
    stop(): void {
        this.stopped = true;
        this.lanKeys.remove(this.uuid);
        const runtime = this.runtime;
        if (!runtime) {
            return;
        }
        runtime.stop();
        this.endpoints.clear();
        this.runtime = undefined;
    }

    private materialize(): void {
        const physical = this.physical!;
        const request = this.deviceRequest(physical);
        const namespaces = new Set(Object.keys(physical.ability));
        const attached: Endpoint[] = [];
        for (const graphEndpoint of physical.endpoints) {
            const endpoint = attachEndpoint(graphEndpoint, request, physical, namespaces);
            this.endpoints.set(graphEndpoint.id, endpoint);
            attached.push(endpoint);
        }

        const startDelayMs = this.deps.nextStartDelayMs();
        this.runtime = new DeviceRuntime({
            uuid: this.uuid,
            initialOnline: physical.online,
            endpoints: attached,
            request: (namespace, method, payload) => request({
                namespace,
                method,
                payload: payload ?? EMPTY_PAYLOAD,
                priority: 'background'
            }),
            onInnerIp: (innerIp) => {
                physical.innerIp = innerIp;
            },
            isCloudPath: () => this.deps.isCloudPath(physical.innerIp),
            httpDown: () => this.deps.isHttpDown(),
            maxCmdNum: () => physical.maxCmdNum,
            requestGets: (gets, maxCmdNum, onPackedFallback) => this.deps.requestGets({
                gets,
                maxCmdNum,
                priority: 'background',
                ...this.lanBind(physical),
                onPackedFallback
            }),
            onAck: (message) => this.handlePush(message),
            jobs: buildPollJobs(physical.ability, physical.endpoints, physical.digestNamespaces),
            startDelayMs
        });
    }

    private lanBind(physical: PhysicalDevice) {
        if (!supportsLanEncryption(physical.ability)) {
            this.lanKeys.remove(physical.uuid);
            return { ip: physical.innerIp };
        }
        const mac = physical.macAddress ?? macAddressFromUuid(physical.uuid);
        return {
            ip: physical.innerIp,
            encryptionKey: this.lanKeys.derive(
                physical.uuid,
                this.deps.userKey(),
                mac
            )
        };
    }

    private deviceRequest(physical: PhysicalDevice): DeviceRequest {
        return (options) => {
            if (this.stopped || !this.runtime) {
                throw new MerossError(
                    `Unknown endpoint: ${physical.uuid}`,
                    'ENDPOINT_NOT_FOUND'
                );
            }
            return this.deps.request({
                ...this.lanBind(physical),
                ...options
            }).finally(() => {
                this.runtime?.publishProtocol();
            });
        };
    }
}
