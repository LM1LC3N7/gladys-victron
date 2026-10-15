// -----------------------------------------------------------------------------
// Keys shared with the manifest (frozen: users store them in their
// configuration) and the tuning of the integration.
// -----------------------------------------------------------------------------

/** Manifest `actions` keys. */
export const ACTIONS = {
  TEST: 'test_connection',
};

/** Sensor throttling bounds (seconds), mirrored by the manifest. */
export const SENSOR_INTERVAL = { min: 0, max: 300, default: 10 };

export const LIMITS = {
  /** Gladys accepts 300 states per minute: keep a margin for the other paths. */
  statesPerMinute: 250,
  /** Size of a notification read (bytes): a Victron value is a few bytes. */
  payloadBytes: 64 * 1024,
  /** Services kept in memory (one per D-Bus service of the GX device). */
  services: 500,
};

export const TIMINGS = {
  /**
   * The GX device publishes while it receives keep-alives: it stops 60 s after
   * the last one. Victron's own example sends one every 30 s.
   */
  keepalive: 30_000,
  /** New services and new paths arrive in bursts: wait for the burst to end. */
  rebuildDebounce: 1500,
  /** The pending states are sent at this pace. */
  flushInterval: 1000,
  /** An unchanged value is re-sent this often, so it stays recently dated in Gladys. */
  stateHeartbeat: 30 * 60_000,
  /** How long to wait for the GX device to show up on the broker before saying so. */
  gxTimeout: 10_000,
  /** How long the connection test waits for the whole system to be published. */
  testTimeout: 20_000,
  /** Broker connection timeout. */
  connectTimeout: 10_000,
  /** Delay between two reconnection attempts. */
  reconnectPeriod: 5000,
};
