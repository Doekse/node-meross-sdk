import { CommandError, ProtocolError } from '../errors';
import type { MerossMessage } from './message';

/** MQTT/LAN replies usually arrive well under this; transports can override. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;

interface PendingEntry {
    resolve: (message: MerossMessage) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

/**
 * Correlates outbound `messageId` to ACK/ERROR so a same-tick reply cannot
 * miss the registry and a hung device cannot leak its timer.
 */
export class PendingRequests {
    private readonly entries = new Map<string, PendingEntry>();

    has(messageId: string): boolean {
        return this.entries.has(messageId);
    }

    /**
     * Call before the bytes go on the wire. Duplicate ids would overwrite the
     * timer handle and let the old timeout delete the new entry.
     */
    register(messageId: string, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS): Promise<MerossMessage> {
        if (this.entries.has(messageId)) {
            throw new ProtocolError(
                `pending request already registered for ${messageId}`,
                'DUPLICATE_MESSAGE_ID'
            );
        }

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.entries.delete(messageId);
                reject(new CommandError(
                    `Command timed out after ${timeoutMs}ms`,
                    'COMMAND_TIMEOUT'
                ));
            }, timeoutMs);

            this.entries.set(messageId, { resolve, reject, timer });
        });
    }

    /**
     * @returns false when this id was never registered or already settled
     */
    settle(message: MerossMessage): boolean {
        const entry = this.entries.get(message.header.messageId);
        if (!entry) {
            return false;
        }
        clearTimeout(entry.timer);
        this.entries.delete(message.header.messageId);
        if (message.header.method === 'ERROR') {
            const rawCode = (message.payload as { error?: { code?: unknown } }).error?.code;
            const deviceCode = typeof rawCode === 'number' ? rawCode : undefined;
            entry.reject(new CommandError(
                `Device returned error: ${JSON.stringify(message.payload)}`,
                'COMMAND_FAILED',
                deviceCode
            ));
        } else {
            entry.resolve(message);
        }
        return true;
    }

    /**
     * Publish failed: fail the waiter now instead of waiting for timeout.
     */
    reject(messageId: string, error: Error): boolean {
        const entry = this.entries.get(messageId);
        if (!entry) {
            return false;
        }
        clearTimeout(entry.timer);
        this.entries.delete(messageId);
        entry.reject(error);
        return true;
    }

    /**
     * Disconnect path: outstanding promises must not hang or keep timers.
     */
    clear(): void {
        const error = new CommandError('Pending command cancelled', 'COMMAND_CANCELLED');
        for (const entry of this.entries.values()) {
            clearTimeout(entry.timer);
            entry.reject(error);
        }
        this.entries.clear();
    }
}
