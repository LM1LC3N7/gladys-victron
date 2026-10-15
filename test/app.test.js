// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys, and a fake broker playing the GX device. Timers are mocked: the
// keep-alive, the rebuild debounce and the state flush run when the test ticks.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { VictronApp } from '../src/app.js';
import { ACTIONS, TIMINGS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { QUIET_KEEPALIVE, SERIAL_TOPIC } from '../src/topics.js';
import {
  ALL,
  BATTERY,
  EV_CHARGER,
  MIN_SOC,
  PORTAL,
  PV_INVERTER,
  SERIAL,
  SOLAR,
  TANK,
  VEBUS,
  completion,
  gone,
  n,
} from './fixtures/venus.js';
import { fakeConnector, settle } from './helpers/fakeMqtt.js';

const ID = (type, instance) => `ext:test-integration:${type}:${PORTAL}-${instance}`;
const SHUNT = ID('battery', 279);
const MULTI = ID('vebus', 276);
const SYSTEM = ID('system', 0);
const FRONIUS = ID('pvinverter', 20);
const MIN_SOC_TOPIC = `${PORTAL}/settings/0/Settings/CGwacs/BatteryLife/MinimumSocLimit`;

async function setup(t, config = { broker_url: '192.168.1.50' }) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_760_000_000_000 });
  const gladys = createFakeGladys({ config });
  const broker = fakeConnector();
  let echoes = 0;
  const app = new VictronApp({
    gladys,
    connect: broker.connect,
    now: () => Date.now(),
    randomId: () => `echo${(echoes += 1)}`,
  });
  registerHandlers(gladys, app);
  await gladys.connect();
  t.after(() => app.stop());
  const tick = async (ms) => {
    t.mock.timers.tick(ms);
    await settle();
  };
  return { gladys, app, broker, tick };
}

const deliver = (client, messages) => {
  for (const m of [].concat(messages)) {
    client.deliver(m.topic, m.payload);
  }
};

/** The broker connects, the GX device is found and answers the full keep-alive. */
async function online(ctx, messages = ALL, echo = 'echo1') {
  const client = ctx.broker.clients[0];
  client.open();
  await settle();
  deliver(client, SERIAL);
  await settle();
  deliver(client, [...messages, completion(echo)]);
  await ctx.tick(0);
  return client;
}

const device = (gladys, externalId) =>
  gladys.fake.discoveredDevices.find((d) => d.external_id === externalId);

test('finds the GX device, wakes it up and offers its devices', async (t) => {
  const ctx = await setup(t);
  const { gladys } = ctx;
  const client = ctx.broker.clients[0];
  assert.equal(client.config.brokerUrl, 'mqtt://192.168.1.50');
  client.open();
  await settle();
  assert.deepEqual([...client.subscriptions], [SERIAL_TOPIC], 'the portal ID is unknown');
  assert.equal(client.published.length, 0, 'nothing is published before the GX is found');
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /waiting for the GX device/);

  deliver(client, SERIAL);
  await settle();
  assert.ok(!client.subscriptions.has(SERIAL_TOPIC));
  assert.ok(client.subscriptions.has(`N/${PORTAL}/battery/+/Soc`));
  assert.ok(client.subscriptions.has(`N/${PORTAL}/full_publish_completed`));
  assert.deepEqual(client.published.slice(0, 2), [
    {
      topic: `R/${PORTAL}/keepalive`,
      payload: '{"keepalive-options":[{"full-publish-completed-echo":"echo1"}]}',
      qos: 0,
      retain: false,
    },
    { topic: `R/${MIN_SOC_TOPIC}`, payload: '', qos: 0, retain: false },
  ]);

  deliver(client, [...ALL, completion('echo1')]);
  await ctx.tick(0);
  assert.equal(gladys.fake.discoveredDevices.length, 9);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, new RegExp(`${PORTAL}: 9 devices`));
  assert.ok(!device(gladys, SYSTEM).features.some((f) => f.external_id.endsWith(':ess_min_soc')));

  // The setting arrives after the full publish: the system device gains it.
  deliver(client, MIN_SOC);
  await ctx.tick(TIMINGS.rebuildDebounce);
  assert.ok(device(gladys, SYSTEM).features.some((f) => f.external_id.endsWith(':ess_min_soc')));
});

test('keeps the GX device awake without asking for everything again', async (t) => {
  const ctx = await setup(t);
  const client = await online(ctx);
  const count = client.published.length;
  await ctx.tick(TIMINGS.keepalive);
  assert.deepEqual(client.published.slice(count), [
    { topic: `R/${PORTAL}/keepalive`, payload: QUIET_KEEPALIVE, qos: 0, retain: false },
  ]);
  await ctx.tick(TIMINGS.keepalive);
  assert.equal(client.published.length, count + 2);
  client.close();
  await ctx.tick(TIMINGS.keepalive);
  assert.equal(client.published.length, count + 2, 'no keep-alive while disconnected');
});

