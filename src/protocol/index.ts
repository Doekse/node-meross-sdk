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
    LIGHT_EFFECT_NAMESPACE,
    LIGHT_CAPACITY_RGB,
    LIGHT_CAPACITY_TEMPERATURE,
    LIGHT_CAPACITY_LUMINANCE,
    LIGHT_CAPACITY_EFFECT,
    decodeLightGetAck,
    decodeLightPush,
    encodeLightGet,
    encodeLightSet,
    decodeLightEffectGetAck,
    decodeLightEffectPush,
    encodeLightEffectGet,
    encodeLightEffectSet
} from './codecs/light';
export type {
    LightChannelWireState,
    LightSetOptions,
    LightEffectEntry
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
    GARAGE_CONFIG_NAMESPACE,
    GARAGE_MULTIPLE_CONFIG_NAMESPACE,
    SHUTTER_POSITION_NAMESPACE,
    SHUTTER_STATE_NAMESPACE,
    decodeGarageGetAck,
    decodeGaragePush,
    decodeGarageConfigGetAck,
    decodeGarageMultipleConfigGetAck,
    decodeGarageMultipleConfigPush,
    decodeShutterPositionGetAck,
    decodeShutterPositionPush,
    decodeShutterStatePush,
    encodeGarageGet,
    encodeGarageSet,
    encodeGarageConfigGet,
    encodeGarageConfigSet,
    encodeGarageMultipleConfigGet,
    encodeGarageMultipleConfigSet,
    encodeShutterPositionGet,
    encodeShutterPositionSet
} from './codecs/cover';
export type {
    GarageChannelState,
    GarageGetOptions,
    GarageSetOptions,
    GarageDoorConfig,
    GarageMultipleConfigEntry,
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
    THERMOSTAT_MODE_NAMESPACE,
    THERMOSTAT_MODEB_NAMESPACE,
    THERMOSTAT_MODEC_NAMESPACE,
    HUB_MTS100_MODE_NAMESPACE,
    HUB_MTS100_TEMPERATURE_NAMESPACE,
    HOLD_ACTION_NAMESPACE,
    WINDOW_OPENED_NAMESPACE,
    SENSOR_NAMESPACE,
    FROST_NAMESPACE,
    CALIBRATION_NAMESPACE,
    OVERHEAT_NAMESPACE,
    DEAD_ZONE_NAMESPACE,
    SUMMER_MODE_NAMESPACE,
    COMPRESSOR_DELAY_NAMESPACE,
    CTL_RANGE_NAMESPACE,
    TIMER_NAMESPACE,
    ALARM_NAMESPACE,
    ALARM_CONFIG_NAMESPACE,
    SCHEDULE_NAMESPACE,
    SCHEDULEB_NAMESPACE,
    HUB_MTS100_ALL_NAMESPACE,
    HUB_MTS100_ADJUST_NAMESPACE,
    HUB_MTS100_CONFIG_NAMESPACE,
    HUB_MTS100_SUPERCTL_NAMESPACE,
    HUB_MTS100_SCHEDULE_NAMESPACE,
    HUB_MTS100_SCHEDULEB_NAMESPACE,
    HUB_MTS100_TIMESYNC_NAMESPACE,
    SCHEDULEB_OFF,
    SCHEDULEB_HUB_OFF,
    decodeThermostatModeGetAck,
    decodeThermostatModePush,
    decodeThermostatModeBGetAck,
    decodeThermostatModeBPush,
    decodeThermostatModeCGetAck,
    decodeThermostatModeCPush,
    encodeThermostatModeGet,
    encodeThermostatModeSet,
    encodeThermostatModeBGet,
    encodeThermostatModeBSet,
    encodeThermostatModeCGet,
    encodeThermostatModeCSet,
    encodeHubToggleXSet,
    encodeHubToggleXGet,
    decodeHubToggleXGetAck,
    decodeHubToggleXPush,
    encodeHubMts100ModeSet,
    encodeHubMts100ModeGet,
    decodeHubMts100ModeGetAck,
    decodeHubMts100ModePush,
    encodeHubMts100TemperatureGet,
    encodeHubMts100TemperatureSet,
    decodeHubMts100TemperatureGetAck,
    decodeHubMts100TemperaturePush,
    encodeThermostatChannelGet,
    encodeHubIdGet,
    encodeHoldActionSet,
    decodeHoldAction,
    encodeWindowOpenedSet,
    decodeWindowOpened,
    encodeSensorModeSet,
    decodeSensorMode,
    encodeFrostSet,
    decodeFrost,
    encodeCalibrationSet,
    decodeCalibration,
    encodeOverheatSet,
    decodeOverheat,
    encodeDeadZoneSet,
    decodeDeadZone,
    encodeSummerModeSet,
    decodeSummerMode,
    encodeCompressorDelaySet,
    decodeCompressorDelay,
    encodeCtlRangeSet,
    decodeCtlRange,
    encodeTimerSet,
    decodeTimer,
    decodeAlarm,
    encodeAlarmConfigSet,
    decodeAlarmConfig,
    encodeScheduleSet,
    decodeSchedule,
    encodeHubAdjustSet,
    decodeHubAdjust,
    encodeHubConfigSet,
    decodeHubConfig,
    encodeHubSuperCtlSet,
    decodeHubSuperCtl,
    encodeHubScheduleSet,
    decodeHubSchedule,
    decodeHubTimeSync,
    decodeHubMts100All
} from './codecs/climate';
export type {
    ClimateMode,
    ClimateWorkMode,
    ClimateFanSpeed,
    ClimateWeekday,
    ClimateHoldMode,
    ClimateSensorMode,
    ClimateAlarmKind,
    ClimateTimerKind,
    ClimateTimer,
    ClimateSchedule,
    HubMts100ModeSetOptions,
    HubMts100TemperatureSetOptions,
    HubMts100TemperatureState,
    HubSubdeviceGetOptions,
    HubToggleXSetOptions,
    ThermostatGetOptions,
    ThermostatModeBSetOptions,
    ThermostatModeSetOptions,
    ThermostatState
} from './codecs/climate';
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
export {
    HUB_SENSOR_TEMPHUM_NAMESPACE,
    HUB_SENSOR_DOORWINDOW_NAMESPACE,
    HUB_SENSOR_WATERLEAK_NAMESPACE,
    HUB_SENSOR_SMOKE_NAMESPACE,
    HUB_SENSOR_ADJUST_NAMESPACE,
    HUB_SENSOR_ALERT_NAMESPACE,
    HUB_SENSOR_ALL_NAMESPACE,
    HUB_BATTERY_NAMESPACE,
    SENSOR_LATESTX_NAMESPACE,
    encodeSensorTempHumGet,
    decodeSensorTempHumGetAck,
    decodeSensorTempHumPush,
    encodeSensorDoorWindowGet,
    decodeSensorDoorWindowGetAck,
    decodeSensorDoorWindowPush,
    encodeSensorWaterLeakGet,
    decodeSensorWaterLeakGetAck,
    decodeSensorWaterLeakPush,
    encodeSensorSmokeGet,
    encodeSensorSmokeSet,
    decodeSensorSmokeGetAck,
    decodeSensorSmokePush,
    encodeBatteryGet,
    decodeBatteryGetAck,
    decodeBatteryPush,
    encodeSensorAdjustGet,
    encodeSensorAdjustSet,
    decodeSensorAdjustGetAck,
    decodeSensorAdjustPush,
    encodeSensorAlertGet,
    encodeSensorAlertSet,
    decodeSensorAlertGetAck,
    decodeSensorAlertPush,
    encodeSensorAllGet,
    decodeSensorAllGetAck,
    decodeSensorAllPush,
    encodeLatestXGet,
    decodeLatestXGetAck,
    decodeLatestXPush
} from './codecs/sensor';
export type {
    SensorTempHumState,
    SensorDoorWindowState,
    SensorWaterLeakState,
    SensorSmokeState,
    SensorBatteryState,
    SensorAdjustState,
    SensorAlertBand,
    SensorAlertState,
    SensorAllState,
    LatestXState
} from './codecs/sensor';
