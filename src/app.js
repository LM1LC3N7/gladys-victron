// -----------------------------------------------------------------------------
// The integration: one connection to the MQTT broker of the GX device, the
// keep-alive that makes it publish, the values it publishes (src/store.js),
// the Gladys devices built from them (src/devices.js), the states sent within
// the Gladys rate limit, and the writes sent back. index.js only wires the SDK
// handlers to it.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { READ_ON_REFRESH, SERVICES, subscriptions } from './catalog.js';
import { normalizeConfig } from './config.js';
import { TIMINGS } from './constants.js';
import { buildModel, featureState } from './devices.js';
import { T, countList } from './i18n.js';
import { connectBroker, errorReason, isRefusal, tooLarge } from './mqtt.js';
import { StatePublisher } from './publisher.js';
import { VictronStore } from './store.js';
import {
  QUIET_KEEPALIVE,
  SERIAL_TOPIC,
  completionEcho,
  fullKeepalive,
  keepaliveTopic,
  parsePayload,
  parseTopic,
  readTopic,
  writePayload,
  writeTopic,
} from './topics.js';

const isDeviceService = (type) => type in SERVICES;

/** Services of the GX device itself, not devices: left out of the test summary. */
const INFRASTRUCTURE = new Set([
  'acsystem',
  'adc',
  'ble',
  'digitalinputs',
  'fronius',
  'generator',
  'hub4',
  'logger',
  'modbusclient',
  'modbustcp',
  'modem',
  'platform',
  'settings',
  'vecan',
]);
const isSerial = (info) =>
  info.service === 'system' && info.instance === '0' && info.path === 'Serial';

/** Publishes on the broker, as a promise (mqtt.js uses a callback). */
const publish = (client, topic, payload) =>
  new Promise((resolve, reject) => {
    client.publish(topic, payload, { qos: 0, retain: false }, (err) =>
      err ? reject(err) : resolve(),
    );
  });

