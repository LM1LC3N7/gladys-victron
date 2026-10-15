// -----------------------------------------------------------------------------
// The store and the devices built from it, with the notifications of a real
// installation (test/fixtures/venus.js).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { buildModel, featureState } from '../src/devices.js';
import { VictronStore } from '../src/store.js';
import { parsePayload, parseTopic } from '../src/topics.js';
import { ALL, METERS, MIN_SOC, PORTAL, VEBUS, gone, n } from './fixtures/venus.js';

const gladys = createFakeGladys();
const externalIds = (type, id) => gladys.externalIds(type, id);

function storeOf(messages) {
  const store = new VictronStore();
  const changes = messages.map(({ topic, payload }) => {
    const info = parseTopic(topic);
    return store.apply(info.service, info.instance, info.path, parsePayload(payload));
  });
  return { store, changes };
}

const model = (messages) =>
  buildModel({ externalIds, portal: PORTAL, store: storeOf(messages).store });
const keys = (device) => device.features.map((f) => f.external_id.split(':').pop());
const named = (m, name) => m.devices.find((d) => d.name === name);

function state(m, featureId, messages) {
  return featureState(m.features.get(featureId), storeOf(messages).store);
}

test('one device per supported service, named by the GX', () => {
  const m = model([...ALL, MIN_SOC]);
  assert.deepEqual(
    m.devices.map((d) => d.name),
    [
      'Victron system',
      'SmartShunt 500A/50mV',
      'MPPT toit',
      'SmartSolar Charger MPPT 100/20',
      'MultiPlus-II 48/5000/70-50',
      'Energy Meter ET112',
      'Fronius Primo 3.0-1',
      'Borne garage',
      'Pompe piscine',
    ],
    'custom name first, product name else; the tank is not supported yet',
  );
  const shunt = named(m, 'SmartShunt 500A/50mV');
  assert.equal(shunt.external_id, `ext:test-integration:battery:${PORTAL}-279`);
  assert.deepEqual(shunt.params, [
    { name: 'VICTRON_PORTAL_ID', value: PORTAL },
    { name: 'VICTRON_SERVICE', value: 'battery/279' },
    { name: 'VICTRON_PRODUCT', value: 'SmartShunt 500A/50mV' },
  ]);
});

test('the features follow the paths the device publishes', () => {
  const m = model([...ALL, MIN_SOC]);
  assert.deepEqual(
    keys(named(m, 'SmartShunt 500A/50mV')),
    [
      'soc',
      'charge_power',
      'discharge_power',
      'voltage',
      'current',
      'charged_energy',
      'discharged_energy',
    ],
    'no temperature: the shunt has no sensor (null)',
  );
  assert.deepEqual(keys(named(m, 'MPPT toit')), [
    'pv_power',
    'yield_today',
    'yield_total',
    'state',
  ]);
  assert.deepEqual(keys(named(m, 'MultiPlus-II 48/5000/70-50')), [
    'ac_in_power',
    'ac_out_power',
    'state',
    'mode',
  ]);
  assert.deepEqual(keys(named(m, 'Energy Meter ET112')), ['power', 'import_index', 'export_index']);
  assert.deepEqual(keys(named(m, 'Borne garage')), [
    'power',
    'index',
    'connector_status',
    'charging_state',
    'status',
  ]);
  assert.deepEqual(
    keys(named(m, 'Victron system')),
    ['consumption', 'state', 'ess_min_soc'],
    'no system grid power next to a grid meter',
  );
});

test('the system grid power and the ESS minimum SOC depend on the installation', () => {
  const withoutMeter = ALL.filter((msg) => !msg.topic.includes('/grid/'));
  const noEss = withoutMeter.map((msg) =>
    msg.topic.endsWith('/system/0/Hub') ? n('system/0', 'Hub', 0) : msg,
  );
  assert.deepEqual(keys(named(model([...withoutMeter, MIN_SOC]), 'Victron system')), [
    'consumption',
    'grid_power',
    'state',
    'ess_min_soc',
  ]);
  assert.deepEqual(keys(named(model([...noEss, MIN_SOC]), 'Victron system')), [
    'consumption',
    'grid_power',
    'state',
  ]);
  assert.ok(
    !keys(named(model(ALL), 'Victron system')).includes('ess_min_soc'),
    'the setting is only known once read',
  );
});

