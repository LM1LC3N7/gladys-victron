// -----------------------------------------------------------------------------
// The services of the store -> the Gladys devices of the Discovery tab, and the
// tables the app routes with. Pure: same store, same devices.
//
// External ids are forever: device = externalIds(<service type>,
// `<portal ID>-<device instance>`), feature = `<device>:<catalog key>`. The
// device instance is how Victron itself addresses a device (MQTT, Modbus TCP,
// VRM): it only changes when the device is wired to another port of the GX.
// -----------------------------------------------------------------------------

import { SERVICES, sourceValue } from './catalog.js';

const ORDER = Object.keys(SERVICES);
const MAX_NAME = 100;

function deviceName(service, spec) {
  if (service.type === 'system') {
    return spec.name;
  }
  for (const path of ['CustomName', 'ProductName']) {
    const v = service.values.get(path);
    if (typeof v === 'string' && v.trim() !== '') {
      return v.trim().slice(0, MAX_NAME);
    }
  }
  return `${spec.name} ${service.instance}`;
}

function byTypeAndInstance(a, b) {
  return (
    ORDER.indexOf(a.type) - ORDER.indexOf(b.type) ||
    Number(a.instance) - Number(b.instance) ||
    a.instance.localeCompare(b.instance)
  );
}

/**
 * @param {{ externalIds: Function, portal: string, store: VictronStore }} input
 * @returns {{ devices, features, routes, writers, throttled, deviceOf }}
 *   features: featureId -> { spec, sourceKey, serviceKey, deviceId }
 *   routes: "<service key>|<path>" -> [featureId]
 *   writers: featureId -> (value) -> { serviceKey, path, value }
 *   deviceOf: service key -> device external id
 */
export function buildModel({ externalIds, portal, store }) {
  const model = {
    devices: [],
    features: new Map(),
    routes: new Map(),
    writers: new Map(),
    throttled: new Set(),
    deviceOf: new Map(),
  };
  if (!portal) {
    return model;
  }
  const services = [...store.services.values()];
  const ctx = {
    hasGridMeter: services.some((s) => s.type === 'grid'),
    // /Hub: 4 = ESS.
    ess: store.get('system/0')?.values.get('Hub') === 4,
  };
  for (const service of services.sort(byTypeAndInstance)) {
    const spec = SERVICES[service.type];
    if (!spec || (service.type === 'system' && service.instance !== '0')) {
      continue;
    }
    const ids = externalIds(service.type, `${portal}-${service.instance}`);
    const features = [];
    for (const f of spec.features) {
      if (f.when && !f.when(ctx)) {
        continue;
      }
      const source = f.from ? store.get(f.from) : service;
      if (!source || !f.sources.flat().some((p) => source.seen.has(p))) {
        continue;
      }
      const featureId = ids.feature(f.key);
      const readOnly = !f.write || Boolean(f.readOnly?.(service.values));
      features.push({
        name: f.name,
        external_id: featureId,
        category: f.category,
        type: f.type,
        ...(f.unit ? { unit: f.unit } : {}),
        min: f.min,
        max: f.max,
        read_only: readOnly,
        has_feedback: true,
        keep_history: f.history !== false,
        ...(f.options ? { supported_options: f.options } : {}),
      });
      model.features.set(featureId, {
        spec: f,
        sourceKey: source.key,
        serviceKey: service.key,
        deviceId: ids.device,
      });
      for (const path of f.sources.flat()) {
        const route = `${source.key}|${path}`;
        model.routes.set(route, [...(model.routes.get(route) ?? []), featureId]);
      }
      if (f.measurement) {
        model.throttled.add(featureId);
      }
      if (!readOnly) {
        model.writers.set(featureId, (value) => ({
          serviceKey: f.write.serviceKey ?? service.key,
          path: f.write.path,
          value: f.write.encode(value),
        }));
      }
    }
    if (features.length === 0) {
      continue;
    }
    const params = [
      { name: 'VICTRON_PORTAL_ID', value: portal },
      { name: 'VICTRON_SERVICE', value: service.key },
    ];
    const product = service.values.get('ProductName');
    if (typeof product === 'string' && product.trim() !== '') {
      params.push({ name: 'VICTRON_PRODUCT', value: product.trim().slice(0, MAX_NAME) });
    }
    model.devices.push({
      name: deviceName(service, spec),
      external_id: ids.device,
      params,
      features,
    });
    model.deviceOf.set(service.key, ids.device);
  }
  return model;
}

/** The Gladys state of a feature from the values of the store, or undefined. */
export function featureState(entry, store) {
  const n = sourceValue(entry.spec, store.get(entry.sourceKey)?.values);
  return n === undefined ? undefined : entry.spec.read(n);
}
