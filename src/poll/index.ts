/**
 * Poll layer: the namespace catalog, job scheduling, and the packing engine.
 * Device (identity/enrollment) is a consumer of this, not the other way
 * around, aside from the digest/endpoint types poll needs to schedule jobs.
 */
export {
    DEFAULT_POLL_INTERVAL_MS,
    DevicePoller,
    POLL_START_STAGGER_MS
} from './poller';
export type { DevicePollerOptions, PollJob, PollStrategy } from './poller';
export {
    CLOUDMQTT_PERIOD_MS,
    ENERGY_CLOUD_PERIOD_MS,
    ENERGY_PERIOD_MS,
    HUB_BATTERY_PERIOD_MS,
    POLL_RESPONSE_HEADER_SIZE,
    POLL_RESPONSE_SIZE_MIN,
    SENSOR_FAST_CLOUD_PERIOD_MS,
    SENSOR_FAST_PERIOD_MS,
    SENSOR_SLOW_CLOUD_PERIOD_MS,
    SENSOR_SLOW_PERIOD_MS,
    SYSTEM_ALL_PERIOD_MS,
    buildPollJobs,
    estimateResponseSize,
    getDeviceResponseSizeMax,
    getDigestNamespaces
} from './jobs';
