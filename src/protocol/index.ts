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
export { DEFAULT_COMMAND_TIMEOUT_MS, PendingRequests } from './pending';
export { ProtocolDispatcher } from './dispatcher';
export type { DispatchResult, DispatcherHandlers } from './dispatcher';
export { ONLINE_NAMESPACE, decodeOnlineStatus } from './codecs/online';
export {
    TOGGLEX_ALL_CHANNELS,
    TOGGLEX_NAMESPACE,
    decodeToggleXGetAck,
    decodeToggleXPush,
    encodeToggleXGet,
    encodeToggleXSet
} from './codecs/togglex';
export type {
    ToggleXChannel,
    ToggleXGetOptions,
    ToggleXSetOptions
} from './codecs/togglex';
export {
    LIGHT_NAMESPACE,
    LIGHT_CAPACITY_RGB,
    LIGHT_CAPACITY_TEMPERATURE,
    LIGHT_CAPACITY_LUMINANCE,
    LIGHT_CAPACITY_EFFECT,
    decodeLightGetAck,
    decodeLightPush,
    encodeLightGet,
    encodeLightSet
} from './codecs/light';
export type {
    LightChannelWireState,
    LightSetOptions
} from './codecs/light';
export {
    ELECTRICITY_NAMESPACE,
    ELECTRICITYX_NAMESPACE,
    decodeElectricityGetAck,
    decodeElectricityXGetAck,
    encodeElectricityGet,
    encodeElectricityXGet
} from './codecs/electricity';
export type {
    ElectricityConfig,
    ElectricityGetOptions,
    ElectricitySample
} from './codecs/electricity';
export {
    CONSUMPTIONX_NAMESPACE,
    decodeConsumptionXGetAck,
    encodeConsumptionXGet
} from './codecs/consumptionx';
export type { ConsumptionXDay } from './codecs/consumptionx';
export {
    GARAGE_STATE_NAMESPACE,
    SHUTTER_POSITION_NAMESPACE,
    SHUTTER_STATE_NAMESPACE,
    decodeGarageGetAck,
    decodeGaragePush,
    decodeShutterPositionGetAck,
    decodeShutterPositionPush,
    decodeShutterStatePush,
    encodeGarageGet,
    encodeGarageSet,
    encodeShutterPositionGet,
    encodeShutterPositionSet
} from './codecs/cover';
export type {
    GarageChannelState,
    GarageGetOptions,
    GarageSetOptions,
    ShutterMoveState,
    ShutterPositionSetOptions,
    ShutterPositionState
} from './codecs/cover';
export {
    HUB_TOGGLEX_NAMESPACE,
    MULTIPLE_NAMESPACE,
    SYSTEM_ALL_NAMESPACE,
    canPackInMultiple,
    decodeMultipleAck,
    encodeMultipleSet
} from './codecs/multiple';
export type { MultipleSubCommand } from './codecs/multiple';
export {
    ENCRYPT_ECDHE_NAMESPACE,
    ENCRYPT_SUITE_NAMESPACE,
    EcdheHandshake,
    decodeEncryptEcdheSetAck,
    decodeEncryptSuiteGetAck,
    decryptPayload,
    deriveEncryptionKey,
    encodeEncryptEcdheSet,
    encryptPayload,
    supportsLanEncryption
} from './encryption';
export type { EncryptEcdhe, EncryptSuite } from './encryption';