test('states flow once the device is created, measurements within the interval', async (t) => {
  const ctx = await setup(t);
  const { gladys } = ctx;
  const client = await online(ctx);
  await ctx.tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.states.length, 0, 'nothing for the devices not created');

  await gladys.fake.deviceCreated(device(gladys, SHUNT));
  await gladys.fake.deviceCreated(device(gladys, MULTI));
  await ctx.tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(`${SHUNT}:soc`), 76.5, 'the values read before');
  assert.equal(gladys.fake.lastState(`${SHUNT}:discharge_power`), 439);
  assert.equal(gladys.fake.lastState(`${SHUNT}:charge_power`), 0);
  assert.equal(gladys.fake.lastState(`${MULTI}:mode`), 'on');
  assert.deepEqual(gladys.fake.transports.slice(-2), [
    { device_external_id: SHUNT, transport: DEVICE_TRANSPORTS.LOCAL },
    { device_external_id: MULTI, transport: DEVICE_TRANSPORTS.LOCAL },
  ]);

  deliver(client, [n('battery/279', 'Soc', 76.6), n('vebus/276', 'State', 3)]);
  await ctx.tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(`${MULTI}:state`), 'Bulk', 'a state is never delayed');
  assert.equal(gladys.fake.lastState(`${SHUNT}:soc`), 76.5, 'a measurement waits');
  await ctx.tick(10_000);
  assert.equal(gladys.fake.lastState(`${SHUNT}:soc`), 76.6);

  const before = gladys.fake.states.length;
  deliver(client, n('battery/279', 'Dc/0/Voltage', 52.3120002746582));
  await ctx.tick(10_000);
  assert.equal(gladys.fake.states.length, before, 'a value unchanged once rounded is not sent');
});

test('the rate limit of Gladys holds with a chatty installation', async (t) => {
  const ctx = await setup(t, { broker_url: '192.168.1.50', sensor_interval: 0 });
  const { gladys } = ctx;
  const client = await online(ctx);
  for (const d of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(d);
  }
  const start = gladys.fake.states.length;
  for (let second = 0; second < 60; second += 1) {
    deliver(client, [
      ...[279].map((i) => n(`battery/${i}`, 'Dc/0/Power', -400 - second)),
      n('battery/279', 'Dc/0/Current', -8 - second / 10),
      n('battery/279', 'Dc/0/Voltage', 52 + second / 100),
      n('solarcharger/278', 'Yield/Power', 1500 + second),
      n('solarcharger/289', 'Yield/Power', 10 + second),
      n('vebus/276', 'Ac/ActiveIn/P', -100 - second),
      n('vebus/276', 'Ac/Out/L1/P', 600 + second),
      n('grid/30', 'Ac/Power', -300 - second),
      n('acload/31', 'Ac/Power', 800 + second),
      n('pvinverter/20', 'Ac/Power', 1800 + second),
      n('evcharger/40', 'Ac/Power', 7000 + second),
      n('system/0', 'Ac/Consumption/L1/Power', 500 + second),
    ]);
    await ctx.tick(1000);
  }
  const sent = gladys.fake.states.length - start;
  assert.ok(sent <= 250, `${sent} states in a minute`);
  assert.ok(sent > 200, `${sent} states: the budget is used`);
});

