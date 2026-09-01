# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
