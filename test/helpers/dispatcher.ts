import type { ProtocolDispatcher } from '../../src/protocol/dispatcher';
import type { MerossMessage } from '../../src/protocol/message';

/**
 * In-memory stand-in for MQTT/LAN: register before "send", then inject
 * inbound envelopes the way a broker would.
 */
export class FakeTransport {
    constructor(private readonly dispatcher: ProtocolDispatcher) {}

    request(message: MerossMessage, timeoutMs?: number): Promise<MerossMessage> {
        return this.dispatcher.pending.register(message.header.messageId, timeoutMs);
    }

    deliver(message: MerossMessage) {
        return this.dispatcher.handle(message);
    }
}
