/**
 * Kernel: message envelope, signing, encryption, and namespace codecs.
 * Unexported from the package entry; transports and codecs import from here.
 */
export { signMessage, verifySignature } from './sign';
export {
    DEFAULT_TRIGGER_SRC,
    PAYLOAD_VERSION,
    decodeMessage,
    encodeMessage
} from './message';
export type {
    EncodeMessageOptions,
    MerossHeader,
    MerossMessage,
    MerossPayload
} from './message';
