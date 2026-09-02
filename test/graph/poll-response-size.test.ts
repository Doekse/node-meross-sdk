import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CONSUMPTIONH_NAMESPACE } from '../../src/protocol/codecs/consumptionh';
import { CONSUMPTIONX_NAMESPACE } from '../../src/protocol/codecs/consumptionx';
import { ELECTRICITY_NAMESPACE } from '../../src/protocol/codecs/electricity';
import { TOGGLEX_NAMESPACE } from '../../src/protocol/codecs/togglex';
import {
    CONSUMPTIONX_DEFAULT_DAYS,
    getDeviceResponseSizeMax,
    estimateResponseSize,
    POLL_RESPONSE_HEADER_SIZE,
    POLL_RESPONSE_SIZE_MIN,
    POLL_RESPONSE_SIZE_PER_CMD
} from '../../src/graph/poll-response-size';

describe('poll response size', () => {
    it('estimates Electricity as 430 bytes', () => {
        assert.equal(estimateResponseSize(ELECTRICITY_NAMESPACE), 430);
    });

    it('estimates ConsumptionX as 30 days before calibration', () => {
        assert.equal(
            estimateResponseSize(CONSUMPTIONX_NAMESPACE),
            320 + 53 * CONSUMPTIONX_DEFAULT_DAYS
        );
    });

    it('counts ConsumptionH list channels', () => {
        assert.equal(
            estimateResponseSize(CONSUMPTIONH_NAMESPACE, {
                consumptionH: [{ channel: 0 }, { channel: 1 }]
            }),
            320 + 1_900 * 2
        );
    });

    it('defaults unknown namespaces to the Multiple header size', () => {
        assert.equal(estimateResponseSize(TOGGLEX_NAMESPACE), POLL_RESPONSE_HEADER_SIZE);
    });

    it('counts ConsumptionX list days', () => {
        assert.equal(
            estimateResponseSize(CONSUMPTIONX_NAMESPACE, {
                consumptionx: [{ date: '2018-03-05' }, { date: '2018-03-06' }]
            }),
            320 + 53 * 2
        );
    });

    it('floors packed budget at 1000 when maxCmdNum is 0', () => {
        assert.equal(getDeviceResponseSizeMax(0), POLL_RESPONSE_SIZE_MIN);
    });

    it('floors packed budget at 1000 when maxCmdNum is 1', () => {
        assert.equal(getDeviceResponseSizeMax(1), POLL_RESPONSE_SIZE_MIN);
    });

    it('uses maxCmdNum times 800 when that exceeds the floor', () => {
        assert.equal(getDeviceResponseSizeMax(3), 3 * POLL_RESPONSE_SIZE_PER_CMD);
    });
});
