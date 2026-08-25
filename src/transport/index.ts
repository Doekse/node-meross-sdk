/**
 * MQTT, LAN HTTP, and the router that prefers LAN with MQTT failover.
 * Unexported from the package entry; Session wires this after login.
 */
export { MQTT_RECONNECT_PERIOD_MS, MqttTransport } from './mqtt';
export type {
    MqttBrokerClient,
    MqttConnectFn,
    MqttConnectOptions,
    MqttRequestOptions,
    MqttTransportOptions
} from './mqtt';
export { DEFAULT_LAN_TIMEOUT_MS, LanHttpTransport } from './lan-http';
export type { LanHttpRequestOptions, LanHttpTransportOptions } from './lan-http';
export {
    DEFAULT_ERROR_BUDGET_WINDOW_MS,
    DEFAULT_MAX_ERRORS,
    TransportRouter
} from './router';
export type {
    GetCommand,
    RequestGetsOptions,
    RoutedRequestOptions,
    TransportRouterOptions
} from './router';
