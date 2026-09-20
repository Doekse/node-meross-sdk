# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Optional `SessionOptions.logger` and `SessionOptions.logLevel` (`'error' | 'debug' | 'trace'`) for MQTT / LAN / cloud traffic (`LogRecord` / `LogLevel` on the public barrel). Default floor is `debug` (one-line summaries, no bodies); set `logLevel: 'trace'` for `data`. The SDK never reads env. Cloud records redact `password` / `token` / `key` / `mfaCode`. Session events stay on the EventEmitter.

### Changed

- MQTT loads mqtt.js only inside `MqttTransport` on a real broker connect, and opens the socket with Node TLS instead of `mqtt.connect()`, so unused `ws` / `socks` stay unloaded. Injected `SessionOptions.mqttConnect` is unchanged. No host-visible API or behavior change.
- MQTT inbound frames convert to UTF-8 only when a logger needs the body (`trace` traffic or a malformed-payload error). Decode reuses that string when it already ran. No host-visible API or behavior change.
- `Appliance.System.All` GETACK/PUSH is projected once per payload object so DeviceAvailability, SystemTrait, and a heartbeat re-apply share the tree. Malformed All is not cached. No host-visible API or behavior change.

## [0.2.0-alpha] - 2026-09-17

### Added

- Dedicated `overtemp`, `alert`, and `standbykiller` traits (Ability-gated, not electricity-gated). Hosts use `endpoint.overtemp` / `endpoint.alert` / `endpoint.standbykiller` (`poll()`, loud `set` with `NAMESPACE_NOT_ADVERTISED` when absent). `dnd.poll()` GETs `System.DNDMode`.
- `Endpoint.protocol()` and a `protocol` event report whether the next request will use LAN HTTP or cloud MQTT. Hosts can display this; they cannot pick a protocol.
- Public `CommandError`, `TransportError`, and `ProtocolError` so hosts can `instanceof` trait-command failures.
- Type-only `SessionOptions` next to `LoginOptions` / `TokenData`.
- `EndpointChange` is a per-trait discriminated union; remaining trait `*Values` types (`SwitchValues`, `EnergyValues`, `LightValues`, `LightRgb`, `CoverValues`, `ClimateValues`, `ClimatePid`, `DndValues`, `OverTempValues`, `AlertValues`, `StandbyKillerValues`) are on the public barrel.

### Changed

- Internal enroll helpers: digest-or-ability channel 0 and channel-0 extra/standalone live in `src/device/enroll-helpers.ts`; hub-child classification walks a local climate → sensor → sprinkler list. No host-visible API or behavior change.
- Internal trait bind: `uuid` is no longer on `*TraitBind`. Session still closes `DeviceRequest` over `PhysicalDevice.uuid`. No host-visible API or behavior change.
- Internal codec helper: one-entry list wrap lives in `src/protocol/codecs/payload.ts`. No host-visible API or behavior change.
- Internal catalog records colocate per-trait poll ownership; no host-visible API or behavior change.
- Internal composition: endpoint trait binding moves to `attachEndpoint`, traits take a device-scoped `DeviceRequest` port, digest namespaces live next to System.All decode, and poll jobs accept `PollTarget`. No host-visible API or behavior change.
- Driver methods (`Endpoint.handlePush`, `setAvailability`, `setProtocol`) and `Inventory.replace` are `@internal` and omitted from published typings (`stripInternal`). Same-package source and tests that import `src/` still see them; runtime CJS still has the functions on the prototype.

### Breaking (alpha)

- `dnd` `on` / `isOn()` / `setOn()` is the status LED (`DNDMode.mode === 0`), not DND active. Hosts must not invert.
- `energy.setOverTemp` / `setAlertConfig` / `setStandbyKiller` and `overTemp*` / `alertConfig*` / `standbyKiller*` values are removed. `climate.setAlertConfig` and climate alert fields are removed. Hosts use `endpoint.overtemp` / `endpoint.alert` / `endpoint.standbykiller` instead. Silent no-op setters are gone: missing namespaces throw `MerossError` `NAMESPACE_NOT_ADVERTISED`.
- `EndpointChange.values` is no longer `Record<string, unknown>` — narrow on `change.trait` before reading fields.
- `NotImplementedError` is not exported from the public barrel.
- `energy.poll()` and `getHourlyConsumption()` reject with `CommandError` / `TransportError` / `ProtocolError` on request or decode failure instead of returning stale `last`. A partial `poll()` may already have applied earlier GETs to `change` before rejecting. Background `DevicePoller` still swallows the same failures.
- Endpoint `change` is skip-on-equal for every trait, including energy live samples and light color/brightness. Hosts that treated those events as a poll heartbeat should use `energy.poll()`'s return value or another liveness signal (`protocol`, `availability`).
- Board `availability` is heard-from-the-device (any inbound that reaches the board; silence only after a failed heartbeat probe), not firmware `online.status`, System.All `online.status`, or Runtime `iotStatus`. MQTT `Appliance.System.Online` that is not PUSH status 1 is dropped before push/liveness; All `status !== 1` only clears MQTT-active on the poller.

