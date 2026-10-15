import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUIET_KEEPALIVE,
  completionEcho,
  fullKeepalive,
  keepaliveTopic,
  parsePayload,
  parseTopic,
  readTopic,
  writePayload,
  writeTopic,
} from '../src/topics.js';

test('notification topics', () => {
  assert.deepEqual(parseTopic('N/c0619ab1c2d3/battery/279/Dc/0/Voltage'), {
    portal: 'c0619ab1c2d3',
    service: 'battery',
    instance: '279',
    path: 'Dc/0/Voltage',
  });
  assert.deepEqual(parseTopic('N/c0619ab1c2d3/full_publish_completed'), {
    portal: 'c0619ab1c2d3',
    special: 'full_publish_completed',
  });
  for (const bad of [
    'W/c0619ab1c2d3/battery/279/Soc',
    'N/',
    'N//battery/279/Soc',
    'N/c0619ab1c2d3/battery/279',
    'N/c0619ab1c2d3/battery//Soc',
    'N/c0619ab1c2d3/battery/279/Dc//Power',
  ]) {
    assert.equal(parseTopic(bad), null, bad);
  }
});

test('notification payloads', () => {
  assert.deepEqual(parsePayload(Buffer.from('{"value": 52.31}')), { value: 52.31 });
  assert.deepEqual(parsePayload('{"max":100,"min":0,"value":20}'), { value: 20 });
  assert.deepEqual(parsePayload('{"value": null}'), { value: null });
  assert.deepEqual(parsePayload('{"value": "SmartShunt"}'), { value: 'SmartShunt' });
  assert.deepEqual(parsePayload(Buffer.alloc(0)), { removed: true }, 'the device left');
  assert.deepEqual(parsePayload(' '), { removed: true });
  assert.deepEqual(parsePayload('nope'), { error: 'not JSON' });
  assert.deepEqual(parsePayload('{"x": 1}'), { error: 'no "value" key' });
  assert.deepEqual(parsePayload('[1]'), { error: 'no "value" key' });
  assert.deepEqual(parsePayload('null'), { error: 'no "value" key' });
});

test('keep-alive, read and write requests', () => {
  assert.equal(keepaliveTopic('c0619ab1c2d3'), 'R/c0619ab1c2d3/keepalive');
  assert.deepEqual(JSON.parse(fullKeepalive('abc')), {
    'keepalive-options': [{ 'full-publish-completed-echo': 'abc' }],
  });
  assert.deepEqual(JSON.parse(QUIET_KEEPALIVE), { 'keepalive-options': ['suppress-republish'] });
  assert.equal(
    readTopic('c0619ab1c2d3', 'settings/0', 'Settings/CGwacs/BatteryLife/MinimumSocLimit'),
    'R/c0619ab1c2d3/settings/0/Settings/CGwacs/BatteryLife/MinimumSocLimit',
  );
  assert.equal(writeTopic('c0619ab1c2d3', 'vebus/276', 'Mode'), 'W/c0619ab1c2d3/vebus/276/Mode');
  assert.equal(writePayload(4), '{"value":4}');
});

test('the echo of a full publish', () => {
  assert.equal(
    completionEcho(Buffer.from('{"full-publish-completed-echo":"abc","value":1718860914}')),
    'abc',
  );
  assert.equal(completionEcho('{"value":1702459522}'), undefined, 'Venus OS before 3.50');
  assert.equal(completionEcho('garbage'), undefined);
});
