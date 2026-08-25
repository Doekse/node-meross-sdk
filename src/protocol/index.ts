/**
 * Kernel: message envelope, signing, encryption, and namespace codecs.
 * Unexported from the package entry; transports and codecs import from here.
 */
export { signMessage, verifySignature } from './sign';
export {
    DEFAULT_TRIGGER_SRC,
    PAYLOAD_VERSION,
    decodeMessage,
    deviceErrorCode,
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
export {
    HUB_ONLINE_NAMESPACE,
    ONLINE_NAMESPACE,
    decodeHubOnline,
    decodeOnlineStatus
} from './codecs/online';
export type { HubOnlineEntry } from './codecs/online';
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
    ELECTRICITYX_ALL_CHANNELS,
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
    CONSUMPTIONH_NAMESPACE,
    decodeConsumptionHGetAck,
    encodeConsumptionHGet
} from './codecs/consumptionh';
export type { ConsumptionHChannel, ConsumptionHHour } from './codecs/consumptionh';
export {
    CONSUMPTIONX_NAMESPACE,
    decodeConsumptionXGetAck,
    encodeConsumptionXDelete,
    encodeConsumptionXGet
} from './codecs/consumptionx';
export type { ConsumptionXDay } from './codecs/consumptionx';
export {
    CONSUMPTION_CONFIG_NAMESPACE,
    decodeConsumptionConfigGetAck,
    decodeConsumptionConfigPush,
    encodeConsumptionConfigGet
} from './codecs/consumptionconfig';
export {
    GARAGE_STATE_NAMESPACE,
    GARAGE_CONFIG_NAMESPACE,
    GARAGE_MULTIPLE_CONFIG_NAMESPACE,
    SHUTTER_POSITION_NAMESPACE,
    SHUTTER_STATE_NAMESPACE,
    SHUTTER_CONFIG_NAMESPACE,
    SHUTTER_ADJUST_NAMESPACE,
    decodeGarageGetAck,
    decodeGaragePush,
    decodeGarageConfigGetAck,
    decodeGarageMultipleConfigGetAck,
    decodeGarageMultipleConfigPush,
    decodeShutterPositionGetAck,
    decodeShutterPositionPush,
    decodeShutterStatePush,
    decodeShutterConfigGetAck,
    decodeShutterConfigPush,
    decodeShutterAdjustGetAck,
    decodeShutterAdjustPush,
    encodeGarageGet,
    encodeGarageSet,
    encodeGarageConfigGet,
    encodeGarageConfigSet,
    encodeGarageMultipleConfigGet,
    encodeGarageMultipleConfigSet,
    encodeShutterPositionGet,
    encodeShutterPositionSet,
    encodeShutterConfigGet,
    encodeShutterConfigSet,
    encodeShutterAdjustGet,
    encodeShutterAdjustSet
} from './codecs/cover';
export type {
    GarageChannelState,
    GarageGetOptions,
    GarageSetOptions,
    GarageDoorConfig,
    GarageMultipleConfigEntry,
    ShutterMoveState,
    ShutterPositionSetOptions,
    ShutterPositionState,
    ShutterConfig,
    ShutterConfigSetOptions,
    ShutterAdjustValue,
    ShutterAdjustStatus
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
    THERMOSTAT_SYSTEM_NAMESPACE,
    HUB_MTS100_ALL_NAMESPACE,
    HUB_MTS100_ADJUST_NAMESPACE,
    HUB_MTS100_CONFIG_NAMESPACE,
    HUB_MTS100_SUPERCTL_NAMESPACE,
    HUB_MTS100_SCHEDULE_NAMESPACE,
    HUB_MTS100_SCHEDULEB_NAMESPACE,
    HUB_MTS100_TIMESYNC_NAMESPACE,
    TEMP_UNIT_NAMESPACE,
    PHYSICAL_LOCK_NAMESPACE,
    SCREEN_BRIGHTNESS_NAMESPACE,
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
    decodeHubMts100All,
    encodeTempUnitSet,
    decodeTempUnit,
    encodePhysicalLockGet,
    encodePhysicalLockSet,
    decodePhysicalLock,
    encodeScreenBrightnessSet,
    decodeScreenBrightness,
    encodeThermostatSystemSet,
    decodeThermostatSystemGetAck,
    decodeThermostatSystemPush
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
    ClimateTempUnit,
    ClimateSystem,
    ClimateSystemWire,
    HubMts100ModeSetOptions,
    HubMts100TemperatureSetOptions,
    HubMts100TemperatureState,
    HubSubdeviceGetOptions,
    HubToggleXSetOptions,
    ThermostatGetOptions,
    ThermostatModeBSetOptions,
    ThermostatModeSetOptions,
    ThermostatState,
    ThermostatSystemSetOptions,
    ThermostatSystemState
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
    PRESENCE_CONFIG_NAMESPACE,
    PRESENCE_STUDY_NAMESPACE,
    decodePresenceConfigGetAck,
    decodePresenceConfigPush,
    encodePresenceConfigGet,
    encodePresenceConfigSet,
    encodePresenceStudySet
} from './codecs/presence';
export type {
    PresenceConfig,
    PresenceConfigSetOptions,
    PresenceMode
} from './codecs/presence';
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
    SENSOR_LATEST_NAMESPACE,
    SENSOR_HISTORY_NAMESPACE,
    SENSOR_HISTORYX_NAMESPACE,
    SMOKE_CONFIG_NAMESPACE,
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
    decodeLatestXPush,
    encodeSensorLatestGet,
    decodeSensorLatestGetAck,
    decodeSensorLatestPush,
    encodeSensorHistoryGet,
    decodeSensorHistoryGetAck,
    decodeSensorHistoryPush,
    encodeSensorHistoryXGet,
    decodeSensorHistoryXGetAck,
    decodeSensorHistoryXPush,
    encodeSmokeConfigGet,
    encodeSmokeConfigSet,
    decodeSmokeConfigGetAck,
    decodeSmokeConfigPush
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
    LatestXState,
    SensorLatestState,
    SensorHistorySample,
    SensorHistoryState,
    SensorHistoryGetOptions,
    SensorHistoryXGetOptions,
    SensorHistoryXTempSample,
    SensorHistoryXHumiditySample,
    SensorHistoryXLightSample,
    SensorHistoryXPresenceSample,
    SensorHistoryXState,
    SmokeConfigState,
    SmokeConfigGetOptions,
    SmokeConfigSetOptions
} from './codecs/sensor';
export {
    CONTROL_WATER_NAMESPACE,
    DEVICE_CFG_NAMESPACE,
    WATER_PLAN_NAMESPACE,
    encodeWaterGet,
    encodeWaterSet,
    decodeWaterGetAck,
    decodeWaterPush,
    encodeDeviceCfgGet,
    encodeDeviceCfgSet,
    decodeDeviceCfgGetAck,
    decodeDeviceCfgPush,
    encodeWaterPlanGet,
    encodeWaterPlanSet,
    decodeWaterPlanGetAck,
    decodeWaterPlanPush
} from './codecs/water';
export type {
    WaterControlState,
    MstDeviceCfgState,
    WaterPlanEntry,
    WaterGetOptions,
    WaterSetOptions,
    DeviceCfgGetOptions,
    DeviceCfgSetOptions,
    WaterPlanGetOptions
} from './codecs/water';
export {
    SPRAY_NAMESPACE,
    decodeSprayGetAck,
    decodeSprayPush,
    encodeSprayGet,
    encodeSpraySet
} from './codecs/spray';
export type { SprayChannelState, SprayMode } from './codecs/spray';
export {
    FAN_NAMESPACE,
    FAN_CONFIG_NAMESPACE,
    FAN_BTN_CONFIG_NAMESPACE,
    FILTER_MAINTENANCE_NAMESPACE,
    decodeFanGetAck,
    decodeFanPush,
    decodeFanConfigGetAck,
    decodeFanBtnConfigPush,
    decodeFilterMaintenancePush,
    encodeFanGet,
    encodeFanSet,
    encodeFanConfigGet,
    encodeFanBtnConfigPushQuery,
    encodeFanBtnConfigSet,
    encodeFilterMaintenancePushQuery
} from './codecs/fan';
export type {
    FanChannelState,
    FanGetOptions,
    FanSetOptions,
    FanConfigState,
    FanButtonConfig,
    FanButtonConfigSetOptions,
    FanPowerBtn,
    FanControlBtn,
    FilterMaintenanceState
} from './codecs/fan';
export {
    DIFFUSER_LIGHT_NAMESPACE,
    DIFFUSER_SENSOR_NAMESPACE,
    DIFFUSER_SPRAY_NAMESPACE,
    DIFFUSER_TYPE,
    decodeDiffuserLightGetAck,
    decodeDiffuserLightPush,
    decodeDiffuserSensorGetAck,
    decodeDiffuserSensorPush,
    decodeDiffuserSprayGetAck,
    decodeDiffuserSprayPush,
    encodeDiffuserLightGet,
    encodeDiffuserLightSet,
    encodeDiffuserSensorGet,
    encodeDiffuserSprayGet,
    encodeDiffuserSpraySet
} from './codecs/diffuser';
export type {
    DiffuserLightMode,
    DiffuserLightSetOptions,
    DiffuserLightState,
    DiffuserSensorState,
    DiffuserSprayMode,
    DiffuserSpraySetOptions,
    DiffuserSprayState
} from './codecs/diffuser';
export {
    MP3_NAMESPACE,
    MP3_VOLUME_MAX,
    decodeMp3GetAck,
    decodeMp3Push,
    encodeMp3Get,
    encodeMp3Set
} from './codecs/mp3';
export type { Mp3GetOptions, Mp3SetOptions, Mp3State } from './codecs/mp3';
export {
    DND_MODE_NAMESPACE,
    decodeDndGetAck,
    decodeDndPush,
    encodeDndGet,
    encodeDndSet
} from './codecs/dnd';
export type { DndState } from './codecs/dnd';
export {
    CONTROL_ALARM_NAMESPACE,
    decodeAlarmGetAck,
    decodeAlarmPush,
    encodeAlarmGet,
    encodeAlarmLinkedSet,
    encodeAlarmSet
} from './codecs/alarm';
export type {
    AlarmChannelState,
    AlarmGetOptions,
    AlarmLinkedSetOptions,
    AlarmSetOptions
} from './codecs/alarm';
export {
    DIGEST_TIMERX_NAMESPACE,
    TIMERX_NAMESPACE,
    decodeDigestTimerXGetAck,
    decodeTimerXGetAck,
    decodeTimerXPush,
    encodeDigestTimerXGet,
    encodeTimerXDelete,
    encodeTimerXGet,
    encodeTimerXSet
} from './codecs/timerx';
export type {
    DigestTimerXRow,
    TimerXDeleteOptions,
    TimerXEntry,
    TimerXGetOptions,
    TimerXSetOptions
} from './codecs/timerx';
export {
    DIGEST_TRIGGERX_NAMESPACE,
    TRIGGERX_NAMESPACE,
    decodeDigestTriggerXGetAck,
    decodeTriggerXGetAck,
    decodeTriggerXPush,
    encodeDigestTriggerXGet,
    encodeTriggerXDelete,
    encodeTriggerXGet,
    encodeTriggerXSet
} from './codecs/triggerx';
export type {
    DigestTriggerXRow,
    TriggerXDeleteOptions,
    TriggerXEntry,
    TriggerXGetOptions,
    TriggerXRule,
    TriggerXSetOptions
} from './codecs/triggerx';