test('the Gladys values', () => {
  const messages = [...ALL, MIN_SOC];
  const m = model(messages);
  const id = (type, instance, key) => `ext:test-integration:${type}:${PORTAL}-${instance}:${key}`;
  const expected = [
    [id('battery', 279, 'soc'), { state: 76.5 }],
    [id('battery', 279, 'voltage'), { state: 52.31 }],
    [id('battery', 279, 'current'), { state: -8.4 }],
    [id('battery', 279, 'charge_power'), { state: 0 }],
    [id('battery', 279, 'discharge_power'), { state: 439 }],
    [id('battery', 279, 'charged_energy'), { state: 1234.5 }],
    [id('solarcharger', 278, 'pv_power'), { state: 1520 }],
    [id('solarcharger', 278, 'yield_today'), { state: 4.82 }],
    [id('solarcharger', 278, 'yield_total'), { state: 2345.67 }],
    [id('solarcharger', 278, 'state'), { text: 'Bulk' }],
    [id('vebus', 276, 'ac_in_power'), { state: -120 }],
    [id('vebus', 276, 'ac_out_power'), { state: 645 }],
    [id('vebus', 276, 'state'), { text: 'Inverting' }],
    [id('vebus', 276, 'mode'), { text: 'on' }],
    [id('grid', 30, 'power'), { state: -351 }],
    [id('grid', 30, 'import_index'), { state: 8765.43 }],
    [id('acload', 31, 'power'), { state: 812 }],
    [id('pvinverter', 20, 'power'), { state: 1891 }],
    [id('pvinverter', 20, 'state'), { text: 'Running' }],
    [id('evcharger', 40, 'connector_status'), { state: 1 }],
    [id('evcharger', 40, 'charging_state'), { state: 0 }],
    [id('evcharger', 40, 'status'), { text: 'Charging' }],
    [id('system', 0, 'consumption'), { state: 512 }],
    [id('system', 0, 'state'), { text: 'Discharging' }],
    [id('system', 0, 'ess_min_soc'), { state: 20 }],
  ];
  for (const [featureId, value] of expected) {
    assert.deepEqual(state(m, featureId, messages), value, featureId);
  }
});

test('routes, writers and throttling', () => {
  const m = model([...ALL, MIN_SOC]);
  const mode = `ext:test-integration:vebus:${PORTAL}-276:mode`;
  const minSoc = `ext:test-integration:system:${PORTAL}-0:ess_min_soc`;
  assert.deepEqual(m.routes.get('battery/279|Dc/0/Power'), [
    `ext:test-integration:battery:${PORTAL}-279:charge_power`,
    `ext:test-integration:battery:${PORTAL}-279:discharge_power`,
  ]);
  assert.deepEqual(m.routes.get('settings/0|Settings/CGwacs/BatteryLife/MinimumSocLimit'), [
    minSoc,
  ]);
  assert.deepEqual(m.writers.get(mode)('charger-only'), {
    serviceKey: 'vebus/276',
    path: 'Mode',
    value: 1,
  });
  assert.deepEqual(m.writers.get(minSoc)(25), {
    serviceKey: 'settings/0',
    path: 'Settings/CGwacs/BatteryLife/MinimumSocLimit',
    value: 25,
  });
  assert.equal(m.writers.size, 2, 'only the mode and the minimum SOC can be written');
  assert.ok(m.throttled.has(`ext:test-integration:battery:${PORTAL}-279:soc`));
  assert.ok(!m.throttled.has(mode), 'a mode change is never delayed');
  const vebus = named(m, 'MultiPlus-II 48/5000/70-50');
  const feature = vebus.features.find((f) => f.external_id === mode);
  assert.equal(feature.read_only, false);
  assert.deepEqual(
    feature.supported_options.map((o) => o.value),
    ['on', 'off', 'charger-only', 'inverter-only'],
  );
  const locked = model([...VEBUS, n('vebus/276', 'ModeIsAdjustable', 0)]);
  assert.equal(
    named(locked, 'MultiPlus-II 48/5000/70-50').features.find((f) => f.external_id === mode)
      .read_only,
    true,
    'a VE.Bus BMS holds the switch',
  );
  assert.equal(locked.writers.size, 0);
});

test('Gladys accepts the devices', async () => {
  const fake = createFakeGladys();
  await fake.publishDiscoveredDevices(model([...ALL, MIN_SOC]).devices);
  assert.equal(fake.fake.discoveredDevices.length, 9);
});

test('what the store says about each notification', () => {
  const { store, changes } = storeOf([
    ...METERS.slice(0, 4),
    n('grid/30', 'Ac/Power', -200),
    n('grid/30', 'Ac/Power', null),
    n('grid/30', 'CustomName', 'Compteur'),
    gone('grid/30', 'Ac/Power'),
    gone('grid/30', 'ProductId'),
    gone('grid/31', 'ProductId'),
  ]);
  assert.deepEqual(changes, [
    { structural: true }, // a new service
    { structural: true }, // a new name
    { structural: true }, // a custom name, even empty
    { structural: true }, // the first number on a path
    { structural: false }, // another number
    { structural: false }, // invalid for now
    { structural: true }, // renamed
    {}, // a path cleared
    { structural: true, removed: 'grid/30' }, // the device left
    {}, // unknown service
  ]);
  assert.equal(store.services.size, 0);
});

test('a full publish forgets the services it did not mention, never the settings', () => {
  const { store } = storeOf([...METERS, MIN_SOC]);
  store.mark();
  for (const { topic, payload } of METERS.filter((msg) => msg.topic.includes('/acload/'))) {
    const info = parseTopic(topic);
    store.apply(info.service, info.instance, info.path, parsePayload(payload));
  }
  assert.deepEqual(
    store.sweep((type) => type !== 'settings'),
    ['grid/30'],
  );
  assert.deepEqual([...store.services.keys()], ['acload/31', 'settings/0']);
});

test('the number of services is bounded', () => {
  const store = new VictronStore({ limit: 1 });
  assert.deepEqual(store.apply('battery', '1', 'Soc', { value: 1 }), { structural: true });
  assert.match(store.apply('battery', '2', 'Soc', { value: 1 }).ignored, /more than 1/);
});
