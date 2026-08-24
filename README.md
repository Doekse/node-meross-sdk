# node-meross-sdk

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)
![alpha](https://img.shields.io/badge/status-bootstrap-lightgrey.svg)

Node.js library for controlling Meross devices. The public API is shaped for Homey (and any similar platform): a **session**, **endpoints**, and **traits**. One endpoint is one device you would expose to a user. Transports and MQTT stay inside the package.

This package **replaces [`meross-iot`](https://www.npmjs.com/package/meross-iot)**. New integrations should use `node-meross-sdk`. `meross-iot` is frozen and will be deprecated on npm once this package publishes `0.1.0-alpha`.

## Status

Bootstrap only: toolchain, CI, and the frozen public surface. Login, MQTT, LAN, and traits are not implemented yet. The first usable release is `0.1.0-alpha` (switch + energy for sockets).

## Requirements

- Node.js >= 22

## Installation

Not published yet. After the first alpha:

```bash
npm install node-meross-sdk
```

Homey apps `require` CommonJS; this package emits CJS from `dist/`.

## Public API

```javascript
const { Session } = require('node-meross-sdk');

(async () => {
  const session = await Session.login({
    email: 'you@example.com',
    password: 'secret'
  });
  // Or: Session.restore(savedToken)

  await session.connect();

  for (const row of session.inventory.endpoints()) {
    const endpoint = session.endpoint(row.id);
    endpoint.on('availability', (online) => {
      console.log(row.name, online ? 'online' : 'offline');
    });
    if (endpoint.switch) {
      await endpoint.switch.setOn(true);
    }
  }
})();
```

- **`Session.login` / `Session.restore`** — cloud credentials or a stored token (`storeData`-friendly).
- **`session.endpoint(id)`** — one Homey device. A 4-gang strip is a master endpoint (switch + energy) plus four switch children with `parentId`; channel is not a method argument. Hub children use the same `Endpoint` type (`parentId` is metadata).
- **Traits** (`switch`, `light`, `climate`, `energy`, …) are platform-agnostic. Homey capability tables belong in a later `meross-homey` helper, not here.
- LAN HTTP is preferred automatically, with MQTT failover. There is no public `transportMode`.

## Development

```bash
npm install
npm test
npm run lint
```

Tests use Node's built-in `node:test` runner.

## License

MIT
