// -----------------------------------------------------------------------------
// The catalog is data: these tests keep it consistent with the SDK constants
// and with the conventions of the energy categories.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { MODES, SERVICES, evChargerStatus, sourceValue, subscriptions } from '../src/catalog.js';

const categoryKey = (value) =>
  Object.keys(DEVICE_FEATURE_CATEGORIES).find((k) => DEVICE_FEATURE_CATEGORIES[k] === value);

test('every feature uses a category, a type and a unit Gladys knows', () => {
  const units = new Set(Object.values(DEVICE_FEATURE_UNITS));
  for (const [type, spec] of Object.entries(SERVICES)) {
    const keys = spec.features.map((f) => f.key);
    assert.equal(new Set(keys).size, keys.length, `${type}: duplicate feature keys`);
    for (const f of spec.features) {
      const where = `${type}.${f.key}`;
      assert.match(f.key, /^[a-z0-9_]+$/, where);
      const category = categoryKey(f.category);
      assert.ok(category, `${where}: unknown category ${f.category}`);
      assert.ok(
        Object.values(DEVICE_FEATURE_TYPES[category]).includes(f.type),
        `${where}: ${f.type} is not a ${f.category} type`,
      );
      if (f.unit) {
        assert.ok(units.has(f.unit), `${where}: unknown unit ${f.unit}`);
      }
      assert.ok(f.min <= f.max, where);
      assert.ok(f.sources.length > 0 && f.sources.every((alt) => alt.length > 0), where);
    }
  }
});

test('the power conventions of the energy categories', () => {
  const C = DEVICE_FEATURE_CATEGORIES;
  // Power that cannot be negative: production, battery charge and discharge, delivered power.
  for (const [type, spec] of Object.entries(SERVICES)) {
    for (const f of spec.features) {
      const nonNegative = [
        C.ENERGY_PRODUCTION_SENSOR,
        C.BATTERY_STORAGE,
        C.HOME_OUTPUT_SENSOR,
      ].includes(f.category);
      if (nonNegative && f.unit === DEVICE_FEATURE_UNITS.WATT) {
        assert.ok(f.min >= 0, `${type}.${f.key} must be >= 0`);
        assert.ok(f.read(-1500).state >= 0, `${type}.${f.key} is never negative`);
        assert.ok(f.read(1500).state >= 0, `${type}.${f.key} is never negative`);
      }
      if (f.unit === DEVICE_FEATURE_UNITS.KILOWATT_HOUR) {
        assert.ok(f.min >= 0, `${type}.${f.key}: an energy index is >= 0`);
      }
    }
  }
  const battery = Object.fromEntries(SERVICES.battery.features.map((f) => [f.key, f]));
  // /Dc/0/Power is positive when charging.
  assert.deepEqual(battery.charge_power.read(439.2), { state: 439 });
  assert.deepEqual(battery.discharge_power.read(439.2), { state: 0 });
  assert.deepEqual(battery.discharge_power.read(-439.2), { state: 439 });
  // The grid meter reports one signed value: grid-sensor/power, import > 0.
  const grid = SERVICES.grid.features.find((f) => f.key === 'power');
  assert.equal(grid.type, DEVICE_FEATURE_TYPES.GRID_SENSOR.POWER);
  assert.deepEqual(grid.read(-350.6000061035156), { state: -351 });
});

test('a feature reads its first alternative carrying a number, summed', () => {
  const feature = { sources: [['Ac/Out/P'], ['Ac/Out/L1/P', 'Ac/Out/L2/P', 'Ac/Out/L3/P']] };
  const values = (entries) => new Map(Object.entries(entries));
  assert.equal(sourceValue(feature, values({ 'Ac/Out/P': 700, 'Ac/Out/L1/P': 1 })), 700);
  assert.equal(
    sourceValue(feature, values({ 'Ac/Out/P': null, 'Ac/Out/L1/P': 300, 'Ac/Out/L2/P': 200 })),
    500,
  );
  assert.equal(sourceValue(feature, values({ 'Ac/Out/L1/P': null })), undefined);
  assert.equal(sourceValue(feature, values({ 'Ac/Out/P': 'x' })), undefined);
  assert.equal(sourceValue(feature, undefined), undefined);
});

test('the inverter/charger mode', () => {
  const mode = SERVICES.vebus.features.find((f) => f.key === 'mode');
  assert.deepEqual(
    MODES.map((m) => m.code).sort(),
    [1, 2, 3, 4],
    'charger only, inverter only, on, off',
  );
  assert.deepEqual(mode.read(1), { text: 'charger-only' });
  assert.equal(mode.read(5), undefined, 'a code outside the options is not a selection');
  assert.equal(mode.write.encode('off'), 4);
  assert.throws(() => mode.write.encode('eco'), /unknown mode/);
  assert.equal(mode.readOnly(new Map([['ModeIsAdjustable', 0]])), true);
  assert.equal(mode.readOnly(new Map([['ModeIsAdjustable', 1]])), false);
  assert.equal(mode.readOnly(new Map()), false, 'adjustable unless the GX says otherwise');
  for (const option of mode.options) {
    assert.equal(typeof option.label, 'string', option.value);
  }
});

test('the ESS minimum SOC', () => {
  const soc = SERVICES.system.features.find((f) => f.key === 'ess_min_soc');
  assert.equal(soc.write.encode('15'), 15);
  assert.equal(soc.write.encode(20.4), 20);
  assert.throws(() => soc.write.encode(101), /between 0 and 100/);
  assert.throws(() => soc.write.encode('x'), /between 0 and 100/);
  assert.equal(soc.when({ ess: false }), false, 'only for ESS systems');
});

test('EV charger status -> charging station enums', () => {
  assert.deepEqual(evChargerStatus(0), { connector: 0 }, 'disconnected: available');
  assert.deepEqual(evChargerStatus(1), { connector: 1, charging: 1 }, 'connected');
  assert.deepEqual(evChargerStatus(2), { connector: 1, charging: 0 }, 'charging');
  assert.deepEqual(evChargerStatus(3), { connector: 1, charging: 4 }, 'charged: idle');
  assert.deepEqual(evChargerStatus(4), { connector: 1, charging: 3 }, 'waiting for sun');
  assert.deepEqual(evChargerStatus(9), { connector: 4 }, 'welded contacts: faulted');
  assert.deepEqual(evChargerStatus(17), {}, 'reserved');
});

test('the subscriptions stay on the paths of the catalog', () => {
  const topics = subscriptions('c0619ab1c2d3');
  assert.equal(new Set(topics).size, topics.length);
  for (const topic of topics) {
    assert.ok(topic.startsWith('N/c0619ab1c2d3/'), topic);
    assert.ok(!topic.includes('#'), `${topic}: no multi-level wildcard`);
  }
  for (const expected of [
    'N/c0619ab1c2d3/full_publish_completed',
    'N/c0619ab1c2d3/+/+/ProductId',
    'N/c0619ab1c2d3/battery/+/Soc',
    'N/c0619ab1c2d3/system/0/Ac/Consumption/L1/Power',
    'N/c0619ab1c2d3/settings/0/Settings/CGwacs/BatteryLife/MinimumSocLimit',
    'N/c0619ab1c2d3/vebus/+/ModeIsAdjustable',
  ]) {
    assert.ok(topics.includes(expected), expected);
  }
});
