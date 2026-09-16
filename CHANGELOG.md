# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `Endpoint.protocol()` and a `protocol` event report whether the next request will use LAN HTTP or cloud MQTT. Hosts can display this; they cannot pick a protocol.
- Public `CommandError`, `TransportError`, and `ProtocolError` so hosts can `instanceof` trait-command failures.
- Type-only `SessionOptions` next to `LoginOptions` / `TokenData`.
- `EndpointChange` is a per-trait discriminated union; remaining trait `*Values` types (`SwitchValues`, `EnergyValues`, `LightValues`, `LightRgb`, `CoverValues`, `ClimateValues`, `ClimatePid`, `DndValues`) are on the public barrel.

### Changed

- Internal catalog records colocate per-trait poll ownership; no host-visible API or behavior change.
- Internal composition: endpoint trait binding moves to `attachEndpoint`, traits take a device-scoped `DeviceRequest` port, digest namespaces live next to System.All decode, and poll jobs accept `PollTarget`. No host-visible API or behavior change.
- Driver methods (`Endpoint.handlePush`, `setAvailability`, `setProtocol`) and `Inventory.replace` are `@internal` and omitted from published typings (`stripInternal`). Same-package source and tests that import `src/` still see them; runtime CJS still has the functions on the prototype.

### Breaking (alpha)

- `EndpointChange.values` is no longer `Record<string, unknown>` — narrow on `change.trait` before reading fields.
- `NotImplementedError` is not exported from the public barrel.
- `energy.poll()` and `getHourlyConsumption()` reject with `CommandError` / `TransportError` / `ProtocolError` on request or decode failure instead of returning stale `last`. A partial `poll()` may already have applied earlier GETs to `change` before rejecting. Background `DevicePoller` still swallows the same failures.

### Fixed

- Hub `listSubDevices` failure during enroll emits session `warning` with the original error instead of looking like an empty cloud list. Digest children still enroll; cloud names/extra ids from that call are omitted.
- Device polling follows meross_lan's handler walk: HTTP flushes `Control.Multiple` as it fills and applies each GETACK immediately, so a later timeout cannot drop Electricity already received. Cloud MQTT uses `async_request_smartpoll` (one publish per cycle unless `polling_period_cloud` has elapsed). A failed GET or namespace parse no longer aborts the rest of the cycle. Packing also uses meross_lan's HTTP response-size budget (header + per-namespace estimate, ConsumptionX starts at 30 days) so a large ConsumptionX GETACK cannot truncate live power.
- Control.Multiple SETACK is parallel to SET: when firmware leaves a sub-header namespace empty (seen on Electricity GETACK), unpack fills it from that GET's slot so the trait still applies.
- Live power GETACKs follow meross_lan: Electricity decode keeps whichever of power/current/voltage are present, board Electricity is not filtered by payload channel, and each sample emits even when watts are unchanged.
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

[unreleased]: https://github.com/Doekse/node-meross-sdk/compare/v0.1.1-alpha...HEAD
[0.1.1-alpha]: https://github.com/Doekse/node-meross-sdk/compare/v0.1.0-alpha...v0.1.1-alpha
[0.1.0-alpha]: https://github.com/Doekse/node-meross-sdk/releases/tag/v0.1.0-alpha
