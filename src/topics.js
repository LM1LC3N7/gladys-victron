// -----------------------------------------------------------------------------
// The MQTT dialect of the GX device (dbus-flashmq, Venus OS 3.20 and later),
// pure functions only.
//
//   N/<portal ID>/<service type>/<device instance>/<D-Bus path>  {"value": …}
//   R/<portal ID>/keepalive        wakes the publishing up (60 s timeout)
//   R/<portal ID>/<service>/<instance>/<path>   reads one value (settings)
//   W/<portal ID>/<service>/<instance>/<path>   {"value": …} writes one value
//
// An empty payload means the device left the D-Bus, `{"value": null}` an
// invalid value. Nothing is retained, except N/<portal ID>/system/0/Serial:
// the portal ID can be read from it before any keep-alive.
// https://github.com/victronenergy/dbus-flashmq
// -----------------------------------------------------------------------------

/** The only retained topic: its second level is the portal ID. */
export const SERIAL_TOPIC = 'N/+/system/0/Serial';

/**
 * A notification topic, split.
 * @returns {{ portal, service, instance, path } | { portal, special } | null}
 */
export function parseTopic(topic) {
  const parts = String(topic).split('/');
  if (parts[0] !== 'N' || parts.length < 3 || parts[1] === '') {
    return null;
  }
  const portal = parts[1];
  if (parts.length === 3) {
    // full_publish_completed, heartbeat...
    return { portal, special: parts[2] };
  }
  if (parts.length < 5 || parts[2] === '' || parts[3] === '' || parts.slice(4).includes('')) {
    return null;
  }
  return { portal, service: parts[2], instance: parts[3], path: parts.slice(4).join('/') };
}

/**
 * A notification payload.
 * @returns {{ removed: true } | { value: unknown } | { error: string }}
 */
export function parsePayload(payload) {
  const text = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload ?? '');
  if (text.trim() === '') {
    return { removed: true };
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { error: 'not JSON' };
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json) || !('value' in json)) {
    return { error: 'no "value" key' };
  }
  return { value: json.value };
}

export const keepaliveTopic = (portal) => `R/${portal}/keepalive`;

/**
 * The keep-alive asking for every value again. The echo (Venus OS 3.50 and
 * later) tells our own `full_publish_completed` from another client's.
 */
export const fullKeepalive = (echo) =>
  JSON.stringify({ 'keepalive-options': [{ 'full-publish-completed-echo': echo }] });

/** The periodic keep-alive: the GX device keeps publishing the changes only. */
export const QUIET_KEEPALIVE = JSON.stringify({ 'keepalive-options': ['suppress-republish'] });

export const readTopic = (portal, serviceKey, path) => `R/${portal}/${serviceKey}/${path}`;
export const writeTopic = (portal, serviceKey, path) => `W/${portal}/${serviceKey}/${path}`;
export const writePayload = (value) => JSON.stringify({ value });

/** The echo of a `full_publish_completed` payload, if any. */
export function completionEcho(payload) {
  try {
    const json = JSON.parse(Buffer.isBuffer(payload) ? payload.toString('utf8') : payload);
    return typeof json?.['full-publish-completed-echo'] === 'string'
      ? json['full-publish-completed-echo']
      : undefined;
  } catch {
    return undefined;
  }
}