test('writes the inverter/charger mode and the ESS minimum SOC', async (t) => {
  const ctx = await setup(t);
  const { gladys } = ctx;
  const client = await online(ctx, [...ALL, MIN_SOC]);
  await ctx.tick(TIMINGS.rebuildDebounce);
  const multi = device(gladys, MULTI);
  const system = device(gladys, SYSTEM);
  await gladys.fake.deviceCreated(multi);
  await gladys.fake.deviceCreated(system);
  const feature = (d, key) => d.features.find((f) => f.external_id === `${d.external_id}:${key}`);

  const ack = await gladys.fake.setValue(multi, feature(multi, 'mode'), 'off');
  assert.deepEqual(ack, { success: true });
  assert.deepEqual(client.published.at(-1), {
    topic: `W/${PORTAL}/vebus/276/Mode`,
    payload: '{"value":4}',
    qos: 0,
    retain: false,
  });
  const eco = await gladys.fake.setValue(multi, feature(multi, 'mode'), 'eco');
  assert.equal(eco.success, false);
  assert.match(eco.error, /unknown mode/);

  await gladys.fake.setValue(system, feature(system, 'ess_min_soc'), 15);
  assert.deepEqual(client.published.slice(-2), [
    { topic: `W/${MIN_SOC_TOPIC}`, payload: '{"value":15}', qos: 0, retain: false },
    { topic: `R/${MIN_SOC_TOPIC}`, payload: '', qos: 0, retain: false },
  ]);
  const tooHigh = await gladys.fake.setValue(system, feature(system, 'ess_min_soc'), 150);
  assert.equal(tooHigh.success, false);

  const sensor = await gladys.fake.setValue(multi, feature(multi, 'ac_out_power'), 1);
  assert.equal(sensor.success, false, 'a measurement cannot be written');

  // The GX confirms: the new mode comes back as a notification.
  deliver(client, n('vebus/276', 'Mode', 4));
  await ctx.tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(`${MULTI}:mode`), 'off');

  client.close();
  const offline = await gladys.fake.setValue(multi, feature(multi, 'mode'), 'on');
  assert.equal(offline.success, false);
  assert.match(offline.error, /not connected/);
});

test('a device leaving the GX is unreachable, and back when it returns', async (t) => {
  const ctx = await setup(t);
  const { gladys } = ctx;
  const client = await online(ctx);
  await gladys.fake.deviceCreated(device(gladys, FRONIUS));
  const badge = (transport) => ({ device_external_id: FRONIUS, transport });
  assert.deepEqual(gladys.fake.transports.at(-1), badge(DEVICE_TRANSPORTS.LOCAL));

  // Night: the Fronius shuts down, every one of its topics gets an empty payload.
  deliver(client, [gone('pvinverter/20', 'Ac/Power'), gone('pvinverter/20', 'ProductId')]);
  await settle();
  assert.deepEqual(gladys.fake.transports.at(-1), badge(DEVICE_TRANSPORTS.UNREACHABLE));
  await ctx.tick(TIMINGS.rebuildDebounce);
  assert.equal(device(gladys, FRONIUS), undefined, 'out of Discovery');

  deliver(client, PV_INVERTER);
  await ctx.tick(TIMINGS.rebuildDebounce);
  assert.ok(device(gladys, FRONIUS));
  assert.deepEqual(gladys.fake.transports.at(-1), badge(DEVICE_TRANSPORTS.LOCAL));
});

test('after a reconnection, the services the full publish omits are gone', async (t) => {
  const ctx = await setup(t);
  const { gladys } = ctx;
  const client = await online(ctx);
  const charger = ID('evcharger', 40);
  await gladys.fake.deviceCreated(device(gladys, charger));
  await gladys.fake.deviceCreated(device(gladys, SHUNT));

  client.close();
  await settle();
  assert.deepEqual(
    gladys.fake.transports.slice(-2).map((e) => e.transport),
    [DEVICE_TRANSPORTS.UNREACHABLE, DEVICE_TRANSPORTS.UNREACHABLE],
  );
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /lost/);

  const count = client.published.length;
  client.open();
  await settle();
  assert.equal(client.published[count].topic, `R/${PORTAL}/keepalive`, 'every value again');
  assert.match(client.published[count].payload, /echo2/);
  const without = ALL.filter((m) => !EV_CHARGER.includes(m));
  // Another client's full publish (VRM...) does not count.
  deliver(client, [...without, completion('someone-else')]);
  await ctx.tick(0);
  assert.ok(device(gladys, charger), 'not ours: nothing is forgotten');
  deliver(client, completion('echo2'));
  await ctx.tick(0);
  assert.equal(device(gladys, charger), undefined);
  const badges = Object.fromEntries(
    gladys.fake.transports.map((e) => [e.device_external_id, e.transport]),
  );
  assert.equal(badges[charger], DEVICE_TRANSPORTS.UNREACHABLE);
  assert.equal(badges[SHUNT], DEVICE_TRANSPORTS.LOCAL);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a configured portal ID is used as is', async (t) => {
  const ctx = await setup(t, { broker_url: 'mqtts://cerbo.lan:8883', portal_id: PORTAL });
  const { gladys } = ctx;
  const client = ctx.broker.clients[0];
  assert.equal(client.config.verifyCertificate, false, 'the GX certificate is self-signed');
  client.open();
  await settle();
  assert.ok(!client.subscriptions.has(SERIAL_TOPIC));
  assert.equal(client.published[0].topic, `R/${PORTAL}/keepalive`);
  // Another GX on the same broker is ignored.
  deliver(client, [n('battery/1', 'ProductId', 1, 'other'), n('battery/1', 'Soc', 5, 'other')]);
  deliver(client, [...BATTERY, completion('echo1')]);
  await ctx.tick(0);
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.external_id),
    [SHUNT],
  );
});