export class VictronApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'victron' }),
    connect = connectBroker,
    now = Date.now,
    timers = globalThis,
    randomId = () => randomBytes(6).toString('hex'),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.connect = connect;
    this.timers = timers;
    this.randomId = randomId;
    this.config = normalizeConfig();
    this.store = new VictronStore();
    this.portal = undefined;
    this.model = buildModel({ store: this.store });
    this.client = null;
    this.subscribed = new Set();
    /** The GX device answered our last full keep-alive. */
    this.ready = false;
    this.echo = undefined;
    /** deviceId -> transport last published */
    this.transports = new Map();
    /** featureId -> last value read, sent when the user creates the device */
    this.lastValues = new Map();
    this.created = new Set();
    this.publishedDevices = undefined;
    this.rebuildTimer = undefined;
    this.keepaliveTimer = undefined;
    this.gxTimer = undefined;
    this.generation = 0;
    this.lastStatus = undefined;
    this.warned = new Set();
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}) {
    this.stop();
    const generation = this.generation;
    this.config = normalizeConfig(raw);
    this.refreshCreated();
    // Another GX device may be behind the new address: start from scratch.
    this.store = new VictronStore();
    this.portal = this.config.portalId;
    this.model = buildModel({ store: this.store });
    this.publishedDevices = undefined;
    this.lastValues.clear();
    if (this.config.brokerError) {
      await this.setStatus(
        false,
        this.config.brokerError === 'empty' ? T.notConfigured : T.badUrl(this.config.brokerError),
      );
      return;
    }
    if (this.config.portalError) {
      await this.setStatus(false, T.badPortal);
      return;
    }
    await this.setStatus(false, T.connecting);
    if (generation !== this.generation) {
      // Started again meanwhile (configuration saved while Gladys reconnected).
      return;
    }
    this.publisher.configure({ intervalSeconds: this.config.sensorInterval, throttled: new Set() });
    this.publisher.start();
    const client = this.connect(this.config);
    this.client = client;
    const current = () => generation === this.generation && this.client === client;
    client.on('connect', () => {
      if (current()) {
        this.onConnect().catch((err) => this.logger.error(`After connection: ${err.message}`));
      }
    });
    client.on('message', (topic, payload) => {
      if (current()) {
        this.onMessage(topic, payload);
      }
    });
    client.on('error', (err) => {
      if (current()) {
        const reason = errorReason(err);
        this.logger.warn(`MQTT broker: ${reason}`);
        this.setStatus(false, isRefusal(err) ? T.refused(reason) : T.unreachable(reason));
      }
    });
    client.on('close', () => {
      if (current() && this.subscribed.size > 0) {
        this.subscribed.clear();
        this.ready = false;
        this.stopKeepalive();
        this.setStatus(false, T.lost);
        this.publishAllTransports(false).catch(() => {});
      }
    });
  }

  stop() {
    this.generation += 1;
    this.timers.clearTimeout(this.rebuildTimer);
    this.timers.clearTimeout(this.gxTimer);
    this.rebuildTimer = undefined;
    this.gxTimer = undefined;
    this.stopKeepalive();
    this.publisher.stop();
    if (this.client) {
      this.client.removeAllListeners?.();
      this.client.on?.('error', () => {});
      this.client.end(true);
      this.client = null;
    }
    this.subscribed.clear();
    this.ready = false;
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  warnOnce(key, message) {
    if (!this.warned.has(key)) {
      this.warned.add(key);
      this.logger.warn(message);
    }
  }

  async onConnect() {
    this.logger.info(`Connected to ${this.config.brokerUrl}`);
    this.subscribed.clear();
    this.ready = false;
    this.timers.clearTimeout(this.gxTimer);
    const generation = this.generation;
    this.gxTimer = this.timers.setTimeout(() => {
      if (generation === this.generation && !this.ready) {
        this.setStatus(false, this.portal ? T.noAnswer(this.portal) : T.noGx);
      }
    }, TIMINGS.gxTimeout);
    if (this.portal) {
      this.wakeUp();
    } else {
      // The serial of the system service is retained: it names the portal.
      this.syncSubscriptions();
    }
    await this.setStatus(false, T.waiting);
  }

  /** The portal is known: subscribe to its topics and make it publish. */
  wakeUp() {
    this.syncSubscriptions();
    this.sendFullKeepalive();
    this.startKeepalive();
  }

  statusMessage() {
    return this.model.devices.length > 0
      ? T.connected(this.model.devices.length, this.portal)
      : T.noDevice(this.portal);
  }

  // --- Keep-alive -------------------------------------------------------------

  /** Every value again: at the connection, and when Gladys scans. */
  sendFullKeepalive() {
    const client = this.client;
    if (!client?.connected || !this.portal) {
      return;
    }
    this.echo = this.randomId();
    this.store.mark();
    const portal = this.portal;
    publish(client, keepaliveTopic(portal), fullKeepalive(this.echo))
      // The settings are only published when read.
      .then(() =>
        Promise.all(
          READ_ON_REFRESH.map(({ serviceKey, path }) =>
            publish(client, readTopic(portal, serviceKey, path), ''),
          ),
        ),
      )
      .catch((err) => this.logger.warn(`Keep-alive failed: ${err.message}`));
  }

  startKeepalive() {
    this.stopKeepalive();
    this.keepaliveTimer = this.timers.setInterval(() => {
      const client = this.client;
      if (client?.connected && this.portal) {
        publish(client, keepaliveTopic(this.portal), QUIET_KEEPALIVE).catch((err) =>
          this.logger.warn(`Keep-alive failed: ${err.message}`),
        );
      }
    }, TIMINGS.keepalive);
  }

  stopKeepalive() {
    if (this.keepaliveTimer) {
      this.timers.clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = undefined;
    }
  }

  // --- Subscriptions ---------------------------------------------------------

  syncSubscriptions() {
    const client = this.client;
    if (!client?.connected) {
      return;
    }
    const wanted = new Set(this.portal ? subscriptions(this.portal) : [SERIAL_TOPIC]);
    const added = [...wanted].filter((t) => !this.subscribed.has(t));
    const removed = [...this.subscribed].filter((t) => !wanted.has(t));
    if (added.length > 0) {
      client.subscribe(added, { qos: 0 }, (err) => {
        if (err) {
          this.logger.warn(`Subscription failed: ${err.message}`);
        }
      });
    }
    if (removed.length > 0) {
      client.unsubscribe(removed);
    }
    this.subscribed = wanted;
  }

  // --- Messages --------------------------------------------------------------

  onMessage(topic, payload) {
    if (tooLarge(payload)) {
      this.warnOnce(`large:${topic}`, `Message on ${topic} ignored: too large`);
      return;
    }
    const info = parseTopic(topic);
    if (!info) {
      return;
    }
    if (!this.portal) {
      if (isSerial(info)) {
        this.logger.info(`GX device found: VRM portal ID ${info.portal}`);
        this.portal = info.portal;
        this.wakeUp();
      }
      return;
    }
    if (info.portal !== this.portal) {
      return;
    }
    if (info.special) {
      if (info.special === 'full_publish_completed') {
        this.onFullPublish(payload);
      }
      return;
    }
    const parsed = parsePayload(payload);
    if (parsed.error) {
      this.warnOnce(`payload:${info.path}`, `Message on ${topic} ignored: ${parsed.error}`);
      return;
    }
    const key = `${info.service}/${info.instance}`;
    const change = this.store.apply(info.service, info.instance, info.path, parsed);
    if (change.ignored) {
      this.warnOnce('too-many', `Message on ${topic} ignored: ${change.ignored}`);
      return;
    }
    if (change.removed) {
      this.serviceGone(change.removed);
    }
    if (change.structural) {
      this.scheduleRebuild();
    }
    for (const featureId of this.model.routes.get(`${key}|${info.path}`) ?? []) {
      const value = featureState(this.model.features.get(featureId), this.store);
      if (value) {
        this.record(featureId, value);
      }
    }
  }

  onFullPublish(payload) {
    const echo = completionEcho(payload);
    if (echo !== undefined && echo !== this.echo) {
      // Another client's full publish (VRM, a phone app...): ours is coming.
      return;
    }
    if (echo !== undefined) {
      for (const key of this.store.sweep(isDeviceService)) {
        this.serviceGone(key);
      }
    }
    if (!this.ready) {
      this.ready = true;
      this.logger.info(`GX device ${this.portal} published its values`);
    }
    this.scheduleRebuild(0);
  }

  serviceGone(key) {
    this.logger.info(`${key} left the GX device`);
    const deviceId = this.model.deviceOf.get(key);
    if (deviceId) {
      this.publishTransport(deviceId, DEVICE_TRANSPORTS.UNREACHABLE).catch(() => {});
    }
    this.scheduleRebuild();
  }

  scheduleRebuild(delay = TIMINGS.rebuildDebounce) {
    this.timers.clearTimeout(this.rebuildTimer);
    const generation = this.generation;
    this.rebuildTimer = this.timers.setTimeout(() => {
      this.rebuildTimer = undefined;
      if (generation === this.generation) {
        this.rebuild().catch((err) =>
          this.logger.error(`Rebuilding the devices failed: ${err.message}`),
        );
      }
    }, delay);
  }

  async rebuild({ force = false } = {}) {
    if (!this.portal) {
      return;
    }
    this.model = buildModel({
      externalIds: (type, id) => this.gladys.externalIds(type, id),
      portal: this.portal,
      store: this.store,
    });
    this.publisher.configure({
      intervalSeconds: this.config.sensorInterval,
      throttled: this.model.throttled,
    });
    for (const [featureId, entry] of this.model.features) {
      const value = featureState(entry, this.store);
      if (value) {
        this.record(featureId, value);
      }
    }
    const json = JSON.stringify(this.model.devices);
    if (force || json !== this.publishedDevices) {
      this.publishedDevices = json;
      await this.gladys
        .publishDiscoveredDevices(this.model.devices)
        .catch((err) => this.logger.warn(`Publishing the devices failed: ${err.message}`));
    }
    if (this.client?.connected && this.ready) {
      await this.setStatus(true, this.statusMessage());
      await this.publishAllTransports(true);
    }
  }

  /** Keeps the value, and sends it when the device exists in Gladys. */
  record(featureId, value) {
    this.lastValues.set(featureId, value);
    if (this.created.has(featureId)) {
      this.publisher.push(featureId, value);
    }
  }

  // --- Transport badge ---------------------------------------------------------

  transportOf(deviceId, connected) {
    return connected && [...this.model.deviceOf.values()].includes(deviceId)
      ? DEVICE_TRANSPORTS.LOCAL
      : DEVICE_TRANSPORTS.UNREACHABLE;
  }

  async publishTransport(deviceId, transport) {
    if (!this.createdDevices().has(deviceId) || this.transports.get(deviceId) === transport) {
      return;
    }
    this.transports.set(deviceId, transport);
    await this.gladys.publishTransports([{ external_id: deviceId, transport }]);
  }

  async publishAllTransports(connected) {
    const entries = [];
    for (const deviceId of this.createdDevices()) {
      const transport = this.transportOf(deviceId, connected);
      if (this.transports.get(deviceId) !== transport) {
        this.transports.set(deviceId, transport);
        entries.push({ external_id: deviceId, transport });
      }
    }
    for (let i = 0; i < entries.length; i += 100) {
      await this.gladys
        .publishTransports(entries.slice(i, i + 100))
        .catch((err) => this.logger.warn(`Transport badges failed: ${err.message}`));
    }
  }

  // --- Devices created by the user ---------------------------------------------

  createdDevices() {
    return new Set((this.gladys.devices ?? []).map((d) => d.external_id));
  }

  refreshCreated() {
    this.created = new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  async deviceCreated(device) {
    this.refreshCreated();
    this.transports.delete(device?.external_id);
    for (const f of device?.features ?? []) {
      const value = this.lastValues.get(f.external_id);
      if (value) {
        this.publisher.push(f.external_id, value);
      }
    }
    if (device?.external_id && this.ready) {
      await this.publishTransport(
        device.external_id,
        this.transportOf(device.external_id, Boolean(this.client?.connected)),
      ).catch(() => {});
    }
  }

  async deviceDeleted(device) {
    this.refreshCreated();
    if (device?.external_id) {
      this.transports.delete(device.external_id);
      this.publisher.forget(device.external_id);
    }
  }

  /** Gladys asks for the devices: every value again, and the list now. */
  async scan() {
    this.sendFullKeepalive();
    await this.rebuild({ force: true });
  }

  // --- Commands --------------------------------------------------------------

  async setValue(device, feature, value) {
    const client = this.client;
    if (!client?.connected || !this.portal) {
      throw new Error('the GX device is not connected');
    }
    const write = this.model.writers.get(feature.external_id);
    if (!write) {
      throw new Error(`${feature.name ?? feature.external_id} cannot be controlled`);
    }
    const target = write(value);
    await publish(
      client,
      writeTopic(this.portal, target.serviceKey, target.path),
      writePayload(target.value),
    );
    this.logger.debug(`Wrote ${target.value} to ${target.serviceKey}/${target.path}`);
    if (READ_ON_REFRESH.some((r) => r.serviceKey === target.serviceKey && r.path === target.path)) {
      // A setting: read it back, the GX device confirms the value it kept.
      await publish(client, readTopic(this.portal, target.serviceKey, target.path), '');
    }
  }

  // --- Configuration screen button -------------------------------------------

  /**
   * Connects with the saved configuration, finds the GX device, asks it for
   * every value and counts the devices it has.
   */
  testConnection() {
    const config = this.config;
    if (config.brokerError) {
      return Promise.resolve(
        config.brokerError === 'empty' ? T.notConfigured : T.badUrl(config.brokerError),
      );
    }
    if (config.portalError) {
      return Promise.resolve(T.badPortal);
    }
    return new Promise((resolve) => {
      let portal = config.portalId;
      const echo = this.randomId();
      const services = new Map();
      let probe;
      let timer;
      let done = false;
      const finish = (answer) => {
        if (done) {
          return;
        }
        done = true;
        this.timers.clearTimeout(timer);
        probe?.removeAllListeners?.();
        probe?.on?.('error', () => {});
        probe?.end(true);
        resolve(answer);
      };
      const ask = () => {
        probe.subscribe(
          [`N/${portal}/+/+/ProductId`, `N/${portal}/full_publish_completed`],
          { qos: 0 },
          () => {
            probe.publish(keepaliveTopic(portal), fullKeepalive(echo), { qos: 0, retain: false });
          },
        );
      };
      try {
        probe = this.connect({ ...config });
      } catch (err) {
        finish(T.unreachable(errorReason(err)));
        return;
      }
      timer = this.timers.setTimeout(
        () => finish(T.unreachable('timeout')),
        TIMINGS.connectTimeout + 1000,
      );
      probe.on('error', (err) => {
        const reason = errorReason(err);
        finish(isRefusal(err) ? T.refused(reason) : T.unreachable(reason));
      });
      probe.on('message', (topic, payload) => {
        const info = parseTopic(topic);
        if (!info) {
          return;
        }
        if (!portal) {
          if (isSerial(info)) {
            portal = info.portal;
            ask();
          }
          return;
        }
        if (info.portal !== portal) {
          return;
        }
        if (info.special === 'full_publish_completed') {
          const e = completionEcho(payload);
          if (e === undefined || e === echo) {
            finish(this.testSummary(portal, services));
          }
          return;
        }
        if (info.path === 'ProductId' && !parsePayload(payload).removed) {
          services.set(`${info.service}/${info.instance}`, info.service);
        }
      });
      probe.on('connect', () => {
        this.timers.clearTimeout(timer);
        timer = this.timers.setTimeout(
          () => finish(portal ? T.noAnswer(portal) : T.test.noGx),
          TIMINGS.testTimeout,
        );
        if (portal) {
          ask();
        } else {
          probe.subscribe([SERIAL_TOPIC], { qos: 0 });
        }
      });
    });
  }

  testSummary(portal, services) {
    const counts = new Map();
    const others = new Set();
    for (const type of services.values()) {
      if (SERVICES[type]) {
        counts.set(type, (counts.get(type) ?? 0) + 1);
      } else if (!INFRASTRUCTURE.has(type)) {
        others.add(type);
      }
    }
    counts.delete('system');
    const ordered = Object.keys(SERVICES)
      .filter((type) => counts.has(type))
      .map((type) => [type, counts.get(type)]);
    const labels = Object.fromEntries(Object.entries(SERVICES).map(([k, v]) => [k, v.label]));
    return T.test.ok(portal, countList(ordered, labels), [...others].sort().join(', '));
  }
}
