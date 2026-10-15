// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
// -----------------------------------------------------------------------------

import { SENSOR_INTERVAL } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  broker_url: '',
  username: '',
  password: '',
  portal_id: '',
  // The GX device serves TLS with a certificate no public authority signed.
  verify_certificate: false,
  sensor_interval: SENSOR_INTERVAL.default,
};

const SCHEMES = ['mqtt:', 'mqtts:', 'ws:', 'wss:', 'tcp:', 'ssl:'];

/**
 * The broker URL, completed: "192.168.1.10" -> "mqtt://192.168.1.10".
 * @returns {{ url: string } | { error: string }}
 */
export function parseBrokerUrl(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') {
    return { error: 'empty' };
  }
  const withScheme = /^[a-z]+:\/\//i.test(text) ? text : `mqtt://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return { error: 'invalid' };
  }
  if (!SCHEMES.includes(url.protocol) || !url.hostname) {
    return { error: 'invalid' };
  }
  if (url.username || url.password) {
    // Credentials belong to their own fields (the secret one is never shown again).
    return { error: 'credentials' };
  }
  return { url: url.toString().replace(/\/$/, '') };
}

/**
 * The VRM portal ID typed by the user: empty means "read it from the GX
 * device". It is a topic level, so no wildcard and no slash.
 * @returns {{ id: string | undefined } | { error: string }}
 */
export function parsePortalId(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') {
    return { id: undefined };
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(text)) {
    return { error: 'invalid' };
  }
  return { id: text };
}

export function normalizeConfig(raw = {}) {
  const given = Object.fromEntries(
    Object.entries(raw ?? {}).filter(([, v]) => v !== null && v !== undefined),
  );
  const c = { ...DEFAULTS, ...given };
  const broker = parseBrokerUrl(c.broker_url);
  const portal = parsePortalId(c.portal_id);
  const interval = Number(c.sensor_interval);
  return {
    brokerUrl: broker.url,
    brokerError: broker.error,
    username: String(c.username ?? '').trim(),
    password: String(c.password ?? ''),
    portalId: portal.id,
    portalError: portal.error,
    verifyCertificate: c.verify_certificate === true,
    sensorInterval: Number.isFinite(interval)
      ? Math.max(SENSOR_INTERVAL.min, Math.min(SENSOR_INTERVAL.max, Math.round(interval)))
      : SENSOR_INTERVAL.default,
  };
}