test('two starts in a row open one connection', async (t) => {
  const ctx = await setup(t);
  await Promise.all([
    ctx.app.start({ broker_url: 'first.lan' }),
    ctx.app.start({ broker_url: 'second.lan' }),
  ]);
  assert.equal(ctx.broker.clients.length, 2, 'the one of the startup, then the last one');
  assert.equal(ctx.broker.clients[0].ended, true);
  assert.equal(ctx.broker.clients[1].config.brokerUrl, 'mqtt://second.lan');
});

test('the status tells what is missing in the configuration', async (t) => {
  const notConfigured = await setup(t, {});
  assert.match(notConfigured.gladys.fake.connectionStatus.message.en, /Type the address/);
  assert.equal(notConfigured.broker.clients.length, 0);

  const badPortal = createFakeGladys();
  const app = new VictronApp({ gladys: badPortal, connect: () => assert.fail('no connection') });
  await app.start({ broker_url: 'cerbo', portal_id: 'a/#' });
  assert.match(badPortal.fake.connectionStatus.message.en, /portal ID is not valid/);
  app.stop();
});

test('the status tells when no GX device answers, or when it refuses', async (t) => {
  const ctx = await setup(t);
  const client = ctx.broker.clients[0];
  client.open();
  await ctx.tick(TIMINGS.gxTimeout);
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /no GX device publishes/);
  client.emit('error', Object.assign(new Error('refused'), { code: 5 }));
  await settle();
  assert.match(
    ctx.gladys.fake.connectionStatus.message.en,
    /refused the connection: not authorized/,
  );
});

test('a GX device that does not answer the keep-alive', async (t) => {
  const ctx = await setup(t, { broker_url: 'cerbo', portal_id: PORTAL });
  ctx.broker.clients[0].open();
  await ctx.tick(TIMINGS.gxTimeout);
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /does not answer/);
});

test('a scan asks for every value and publishes the list again', async (t) => {
  const ctx = await setup(t);
  const { gladys } = ctx;
  const client = await online(ctx, [...SOLAR, ...VEBUS]);
  const publications = gladys.fake.requests.filter((r) => r.path.includes('discover')).length;
  const count = client.published.length;
  await gladys.fake.scanRequest();
  assert.match(client.published[count].payload, /echo2/);
  assert.equal(
    gladys.fake.requests.filter((r) => r.path.includes('discover')).length,
    publications + 1,
  );
  assert.equal(gladys.fake.discoveredDevices.length, 3);
});

test('the connection test counts the devices of the GX', async (t) => {
  const ctx = await setup(t);
  await online(ctx);
  const pending = ctx.gladys.fake.action(ACTIONS.TEST, {});
  await settle();
  const probe = ctx.broker.clients[1];
  probe.open();
  await settle();
  assert.deepEqual([...probe.subscriptions], [SERIAL_TOPIC]);
  deliver(probe, SERIAL);
  await settle();
  assert.ok(probe.subscriptions.has(`N/${PORTAL}/+/+/ProductId`));
  assert.equal(probe.published[0].topic, `R/${PORTAL}/keepalive`);
  const echo = JSON.parse(probe.published[0].payload)['keepalive-options'][0][
    'full-publish-completed-echo'
  ];
  const productIds = [...BATTERY, ...SOLAR, ...VEBUS, ...TANK].filter((m) =>
    m.topic.endsWith('/ProductId'),
  );
  deliver(probe, [...productIds, n('system/0', 'ProductId', 0), n('platform/0', 'ProductId', 0)]);
  deliver(probe, completion(echo));
  const ack = await pending;
  assert.equal(ack.success, true);
  assert.deepEqual(ack.data.message, {
    en: `Connection OK: GX device ${PORTAL}, 1 battery monitor, 2 solar chargers, 1 inverter/charger. Not supported yet: tank.`,
    fr: `Connexion OK : GX ${PORTAL}, 1 batterie, 2 chargeurs solaires, 1 onduleur/chargeur. Pas encore pris en charge : tank.`,
  });
  assert.equal(probe.ended, true);
});

test('the connection test without a GX device', async (t) => {
  const ctx = await setup(t);
  const pending = ctx.gladys.fake.action(ACTIONS.TEST, {});
  await settle();
  const probe = ctx.broker.clients[1];
  probe.open();
  await ctx.tick(TIMINGS.testTimeout);
  const ack = await pending;
  assert.match(ack.data.message.en, /no GX device publishes/);
  assert.equal(probe.ended, true);
});
