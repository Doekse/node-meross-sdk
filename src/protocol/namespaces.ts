/**
 * Meross namespace string catalog (meross_lan `const.py` analog).
 * Always-loaded so Ability / digest / POLL can gate without pulling codec bodies.
 */

// System
export const ABILITY_NAMESPACE = 'Appliance.System.Ability';
export const SYSTEM_ALL_NAMESPACE = 'Appliance.System.All';
export const SYSTEM_TIME_NAMESPACE = 'Appliance.System.Time';
export const SYSTEM_CLOCK_NAMESPACE = 'Appliance.System.Clock';
export const SYSTEM_FIRMWARE_NAMESPACE = 'Appliance.System.Firmware';
export const SYSTEM_HARDWARE_NAMESPACE = 'Appliance.System.Hardware';
export const SYSTEM_DEBUG_NAMESPACE = 'Appliance.System.Debug';
export const SYSTEM_POSITION_NAMESPACE = 'Appliance.System.Position';
export const ONLINE_NAMESPACE = 'Appliance.System.Online';
export const DND_MODE_NAMESPACE = 'Appliance.System.DNDMode';

// Control core
export const MULTIPLE_NAMESPACE = 'Appliance.Control.Multiple';
/** Classic Toggle, distinct from ToggleX. */
export const TOGGLE_NAMESPACE = 'Appliance.Control.Toggle';
export const TOGGLEX_NAMESPACE = 'Appliance.Control.ToggleX';
/**
 * GET channel `0xffff` means every channel. Firmware wants decimal 65535,
 * not `0xffffffff`.
 */
export const TOGGLEX_ALL_CHANNELS = 0xffff;

// Light
export const LIGHT_NAMESPACE = 'Appliance.Control.Light';
export const LIGHT_EFFECT_NAMESPACE = 'Appliance.Control.Light.Effect';

// Energy
export const ELECTRICITY_NAMESPACE = 'Appliance.Control.Electricity';
export const ELECTRICITYX_NAMESPACE = 'Appliance.Control.ElectricityX';
/**
 * GET channel `0xffff` means every channel. An empty GET misses some devices.
 */
export const ELECTRICITYX_ALL_CHANNELS = 0xffff;
export const CONSUMPTIONX_NAMESPACE = 'Appliance.Control.ConsumptionX';
export const CONSUMPTIONH_NAMESPACE = 'Appliance.Control.ConsumptionH';
export const CONSUMPTION_CONFIG_NAMESPACE = 'Appliance.Control.ConsumptionConfig';

// Cover
export const GARAGE_STATE_NAMESPACE = 'Appliance.GarageDoor.State';
export const GARAGE_CONFIG_NAMESPACE = 'Appliance.GarageDoor.Config';
export const GARAGE_MULTIPLE_CONFIG_NAMESPACE = 'Appliance.GarageDoor.MultipleConfig';
export const SHUTTER_POSITION_NAMESPACE = 'Appliance.RollerShutter.Position';
export const SHUTTER_STATE_NAMESPACE = 'Appliance.RollerShutter.State';
export const SHUTTER_CONFIG_NAMESPACE = 'Appliance.RollerShutter.Config';
export const SHUTTER_ADJUST_NAMESPACE = 'Appliance.RollerShutter.Adjust';