### Fixed

- Cover `isOpen()` seeds from System.All `digest.garageDoor` at enroll, so hosts do not wait for PUSH or the next poll. Channels with `doorEnable` 0 are skipped so unused MSG200 doors are not enrolled as cover or switch.
- Heartbeat silence checks reschedule at the remaining window when a response lands between ticks, so a live device is not probed up to a full interval late. A check in flight no longer races a later `start()` timer.
- `npm test` runs tsx with `process.execPath` so the suite starts on Windows (`npx.cmd` ENOENT/EINVAL).
- Control.OverTemp SET/PUSH now applies firmware `type` (1 = alert only, 2 = alert and relay off) on the same change as `active`, instead of keeping only `active` / `timestamp`.
- Hub `listSubDevices` failure during enroll emits session `warning` with the original error instead of looking like an empty cloud list. Digest children still enroll; cloud names/extra ids from that call are omitted.
- Device polling follows meross_lan's handler walk: HTTP flushes `Control.Multiple` as it fills and applies each GETACK immediately, so a later timeout cannot drop Electricity already received. Cloud MQTT uses `async_request_smartpoll` (one publish per cycle unless `polling_period_cloud` has elapsed). A failed GET or namespace parse no longer aborts the rest of the cycle. Packing also uses meross_lan's HTTP response-size budget (header + per-namespace estimate, ConsumptionX starts at 30 days) so a large ConsumptionX GETACK cannot truncate live power.
- Control.Multiple SETACK is parallel to SET: when firmware leaves a sub-header namespace empty (seen on Electricity GETACK), unpack fills it from that GET's slot so the trait still applies.
- Live power GETACKs follow meross_lan: Electricity decode keeps whichever of power/current/voltage are present, and board Electricity is not filtered by payload channel.
- MQTT-active is meross_lan `_mqtt_active`: any broker traffic, held until disconnect or offline, not a 295s PUSH TTL. Digest keys from System.All are `digest_pollers` (GET only as All fallback). Default jobs still run on an All tick. Coming online from MQTT no longer waits out the offline backoff.
- `Appliance.System.All` and `Appliance.Hub.ToggleX` now pack into `Control.Multiple` like any other GET, matching meross_lan (neither is special-cased there). Excluding either forced its own cloud publish every cycle it was due, which could spend that cycle's single cloud-MQTT budget before a same-tick smart poll (e.g. Electricity) ran, delaying it a full extra cycle. Only `Control.Multiple` itself stays unpackable.
- `DevicePoller`'s per-tick packing scratch (Multiple buffer, lazy jobs, cloud publish count) is now plain instance state reset at the top of each tick instead of an object threaded through every helper method — a tick never overlaps another, so there was nothing to isolate. No behavior change.

## [0.1.1-alpha] - 2026-09-01

### Fixed

- LAN HTTP and poller GETACK are applied on the device that issued the request, matching meross_lan HTTP. Firmware that echoes the app `from` and omits `uuid` is no longer dropped; the envelope is not rewritten.
- Poller/heartbeat timers no longer call `unref()`, matching meross_lan's HA `call_later` timers which stay referenced for the process lifetime.

## [0.1.0-alpha] - 2026-08-31

### Added

- Cloud login with optional MFA, token restore without storing the password, and `reauthenticate()` when a token expires.
- Ability-based enrollment: traits attach from firmware `Ability` and `System.All`, not a hardcoded model list.
- One `Endpoint` per user-visible device, including strip outlets and hub children.
- LAN HTTP preferred automatically, with MQTT failover, PUSH updates, and background polling.
- Cloud publish window per device: one publish per poll cycle, packed into `Appliance.Control.Multiple`, with polling held so it cannot starve a user command.
- Session events `connection`, `ratelimit`, and `warning`; endpoint events `availability` and `change`.
- Traits: switch, light, energy, cover, climate, sensor, presence, fan, spray, diffuser, sprinkler, media, alarm, dnd, system, timer, trigger.
- TypeScript types shipped next to CommonJS `dist/` so `require()` hosts (including Homey) load without a bundler.

[unreleased]: https://github.com/Doekse/node-meross-sdk/compare/v0.2.0-alpha...HEAD
[0.2.0-alpha]: https://github.com/Doekse/node-meross-sdk/compare/v0.1.1-alpha...v0.2.0-alpha
[0.1.1-alpha]: https://github.com/Doekse/node-meross-sdk/compare/v0.1.0-alpha...v0.1.1-alpha
[0.1.0-alpha]: https://github.com/Doekse/node-meross-sdk/releases/tag/v0.1.0-alpha
