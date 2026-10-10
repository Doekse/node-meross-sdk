import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { ProtocolError } from '../../../src/errors';
import {
    THERMOSTAT_MODE_NAMESPACE,
    WINDOW_OPENED_NAMESPACE
} from '../../../src/protocol/codecs/climate';
import { SHUTTER_STATE_NAMESPACE } from '../../../src/protocol/codecs/cover';
import {
    DIFFUSER_LIGHT_NAMESPACE,
    DIFFUSER_SPRAY_NAMESPACE
} from '../../../src/protocol/codecs/diffuser';
import { FAN_NAMESPACE } from '../../../src/protocol/codecs/fan';
import { LIGHT_NAMESPACE } from '../../../src/protocol/codecs/light';
import {
    decodeSystemAllGetAck,
    getDigestNamespaces
} from '../../../src/protocol/codecs/system-all';
import { TOGGLEX_NAMESPACE } from '../../../src/protocol/codecs/togglex';
import { decodeMessage, type MerossPayload } from '../../../src/protocol/message';

const fixturesDir = join(process.cwd(), 'test/fixtures');

function loadFixture(name: string): MerossPayload {
    return decodeMessage(
        JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as unknown
    ).payload;
}

describe('getDigestNamespaces', () => {
    it('maps populated digest lists to their namespaces', () => {
        const namespaces = getDigestNamespaces({
            togglex: [{ channel: 0, on: true }],
            light: [{ channel: 0 }],
            garageDoor: [],
            rollerShutter: [],
            spray: [],
            fan: [{ channel: 0 }]
        });
        assert.deepEqual([...namespaces], [
            TOGGLEX_NAMESPACE,
            LIGHT_NAMESPACE,
            FAN_NAMESPACE
        ]);
    });

    it('maps only populated diffuser digest lists to their namespaces', () => {
        const digest = {
            togglex: [],
            light: [],
            garageDoor: [],
            rollerShutter: [],
            spray: [],
            fan: []
        };

        assert.deepEqual([...getDigestNamespaces({
            ...digest,
            diffuser: { light: [], spray: [] }
        })], []);
        assert.deepEqual([...getDigestNamespaces({
            ...digest,
            diffuser: { light: [{ channel: 0 }], spray: [] }
        })], [DIFFUSER_LIGHT_NAMESPACE]);
        assert.deepEqual([...getDigestNamespaces({
            ...digest,
            diffuser: { light: [], spray: [{ channel: 0 }] }
        })], [DIFFUSER_SPRAY_NAMESPACE]);
    });

    it('does not treat rollerShutter as a digest poller', () => {
        const namespaces = getDigestNamespaces({
            togglex: [],
            light: [],
            garageDoor: [],
            rollerShutter: [0],
            spray: [],
            fan: []
        });
        assert.equal(namespaces.has(SHUTTER_STATE_NAMESPACE), false);
    });

    it('includes thermostat keys that are present, including empty lists', () => {
        const namespaces = getDigestNamespaces({
            togglex: [],
            light: [],
            garageDoor: [],
            rollerShutter: [],
            spray: [],
            fan: [],
            thermostat: { mode: [], windowOpened: [] }
        });
        assert.deepEqual([...namespaces], [
            THERMOSTAT_MODE_NAMESPACE,
            WINDOW_OPENED_NAMESPACE
        ]);
    });
});

describe('decodeSystemAllGetAck', () => {
    it('returns the same projection when the payload object is reused', () => {
        const payload = loadFixture('system-all-getack.json');
        const first = decodeSystemAllGetAck(payload);
        const second = decodeSystemAllGetAck(payload);
        assert.equal(second, first);
        assert.equal(first.hardware.type, 'mss110');
        assert.equal(first.firmware.innerIp, '192.168.201.190');
    });

    it('projects a second payload object independently', () => {
        const firstPayload = loadFixture('system-all-getack.json');
        const secondPayload = structuredClone(firstPayload);
        const firmware = (secondPayload.all as {
            system: { firmware: { innerIp?: string } };
        }).system.firmware;
        firmware.innerIp = '10.0.0.42';
        const first = decodeSystemAllGetAck(firstPayload);
        const second = decodeSystemAllGetAck(secondPayload);
        assert.notEqual(second, first);
        assert.equal(first.firmware.innerIp, '192.168.201.190');
        assert.equal(second.firmware.innerIp, '10.0.0.42');
    });

    it('does not cache a failed decode so a later caller still throws', () => {
        const payload = {};
        assert.throws(() => decodeSystemAllGetAck(payload), ProtocolError);
        assert.throws(() => decodeSystemAllGetAck(payload), ProtocolError);
    });

    it('wraps a single digest channel object as a one-row list', () => {
        const payload = loadFixture('system-all-getack.json');
        const body = payload.all as { digest: Record<string, unknown> };
        body.digest = {
            togglex: { channel: 0, onoff: 0 },
            light: {
                capacity: 6,
                channel: 0,
                rgb: 16711808,
                temperature: 100,
                luminance: 85,
                transform: -1
            },
            fan: { channel: 2, speed: 3 },
            spray: { channel: 0, mode: 0 },
            garageDoor: { channel: 1, open: 1, doorEnable: 1 }
        };

        const decoded = decodeSystemAllGetAck(payload);

        assert.deepEqual(decoded.digest.togglex, [{ channel: 0, on: false }]);
        assert.deepEqual(decoded.digest.light, [{
            channel: 0,
            capacity: 6,
            rgb: 16711808,
            temperature: 100,
            luminance: 85
        }]);
        assert.deepEqual(decoded.digest.fan, [{ channel: 2, speed: 3 }]);
        assert.deepEqual(decoded.digest.spray, [{ channel: 0, mode: 0 }]);
        assert.deepEqual(decoded.digest.garageDoor, [{
            channel: 1,
            open: true,
            doorEnable: true
        }]);
    });

    it('keeps an array digest.light and drops -1 unsupported fields', () => {
        const payload = loadFixture('system-all-getack.json');
        const body = payload.all as { digest: Record<string, unknown> };
        body.digest = {
            light: [{
                channel: 0,
                capacity: 7,
                rgb: -1,
                temperature: 50,
                luminance: -1,
                onoff: 1
            }]
        };

        const decoded = decodeSystemAllGetAck(payload);

        assert.deepEqual(decoded.digest.light, [{
            channel: 0,
            capacity: 7,
            temperature: 50,
            onoff: true
        }]);
    });
});