// Climate / thermostat
export const THERMOSTAT_MODE_NAMESPACE = 'Appliance.Control.Thermostat.Mode';
export const THERMOSTAT_MODEB_NAMESPACE = 'Appliance.Control.Thermostat.ModeB';
export const THERMOSTAT_MODEC_NAMESPACE = 'Appliance.Control.Thermostat.ModeC';
export const HOLD_ACTION_NAMESPACE = 'Appliance.Control.Thermostat.HoldAction';
export const WINDOW_OPENED_NAMESPACE = 'Appliance.Control.Thermostat.WindowOpened';
export const SENSOR_NAMESPACE = 'Appliance.Control.Thermostat.Sensor';
export const FROST_NAMESPACE = 'Appliance.Control.Thermostat.Frost';
export const CALIBRATION_NAMESPACE = 'Appliance.Control.Thermostat.Calibration';
export const OVERHEAT_NAMESPACE = 'Appliance.Control.Thermostat.Overheat';
export const DEAD_ZONE_NAMESPACE = 'Appliance.Control.Thermostat.DeadZone';
export const SUMMER_MODE_NAMESPACE = 'Appliance.Control.Thermostat.SummerMode';
export const COMPRESSOR_DELAY_NAMESPACE = 'Appliance.Control.Thermostat.CompressorDelay';
export const CTL_RANGE_NAMESPACE = 'Appliance.Control.Thermostat.CtlRange';
export const TIMER_NAMESPACE = 'Appliance.Control.Thermostat.Timer';
export const ALARM_NAMESPACE = 'Appliance.Control.Thermostat.Alarm';
export const ALARM_CONFIG_NAMESPACE = 'Appliance.Control.Thermostat.AlarmConfig';
export const SCHEDULE_NAMESPACE = 'Appliance.Control.Thermostat.Schedule';
export const SCHEDULEB_NAMESPACE = 'Appliance.Control.Thermostat.ScheduleB';
export const THERMOSTAT_SYSTEM_NAMESPACE = 'Appliance.Control.Thermostat.System';
export const TEMP_UNIT_NAMESPACE = 'Appliance.Control.TempUnit';
export const PHYSICAL_LOCK_NAMESPACE = 'Appliance.Control.PhysicalLock';
export const SCREEN_BRIGHTNESS_NAMESPACE = 'Appliance.Control.Screen.Brightness';

// Hub
export const HUB_ONLINE_NAMESPACE = 'Appliance.Hub.Online';
export const HUB_TOGGLEX_NAMESPACE = 'Appliance.Hub.ToggleX';
export const HUB_SUBDEVICE_LIST_NAMESPACE = 'Appliance.Hub.SubdeviceList';
export const HUB_MTS100_MODE_NAMESPACE = 'Appliance.Hub.Mts100.Mode';
export const HUB_MTS100_TEMPERATURE_NAMESPACE = 'Appliance.Hub.Mts100.Temperature';
export const HUB_MTS100_ALL_NAMESPACE = 'Appliance.Hub.Mts100.All';
export const HUB_MTS100_ADJUST_NAMESPACE = 'Appliance.Hub.Mts100.Adjust';
export const HUB_MTS100_CONFIG_NAMESPACE = 'Appliance.Hub.Mts100.Config';
export const HUB_MTS100_SUPERCTL_NAMESPACE = 'Appliance.Hub.Mts100.SuperCtl';
export const HUB_MTS100_SCHEDULE_NAMESPACE = 'Appliance.Hub.Mts100.Schedule';
export const HUB_MTS100_SCHEDULEB_NAMESPACE = 'Appliance.Hub.Mts100.ScheduleB';
export const HUB_MTS100_TIMESYNC_NAMESPACE = 'Appliance.Hub.Mts100.TimeSync';
export const HUB_SENSOR_TEMPHUM_NAMESPACE = 'Appliance.Hub.Sensor.TempHum';
export const HUB_SENSOR_DOORWINDOW_NAMESPACE = 'Appliance.Hub.Sensor.DoorWindow';
export const HUB_SENSOR_WATERLEAK_NAMESPACE = 'Appliance.Hub.Sensor.WaterLeak';
export const HUB_SENSOR_MOTION_NAMESPACE = 'Appliance.Hub.Sensor.Motion';
export const HUB_SENSOR_SMOKE_NAMESPACE = 'Appliance.Hub.Sensor.Smoke';
export const HUB_SENSOR_ADJUST_NAMESPACE = 'Appliance.Hub.Sensor.Adjust';
export const HUB_SENSOR_ALERT_NAMESPACE = 'Appliance.Hub.Sensor.Alert';
export const HUB_SENSOR_ALL_NAMESPACE = 'Appliance.Hub.Sensor.All';
export const HUB_BATTERY_NAMESPACE = 'Appliance.Hub.Battery';
export const HUB_EXCEPTION_NAMESPACE = 'Appliance.Hub.Exception';
export const HUB_SUBDEVICE_VERSION_NAMESPACE = 'Appliance.Hub.SubDevice.Version';

// Board sensors
export const SENSOR_LATESTX_NAMESPACE = 'Appliance.Control.Sensor.LatestX';
export const SENSOR_LATEST_NAMESPACE = 'Appliance.Control.Sensor.Latest';
export const SENSOR_HISTORY_NAMESPACE = 'Appliance.Control.Sensor.History';
export const SENSOR_HISTORYX_NAMESPACE = 'Appliance.Control.Sensor.HistoryX';
export const SMOKE_CONFIG_NAMESPACE = 'Appliance.Control.Smoke.Config';
/** External/internal temp sensor binding (GET/SET/PUSH-query list). MTS300. */
export const CONFIG_SENSOR_ASSOCIATION_NAMESPACE = 'Appliance.Config.Sensor.Association';

