# node-meross-sdk

[![CI](https://github.com/Doekse/node-meross-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/Doekse/node-meross-sdk/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/node-meross-sdk/alpha.svg)](https://www.npmjs.com/package/node-meross-sdk)
[![npm downloads](https://img.shields.io/npm/dm/node-meross-sdk.svg)](https://www.npmjs.com/package/node-meross-sdk)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-included-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/github/license/Doekse/node-meross-sdk.svg)](./LICENSE)
[![status](https://img.shields.io/badge/status-alpha-orange.svg)](#status)

[![GitHub issues](https://img.shields.io/github/issues/Doekse/node-meross-sdk.svg)](https://github.com/Doekse/node-meross-sdk/issues)
[![GitHub stars](https://img.shields.io/github/stars/Doekse/node-meross-sdk?style=social)](https://github.com/Doekse/node-meross-sdk/stargazers)

Control Meross devices from Node.js using a **session**, **endpoints**, and **traits**. One endpoint is one device you would expose to a user: a plug, a strip outlet, a bulb, a thermostat, a hub sensor, and so on.

Meross products do not share a simple device model. Firmware speaks in protocol namespaces, channels, hub subdevices, and Ability / System.All payloads, and you have to choose LAN HTTP versus cloud MQTT yourself. This package hides that. You log in, walk inventory, and call trait methods. Transports, MQTT, and codecs stay inside the package.

It was built to power a [Homey](https://homey.app) integration, and to give other Node.js hosts the same surface: another smart-home platform, a gateway, or a script that should not have to know how Meross structures its products.

## Table of contents

- [Status](#status)
- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Concepts](#concepts)
- [Usage](#usage)
- [Traits](#traits)
- [Errors](#errors)
- [Development](#development)
- [Changelog](#changelog)
- [Contributing](#contributing)
- [Credits](#credits)
- [License](#license)
- [Disclaimer](#disclaimer)



## Status

Session, LAN/MQTT transports, enrollment, polling, and traits are implemented. The public API is **alpha**: expect breaking changes until `1.0.0`.

The first published release is `0.1.0-alpha`.

## Features

- Cloud login with optional MFA, plus token restore without storing the password
- Ability-based enrollment: traits attach from firmware `Ability` + `System.All`, not a hardcoded model list
- One `Endpoint` per user-visible device (strip outlets and hub children included)
- LAN HTTP preferred automatically, with MQTT failover
- PUSH updates plus background polling; hosts listen on endpoint `availability` and `change`, and session `connection`, `ratelimit`, and `warning`
- The cloud publish window is respected per device: one publish per poll cycle, packed into `Appliance.Control.Multiple`, with publishes held back so polling cannot starve a user command
- TypeScript types shipped next to CommonJS `dist/` so `require()` hosts (including Homey) load without a bundler



## Requirements

- Node.js **>= 22**



## Installation

```bash
npm install node-meross-sdk@alpha
```

This is a prerelease on the `alpha` dist-tag. The package emits CommonJS from `dist/` and includes TypeScript declarations.

## Quick start

```javascript
const { Session } = require('node-meross-sdk');

(async () => {
  const session = await Session.login({
    email: 'you@example.com',
    password: 'secret'
    // mfaCode: '123456'
  });

  await session.connect();

  for (const row of session.inventory.endpoints()) {
    const endpoint = session.endpoint(row.id);

    endpoint.on('availability', (online) => {
      console.log(row.name, online ? 'online' : 'offline');
    });

    endpoint.on('change', ({ trait, values }) => {
      console.log(row.name, trait, values);
    });

    if (endpoint.switch) {
      await endpoint.switch.setOn(true);
    }
  }
})();
```

TypeScript can import the same surface:

```typescript
import { Session } from 'node-meross-sdk';
```



## Concepts


| Piece         | Role                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Session**   | Cloud credentials, live inventory, and connect/disconnect. Persist `[TokenData](#reuse-a-token)` and rebuild with `Session.restore`. |
| **Inventory** | User-visible rows after enrollment (`id`, `name`, `model`, `classHint`, `traits`, optional `parentId`). Live availability is on Endpoint. |
| **Endpoint**  | One device you would show a user. Traits live here. Channel and subdevice id are bound at enrollment; they are not method arguments. |
| **Trait**     | Capability on that endpoint (`switch`, `light`, `energy`, ...). Absent traits are `undefined`; check before calling.                   |


A 4-gang strip is a **master** endpoint (switch + energy) plus four switch children with `parentId`. Hub children use the same `Endpoint` type (`parentId` is metadata). Hosts group by `parentId`; they do not merge children into the parent.

## Usage



### Reuse a token

`Session.login` does not keep the password. Persist `getToken()` and restore later:

```javascript
const session = await Session.login({
  email: 'you@example.com',
  password: 'secret'
});
await session.connect();
const token = session.getToken();
// persist JSON.stringify(token)

const restored = Session.restore(token);
await restored.connect();
```



### Refresh inventory

`connect()` lists the cloud account and enrolls reachable devices. `sync()` reconciles that list again: devices that left the account are dropped, devices that came online are added, and known devices are re-read so a firmware update that changed abilities takes effect. Offline or unreachable devices are skipped so one timeout cannot block the rest, and each skip is reported on the session `warning` event. A stale token still rejects `sync()` itself. Overlapping `sync()` calls share the run already in flight rather than starting a second pass.

```javascript
await session.sync();
```

A re-read reuses the existing `Endpoint` when the device reports the same abilities and channels, so listeners survive. Only a changed shape replaces it, which shows up as a new object from `session.endpoint(id)`.

Devices are enrolled a few at a time rather than one after another, so a large account does not take minutes to appear.

`disconnect()` closes transports and clears inventory; the stored token remains valid for `restore`.

### Recover from an expired token

A long-running host will eventually see `AuthError` with code `TOKEN_EXPIRED`. `reauthenticate()` swaps in fresh credentials without discarding inventory, so every `Endpoint` and its listeners stay valid:

```javascript
try {
  await session.sync();
} catch (error) {
  if (error.code === 'TOKEN_EXPIRED') {
    await session.reauthenticate({ email: 'you@example.com', password: 'secret' });
    // persist session.getToken() again
    await session.sync();
  }
}
```

Transports are only rebuilt when the device key, user id, or broker domain actually changed, and the old connection stays live until the new one is up.

### Events

Attach session listeners before `connect()`. Endpoint listeners can be attached once inventory is ready.

```javascript
session.on('connection', (connected) => {
  // MQTT broker up/down, including reconnect after a drop
});

session.on('ratelimit', (uuid, dropped) => {
  // cloud publish dropped for this device; dropped is the cumulative count
});

session.on('warning', (error) => {
  // a single device that sync() skipped, e.g. an Ability / System.All timeout.
  // Cloud-level failures reject sync() itself instead of arriving here.
});

const endpoint = session.endpoint(row.id);

endpoint.on('availability', (online) => {
  // boolean; current value is endpoint.isOnline()
});

endpoint.on('change', ({ trait, values }) => {
  // trait: 'switch' | 'light' | 'energy' | ...
  // values: trait-specific snapshot (e.g. { on: true })
});
```



### Look up by inventory row

```javascript
for (const row of session.inventory.endpoints()) {
  if (row.classHint !== 'socket') continue;
  const endpoint = session.endpoint(row.id);
  if (row.parentId) {
    // Child outlet on a strip, or a hub subdevice
  }
  await endpoint.switch?.setOn(true);
}
```

Unknown ids throw `MerossError` with code `ENDPOINT_NOT_FOUND`. Commands on a session that is not connected throw `NOT_CONNECTED`.

## Traits

Traits are present only when the device advertised the matching ability. Use optional chaining or an `if` guard.


| Trait       | Typical devices                    | Host API                                                                              |
| ----------- | ---------------------------------- | ------------------------------------------------------------------------------------- |
| `switch`    | Plugs, strips, wall switches       | `isOn()`, `setOn(boolean)`                                                            |
| `light`     | Bulbs and light strips             | `setOn`, `setBrightness` / `setTemperature` (`0..1`), `setRgb`, `setEffect`           |
| `energy`    | Metered plugs and strips           | `poll()` (power / current / voltage), `getHourlyConsumption()`, `deleteConsumption()` |
| `cover`     | Garage doors, roller shutters      | `open()`, `close()`, `stop()`, `setPosition()`                                        |
| `climate`   | Thermostats and hub valves         | `setOn`, `setMode`, `setTargetTemperature`, schedule / extras                         |
| `sensor`    | Hub temp/hum, contact, leak, motion, smoke | Live values on `change`; `setCalibration`, `setAlerts`, smoke `mute` / `test`         |
| `presence`  | Wi-Fi presence sensors             | `change` values; `getConfig()`, `setConfig()`, `startStudy()`                         |
| `fan`       | Fans                               | `setOn`, `setSpeed`, `getButtonConfig` / `setButtonConfig`                            |
| `spray`     | Humidifiers                        | `getMode()`, `setMode('off'                                                           |
| `diffuser`  | Diffusers                          | Light + spray mode, brightness, RGB                                                   |
| `sprinkler` | Hub sprinkler valves               | `setOn`, `setDuration`, `getSchedule`; last cycle on `change`                         |
| `media`     | Speakers                           | `setMuted`, `setVolume`, `setSong`                                                    |
| `alarm`     | Hub sirens, board chimes           | `setOn(on, durationSeconds?)`, `setLinked`, `setBeep`                                 |
| `dnd`       | LED mute on the device             | `isOn()`, `setOn(boolean)`                                                            |
| `system`    | Device firmware, time, diagnostics | `getFirmware` / `getHardware` / `getTime`, `setTimezone`, `getDebug`, `getPosition` / `setPosition`, `clockSkewSeconds` |
| `timer`     | Toggle / ToggleX clock schedules   | `list()`, `set()`, `setEnabled()`, `remove()`                                         |
| `trigger`   | Toggle / ToggleX countdown rules   | `list()`, `set()`, `setEnabled()`, `remove()`                                         |


Readings such as energy and sensors update from PUSH and the internal poller. Listen on `change`; call `energy.poll()` when you need an on-demand sample.

## Errors

Catch by class. Each error has a string `code`.


| Class                 | When                                                                      |
| --------------------- | ------------------------------------------------------------------------- |
| `AuthError`           | Bad credentials, MFA, or an incomplete / expired token                    |
| `CloudError`          | Cloud HTTP failure, region redirect exhaustion, or a non-auth `apiStatus` |
| `MerossError`         | Session not connected, unknown endpoint, and other operational failures   |
| `NotImplementedError` | Reserved for unimplemented public surface                                 |


```javascript
const { AuthError, CloudError, MerossError } = require('node-meross-sdk');
```



## Development

```bash
npm install
npm test
npm run lint
npm run typecheck
npm run build
```

Tests use Node's built-in `node:test` runner. CI lints, typechecks, and runs tests on Node 22 and 24. Bumping `version` in `package.json` on `main` creates a GitHub Release from `CHANGELOG.md` and publishes to npm.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## Contributing

Bug reports and device traces are welcome in [GitHub Issues](https://github.com/Doekse/node-meross-sdk/issues). Include the model name, what failed, and (if you can) sniffed Ability / System.All payloads.

## Credits

Protocol knowledge draws on:

- [meross_lan](https://github.com/krahabb/meross_lan) by @krahabb
- [MerossIot (Python)](https://github.com/albertogeniola/MerossIot) by Alberto Geniola



## License

[MIT](./LICENSE)

## Disclaimer

All product and company names or logos are trademarks™ or registered® trademarks of their respective holders. Use of them does not imply any affiliation with or endorsement by them or any associated subsidiaries. This personal project is maintained in spare time and has no business goal.

**MEROSS** is a trademark of Chengdu Meross Technology Co., Ltd.