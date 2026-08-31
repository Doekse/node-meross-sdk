import { EventEmitter } from 'node:events';

import type { MerossMessage } from '../../src/protocol';
import type { MqttBrokerClient } from '../../src/transport';

/**
 * In-memory mqtt.js stand-in. Tests inject this via `connect` so Session and
 * MqttTransport never talk to a broker.
 *
 * Session enrollment assigns {@link autoAck} so Ability / System.All GETs
 * settle as they are published. Transport tests leave it unset and call
 * {@link deliver} themselves.
 */
export class FakeMqttClient extends EventEmitter implements MqttBrokerClient {
    readonly subscriptions: string[] = [];
    readonly published: Array<{ topic: string; payload: string }> = [];
    ended = false;
    reconnects = 0;
    publishError: Error | null = null;
    subscribeError: Error | null = null;
    /**
     * Optional reply factory. Return a message to deliver on the subscribe
     * topic, or undefined to leave the publish unanswered.
     */
    autoAck?: (payload: string) => MerossMessage | undefined;

    private readonly subscribeTopic: string;

    constructor(options: { userId?: string } = {}) {
        super();
        this.subscribeTopic = `/app/${options.userId ?? '42'}/subscribe`;
    }

    subscribe(topic: string, callback: (error?: Error | null) => void): void {
        this.subscriptions.push(topic);
        callback(this.subscribeError);
    }

    publish(topic: string, payload: string, callback: (error?: Error | null) => void): void {
        this.published.push({ topic, payload });
        callback(this.publishError);
        if (this.publishError !== null || this.autoAck === undefined) {
            return;
        }
        const reply = this.autoAck(payload);
        if (reply !== undefined) {
            queueMicrotask(() => this.deliver(reply));
        }
    }

    end(_force: boolean, callback: () => void): void {
        this.ended = true;
        this.emit('close');
        callback();
    }

    /**
     * mqtt.js reopens the same client and emits `connect` again; tests drive
     * that event so a persistent subscribe failure cannot loop.
     */
    reconnect(): void {
        this.reconnects += 1;
    }

    deliver(message: MerossMessage | string): void {
        const payload = typeof message === 'string' ? message : JSON.stringify(message);
        this.emit('message', this.subscribeTopic, Buffer.from(payload));
    }
}