// Spray / fan / diffuser / media
export const SPRAY_NAMESPACE = 'Appliance.Control.Spray';
export const FAN_NAMESPACE = 'Appliance.Control.Fan';
export const FAN_CONFIG_NAMESPACE = 'Appliance.Control.Fan.Config';
export const FAN_BTN_CONFIG_NAMESPACE = 'Appliance.Control.Fan.BtnConfig';
export const FILTER_MAINTENANCE_NAMESPACE = 'Appliance.Control.FilterMaintenance';
export const DIFFUSER_LIGHT_NAMESPACE = 'Appliance.Control.Diffuser.Light';
export const DIFFUSER_SPRAY_NAMESPACE = 'Appliance.Control.Diffuser.Spray';
export const DIFFUSER_SENSOR_NAMESPACE = 'Appliance.Control.Diffuser.Sensor';
export const MP3_NAMESPACE = 'Appliance.Control.Mp3';

// Alarm / alert / overtemp / standby
export const CONTROL_ALARM_NAMESPACE = 'Appliance.Control.Alarm';
/**
 * Chime / buzzer. Shares the `alarm` payload key with Control.Alarm but the
 * entry shape is `{ channel, onoff }` — keep decoders separate.
 */
export const CONTROL_BEEP_NAMESPACE = 'Appliance.Control.Beep';
/** Alert thresholds (GET/SET/PUSH-query list). MTS300 and EM06. */
export const CONTROL_ALERT_CONFIG_NAMESPACE = 'Appliance.Control.AlertConfig';
/**
 * Live alert report (GET/SET list). Experimental in meross_lan — field names
 * are not stable, so entries keep residual wire keys.
 */
export const CONTROL_ALERT_REPORT_NAMESPACE = 'Appliance.Control.AlertReport';
/** Live over-temperature signal (GET list / device SET). */
export const CONTROL_OVERTEMP_NAMESPACE = 'Appliance.Control.OverTemp';
/** Protection enable / type config (GET/SET dict). */
export const CONFIG_OVERTEMP_NAMESPACE = 'Appliance.Config.OverTemp';
/** MSS305 standby cut-off (GET/SET/PUSH-query list). */
export const CONFIG_STANDBY_KILLER_NAMESPACE = 'Appliance.Config.StandbyKiller';

// Presence
export const PRESENCE_CONFIG_NAMESPACE = 'Appliance.Control.Presence.Config';
export const PRESENCE_STUDY_NAMESPACE = 'Appliance.Control.Presence.Study';

// Water / sprinkler
export const CONTROL_WATER_NAMESPACE = 'Appliance.Control.Water';
/** Completed watering cycle. PUSH-only; payload key is `control`. */
export const CONTROL_WATER_EVENT_NAMESPACE = 'Appliance.Control.WaterEvent';
export const DEVICE_CFG_NAMESPACE = 'Appliance.Config.DeviceCfg';
/** MST100 watering schedules. Payload key is `config`. */
export const WATER_PLAN_NAMESPACE = 'Appliance.Config.WaterPlan';

// Timer / trigger
export const TIMERX_NAMESPACE = 'Appliance.Control.TimerX';
export const DIGEST_TIMERX_NAMESPACE = 'Appliance.Digest.TimerX';
/** Pre-X firmware; no Digest. Listing is a GET of the full `timer` list. */
export const CONTROL_TIMER_NAMESPACE = 'Appliance.Control.Timer';
export const TRIGGERX_NAMESPACE = 'Appliance.Control.TriggerX';
export const DIGEST_TRIGGERX_NAMESPACE = 'Appliance.Digest.TriggerX';
/** Pre-X firmware; no Digest. GET uses an empty dict; GETACK/SET/PUSH are lists. */
export const CONTROL_TRIGGER_NAMESPACE = 'Appliance.Control.Trigger';

// Encryption
export const ENCRYPT_SUITE_NAMESPACE = 'Appliance.Encrypt.Suite';
export const ENCRYPT_ECDHE_NAMESPACE = 'Appliance.Encrypt.ECDHE';
