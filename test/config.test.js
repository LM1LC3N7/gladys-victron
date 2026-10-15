import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, parseBrokerUrl, parsePortalId } from '../src/config.js';

test('GX device addresses', () => {
  assert.deepEqual(parseBrokerUrl('192.168.1.50'), { url: 'mqtt://192.168.1.50' });
  assert.deepEqual(parseBrokerUrl(' mqtt://cerbo.lan:1883 '), { url: 'mqtt://cerbo.lan:1883' });
  assert.deepEqual(parseBrokerUrl('mqtts://192.168.1.50:8883'), {
    url: 'mqtts://192.168.1.50:8883',
  });
  assert.deepEqual(parseBrokerUrl('ws://cerbo.lan:9001/websocket-mqtt'), {
    url: 'ws://cerbo.lan:9001/websocket-mqtt',
  });
  assert.deepEqual(parseBrokerUrl(''), { error: 'empty' });
  assert.deepEqual(parseBrokerUrl('http://cerbo.lan'), { error: 'invalid' });
  assert.deepEqual(parseBrokerUrl('mqtt://user:pass@cerbo.lan'), { error: 'credentials' });
});

test('VRM portal IDs', () => {
  assert.deepEqual(parsePortalId(' c0619ab1c2d3 '), { id: 'c0619ab1c2d3' });
  assert.deepEqual(parsePortalId(''), { id: undefined }, 'read from the GX device');
  assert.deepEqual(parsePortalId(null), { id: undefined });
  assert.deepEqual(parsePortalId('c0619ab1/#'), { error: 'invalid' });
  assert.deepEqual(parsePortalId('a b'), { error: 'invalid' });
});

test('defaults and bounds', () => {
  const config = normalizeConfig({ broker_url: 'cerbo', sensor_interval: 9999, password: null });
  assert.equal(config.brokerUrl, 'mqtt://cerbo');
  assert.equal(config.portalId, undefined);
  assert.equal(config.sensorInterval, 300);
  assert.equal(config.verifyCertificate, false, 'the GX certificate is self-signed');
  assert.equal(config.password, '');
  assert.equal(normalizeConfig({ sensor_interval: 'x' }).sensorInterval, 10);
  assert.equal(normalizeConfig({ sensor_interval: -5 }).sensorInterval, 0);
  assert.equal(normalizeConfig({ verify_certificate: true }).verifyCertificate, true);
  assert.equal(normalizeConfig().brokerError, 'empty');
});
