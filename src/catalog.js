// -----------------------------------------------------------------------------
// The Victron services the integration turns into Gladys devices, and how each
// D-Bus path maps to a Gladys feature. Pure data and pure functions.
//
// Paths and units: https://github.com/victronenergy/venus/wiki/dbus (SI units,
// energy in kWh, temperature in °C). Category conventions: the comments of
// DEVICE_FEATURE_TYPES in the SDK (device-constants.js):
//   - battery-storage: level, charge/discharge power (both >= 0), indexes;
//   - grid-sensor: exchange with the public grid, `power` signed (import > 0)
//     when the device natively reports a single value, as Victron does;
//   - home-output-sensor: the power the device itself delivers (>= 0);
//   - energy-sensor: consumption, voltage, current, consumption index;
//   - energy-production-sensor: production power (>= 0) and index.
//
// A feature reads `sources`: alternatives tried in order, each one a list of
// paths SUMMED (a total, else the sum of the phases). It exists on a device as
// soon as one of its paths carried a number. Feature keys are part of the
// external ids: never rename one.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';

const phases = (pattern) => [1, 2, 3].map((n) => pattern.replace('Lx', `L${n}`));

const PRECISION = {
  [U.WATT]: 0,
  [U.KILOWATT_HOUR]: 2,
  [U.VOLT]: 2,
  [U.AMPERE]: 1,
  [U.PERCENT]: 1,
  [U.CELSIUS]: 1,
};

const RANGE = {
  [U.WATT]: [-1_000_000, 1_000_000],
  [U.KILOWATT_HOUR]: [0, 100_000_000],
  [U.VOLT]: [0, 1000],
  [U.AMPERE]: [-10_000, 10_000],
  [U.PERCENT]: [0, 100],
  [U.CELSIUS]: [-50, 150],
};

const round = (n, digits) => {
  const factor = 10 ** digits;
  const r = Math.round(n * factor) / factor;
  return Object.is(r, -0) ? 0 : r;
};

/** A measurement: throttled to the sensor interval, kept in the history. */
function measure(key, name, category, type, unit, sources, extra = {}) {
  const [min, max] = RANGE[unit];
  const digits = PRECISION[unit];
  return {
    key,
    name,
    category,
    type,
    unit,
    min,
    max,
    sources,
    measurement: true,
    read: (n) => ({ state: round(n, digits) }),
    ...extra,
  };
}

/** Power that cannot be negative in Gladys (production, delivered power). */
const positive = (unit) => (n) => ({ state: round(Math.max(n, 0), PRECISION[unit]) });

/** A state code shown as text (Victron's own words, as on the GX screen). */
function stateText(key, name, sources, labels) {
  return {
    key,
    name,
    category: C.TEXT,
    type: T.TEXT.TEXT,
    min: 0,
    max: 0,
    sources,
    history: false,
    read: (n) => ({ text: labels[n] ?? `Unknown (${n})` }),
  };
}

// --- State codes ----------------------------------------------------------------

export const VEBUS_STATES = {
  0: 'Off',
  1: 'Low power',
  2: 'Fault',
  3: 'Bulk',
  4: 'Absorption',
  5: 'Float',
  6: 'Storage',
  7: 'Equalize',
  8: 'Passthru',
  9: 'Inverting',
  10: 'Power assist',
  11: 'Power supply',
  244: 'Sustain',
  252: 'External control',
};

export const MULTI_STATES = {
  0: 'Off',
  2: 'Fault',
  3: 'Bulk',
  4: 'Absorption',
  5: 'Float',
  6: 'Storage',
  7: 'Equalize',
  8: 'Passthru',
  9: 'Inverting',
  245: 'Wake-up',
  252: 'External control',
};

export const CHARGER_STATES = {
  0: 'Off',
  2: 'Fault',
  3: 'Bulk',
  4: 'Absorption',
  5: 'Float',
  6: 'Storage',
  7: 'Equalize',
  252: 'External control',
};

export const SYSTEM_STATES = {
  0: 'Off',
  1: 'Low power',
  2: 'VE.Bus fault',
  3: 'Bulk',
  4: 'Absorption',
  5: 'Float',
  6: 'Storage',
  7: 'Equalize',
  8: 'Passthru',
  9: 'Inverting',
  10: 'Assisting',
  244: 'Battery sustain',
  252: 'External control',
  256: 'Discharging',
  257: 'Sustain',
  258: 'Recharge',
  259: 'Scheduled recharge',
};

export const PVINVERTER_STATES = {
  0: 'Startup',
  1: 'Startup',
  2: 'Startup',
  3: 'Startup',
  4: 'Startup',
  5: 'Startup',
  6: 'Startup',
  7: 'Running',
  8: 'Standby',
  9: 'Boot loading',
  10: 'Error',
  99: 'Not supported',
};

export const EVCHARGER_STATES = {
  0: 'Disconnected',
  1: 'Connected',
  2: 'Charging',
  3: 'Charged',
  4: 'Waiting for sun',
  5: 'Waiting for RFID',
  6: 'Waiting for start',
  7: 'Low SOC',
  8: 'Ground test error',
  9: 'Welded contacts error',
  10: 'CP input test error',
  11: 'Residual current detected',
  12: 'Undervoltage detected',
  13: 'Overvoltage detected',
  14: 'Overheating detected',
  21: 'Starting to charge',
  22: 'Switching to 3-phase',
  23: 'Switching to 1-phase',
  24: 'Stopping charging',
};

/**
 * EV charger /Status -> the generic charging station enums of Gladys core
 * (CHARGING_STATION_CONNECTOR_STATUS: 0 available, 1 occupied, 4 faulted;
 * CHARGING_STATION_CHARGING_STATE: 0 charging, 1 EV connected, 3 paused by
 * the charger, 4 idle). The charging state only exists while a vehicle is
 * plugged in.
 */
const EV_CONNECTOR = { AVAILABLE: 0, OCCUPIED: 1, FAULTED: 4 };
const EV_CHARGING = { CHARGING: 0, EV_CONNECTED: 1, PAUSED_BY_CHARGER: 3, IDLE: 4 };

export function evChargerStatus(code) {
  if (code === 0) {
    return { connector: EV_CONNECTOR.AVAILABLE };
  }
  if (code >= 8 && code <= 14) {
    return { connector: EV_CONNECTOR.FAULTED };
  }
  const charging = {
    1: EV_CHARGING.EV_CONNECTED,
    2: EV_CHARGING.CHARGING,
    3: EV_CHARGING.IDLE,
    4: EV_CHARGING.PAUSED_BY_CHARGER,
    5: EV_CHARGING.PAUSED_BY_CHARGER,
    6: EV_CHARGING.PAUSED_BY_CHARGER,
    7: EV_CHARGING.PAUSED_BY_CHARGER,
    21: EV_CHARGING.EV_CONNECTED,
    22: EV_CHARGING.CHARGING,
    23: EV_CHARGING.CHARGING,
    24: EV_CHARGING.IDLE,
  }[code];
  return charging === undefined ? {} : { connector: EV_CONNECTOR.OCCUPIED, charging };
}

// --- Inverter/charger mode -----------------------------------------------------

/**
 * The switch of the inverter/charger (/Mode). Values are frozen: scenes store them.
 * The labels are plain strings: the Gladys core refuses a publication whose option
 * label is anything else.
 */
export const MODES = [
  { value: 'on', code: 3, label: 'On' },
  { value: 'off', code: 4, label: 'Off' },
  { value: 'charger-only', code: 1, label: 'Charger only' },
  { value: 'inverter-only', code: 2, label: 'Inverter only' },
];

const modeFeature = {
  key: 'mode',
  name: 'Mode',
  category: C.TEXT,
  type: T.TEXT.SELECT,
  min: 0,
  max: 0,
  sources: [['Mode']],
  history: false,
  options: MODES.map((m, i) => ({ value: m.value, label: m.label, sort_order: i + 1 })),
  read: (n) => {
    const mode = MODES.find((m) => m.code === n);
    return mode ? { text: mode.value } : undefined;
  },
  // A VE.Bus BMS or a DMC takes the switch: the GX says so.
  readOnly: (values) => values.get('ModeIsAdjustable') === 0,
  write: {
    path: 'Mode',
    encode: (value) => {
      const mode = MODES.find((m) => m.value === String(value));
      if (!mode) {
        throw new Error(`unknown mode "${value}" (${MODES.map((m) => m.value).join(', ')})`);
      }
      return mode.code;
    },
  },
};

// --- ESS -----------------------------------------------------------------------

export const ESS_MIN_SOC = {
  serviceKey: 'settings/0',
  path: 'Settings/CGwacs/BatteryLife/MinimumSocLimit',
};

const essMinSocFeature = {
  key: 'ess_min_soc',
  name: 'ESS minimum SOC',
  // Gladys has no type for a battery reserve: a writable number, in %.
  category: C.UNKNOWN,
  type: T.UNKNOWN.UNKNOWN,
  unit: U.PERCENT,
  min: 0,
  max: 100,
  from: ESS_MIN_SOC.serviceKey,
  sources: [[ESS_MIN_SOC.path]],
  read: (n) => ({ state: round(n, 0) }),
  when: (ctx) => ctx.ess,
  write: {
    serviceKey: ESS_MIN_SOC.serviceKey,
    path: ESS_MIN_SOC.path,
    encode: (value) => {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        throw new Error(`the minimum SOC must be between 0 and 100 %, not ${value}`);
      }
      return Math.round(n);
    },
  },
};

// --- The services ----------------------------------------------------------------

const acPower = (total, phasePattern) => [[total], phases(phasePattern)];

const productionIndex = (path) =>
  measure(
    'yield_total',
    'Total production',
    C.ENERGY_PRODUCTION_SENSOR,
    T.ENERGY_PRODUCTION_SENSOR.INDEX,
    U.KILOWATT_HOUR,
    [[path]],
  );

/**
 * One entry per D-Bus service type. `name`: the device name when the GX gives
 * none; `label`: how the connection test counts them.
 */
export const SERVICES = {
  system: {
    name: 'Victron system',
    label: { en: ['system', 'systems'], fr: ['système', 'systèmes'] },
    features: [
      measure(
        'consumption',
        'AC consumption',
        C.ENERGY_SENSOR,
        T.ENERGY_SENSOR.POWER,
        U.WATT,
        [['Ac/Consumption/Total/Power'], phases('Ac/Consumption/Lx/Power')],
        { min: 0, read: positive(U.WATT) },
      ),
      // The grid as the GX sees it, for the systems without a grid meter (the
      // AC input of the inverter/charger): a grid meter is a device of its own.
      measure(
        'grid_power',
        'Grid power',
        C.GRID_SENSOR,
        T.GRID_SENSOR.POWER,
        U.WATT,
        [phases('Ac/Grid/Lx/Power')],
        { when: (ctx) => !ctx.hasGridMeter },
      ),
      stateText('state', 'System state', [['SystemState/State']], SYSTEM_STATES),
      essMinSocFeature,
    ],
  },

  battery: {
    name: 'Battery',
    label: { en: ['battery monitor', 'battery monitors'], fr: ['batterie', 'batteries'] },
    features: [
      measure(
        'soc',
        'State of charge',
        C.BATTERY_STORAGE,
        T.BATTERY_STORAGE.BATTERY_LEVEL,
        U.PERCENT,
        [['Soc']],
      ),
      // /Dc/0/Power is signed (positive when charging): two features >= 0.
      measure(
        'charge_power',
        'Charge power',
        C.BATTERY_STORAGE,
        T.BATTERY_STORAGE.CHARGE_POWER,
        U.WATT,
        [['Dc/0/Power']],
        { min: 0, read: positive(U.WATT) },
      ),
      measure(
        'discharge_power',
        'Discharge power',
        C.BATTERY_STORAGE,
        T.BATTERY_STORAGE.DISCHARGE_POWER,
        U.WATT,
        [['Dc/0/Power']],
        { min: 0, read: (n) => ({ state: round(Math.max(-n, 0), 0) }) },
      ),
      measure('voltage', 'Voltage', C.ENERGY_SENSOR, T.ENERGY_SENSOR.VOLTAGE, U.VOLT, [
        ['Dc/0/Voltage'],
      ]),
      measure('current', 'Current', C.ENERGY_SENSOR, T.ENERGY_SENSOR.CURRENT, U.AMPERE, [
        ['Dc/0/Current'],
      ]),
      measure(
        'temperature',
        'Temperature',
        C.TEMPERATURE_SENSOR,
        T.TEMPERATURE_SENSOR.PROBE,
        U.CELSIUS,
        [['Dc/0/Temperature']],
      ),
      measure(
        'charged_energy',
        'Charged energy',
        C.BATTERY_STORAGE,
        T.BATTERY_STORAGE.CHARGE_INDEX,
        U.KILOWATT_HOUR,
        [['History/ChargedEnergy']],
      ),
      measure(
        'discharged_energy',
        'Discharged energy',
        C.BATTERY_STORAGE,
        T.BATTERY_STORAGE.DISCHARGE_INDEX,
        U.KILOWATT_HOUR,
        [['History/DischargedEnergy']],
      ),
    ],
  },

  solarcharger: {
    name: 'Solar charger',
    label: {
      en: ['solar charger', 'solar chargers'],
      fr: ['chargeur solaire', 'chargeurs solaires'],
    },
    features: [
      measure(
        'pv_power',
        'PV power',
        C.ENERGY_PRODUCTION_SENSOR,
        T.ENERGY_PRODUCTION_SENSOR.POWER,
        U.WATT,
        [['Yield/Power']],
        { min: 0, read: positive(U.WATT) },
      ),
      measure(
        'yield_today',
        'Yield today',
        C.ENERGY_PRODUCTION_SENSOR,
        T.ENERGY_PRODUCTION_SENSOR.DAILY_PRODUCTION,
        U.KILOWATT_HOUR,
        [['History/Daily/0/Yield']],
      ),
      productionIndex('Yield/System'),
      stateText('state', 'Charge state', [['State']], CHARGER_STATES),
    ],
  },

  vebus: {
    name: 'Inverter/charger',
    label: {
      en: ['inverter/charger', 'inverter/chargers'],
      fr: ['onduleur/chargeur', 'onduleurs/chargeurs'],
    },
    features: [
      measure(
        'ac_in_power',
        'AC input power',
        C.ENERGY_SENSOR,
        T.ENERGY_SENSOR.POWER,
        U.WATT,
        acPower('Ac/ActiveIn/P', 'Ac/ActiveIn/Lx/P'),
      ),
      measure(
        'ac_out_power',
        'AC output power',
        C.HOME_OUTPUT_SENSOR,
        T.HOME_OUTPUT_SENSOR.POWER,
        U.WATT,
        acPower('Ac/Out/P', 'Ac/Out/Lx/P'),
        { min: 0, read: positive(U.WATT) },
      ),
      stateText('state', 'State', [['State']], VEBUS_STATES),
      modeFeature,
    ],
  },

  // Multi RS, Inverter RS Smart Solar and the other new inverter/chargers.
  multi: {
    name: 'Inverter/charger',
    label: {
      en: ['inverter/charger', 'inverter/chargers'],
      fr: ['onduleur/chargeur', 'onduleurs/chargeurs'],
    },
    features: [
      measure('ac_in_power', 'AC input power', C.ENERGY_SENSOR, T.ENERGY_SENSOR.POWER, U.WATT, [
        [...phases('Ac/In/1/Lx/P'), ...phases('Ac/In/2/Lx/P')],
      ]),
      measure(
        'ac_out_power',
        'AC output power',
        C.HOME_OUTPUT_SENSOR,
        T.HOME_OUTPUT_SENSOR.POWER,
        U.WATT,
        [phases('Ac/Out/Lx/P')],
        { min: 0, read: positive(U.WATT) },
      ),
      measure(
        'pv_power',
        'PV power',
        C.ENERGY_PRODUCTION_SENSOR,
        T.ENERGY_PRODUCTION_SENSOR.POWER,
        U.WATT,
        [['Yield/Power']],
        { min: 0, read: positive(U.WATT) },
      ),
      productionIndex('Yield/System'),
      stateText('state', 'State', [['State']], MULTI_STATES),
      modeFeature,
    ],
  },

  grid: {
    name: 'Grid meter',
    label: { en: ['grid meter', 'grid meters'], fr: ['compteur réseau', 'compteurs réseau'] },
    features: [
      measure(
        'power',
        'Grid power',
        C.GRID_SENSOR,
        T.GRID_SENSOR.POWER,
        U.WATT,
        acPower('Ac/Power', 'Ac/Lx/Power'),
      ),
      measure(
        'import_index',
        'Imported energy',
        C.GRID_SENSOR,
        T.GRID_SENSOR.INPUT_INDEX,
        U.KILOWATT_HOUR,
        [['Ac/Energy/Forward']],
      ),
      measure(
        'export_index',
        'Exported energy',
        C.GRID_SENSOR,
        T.GRID_SENSOR.OUTPUT_INDEX,
        U.KILOWATT_HOUR,
        [['Ac/Energy/Reverse']],
      ),
    ],
  },

  pvinverter: {
    name: 'PV inverter',
    label: { en: ['PV inverter', 'PV inverters'], fr: ['onduleur PV', 'onduleurs PV'] },
    features: [
      measure(
        'power',
        'PV power',
        C.ENERGY_PRODUCTION_SENSOR,
        T.ENERGY_PRODUCTION_SENSOR.POWER,
        U.WATT,
        acPower('Ac/Power', 'Ac/Lx/Power'),
        { min: 0, read: positive(U.WATT) },
      ),
      productionIndex('Ac/Energy/Forward'),
      stateText('state', 'Status', [['StatusCode']], PVINVERTER_STATES),
    ],
  },

  evcharger: {
    name: 'EV charger',
    label: { en: ['EV charger', 'EV chargers'], fr: ['borne de recharge', 'bornes de recharge'] },
    features: [
      measure(
        'power',
        'Charging power',
        C.ENERGY_SENSOR,
        T.ENERGY_SENSOR.POWER,
        U.WATT,
        acPower('Ac/Power', 'Ac/Lx/Power'),
        { min: 0, read: positive(U.WATT) },
      ),
      measure('index', 'Energy', C.ENERGY_SENSOR, T.ENERGY_SENSOR.INDEX, U.KILOWATT_HOUR, [
        ['Ac/Energy/Forward'],
      ]),
      {
        key: 'connector_status',
        name: 'Connector',
        category: C.CHARGING_STATION,
        type: T.CHARGING_STATION.CONNECTOR_STATUS,
        min: 0,
        max: 4,
        sources: [['Status']],
        read: (n) => {
          const s = evChargerStatus(n);
          return s.connector === undefined ? undefined : { state: s.connector };
        },
      },
      {
        key: 'charging_state',
        name: 'Charging state',
        category: C.CHARGING_STATION,
        type: T.CHARGING_STATION.CHARGING_STATE,
        min: 0,
        max: 5,
        sources: [['Status']],
        read: (n) => {
          const s = evChargerStatus(n);
          return s.charging === undefined ? undefined : { state: s.charging };
        },
      },
      stateText('status', 'Status', [['Status']], EVCHARGER_STATES),
    ],
  },
};

// AC loads and heat pumps measured by an energy meter: a consumption.
for (const [type, name, label] of [
  ['acload', 'AC load', { en: ['AC load', 'AC loads'], fr: ['charge AC', 'charges AC'] }],
  ['heatpump', 'Heat pump', { en: ['heat pump', 'heat pumps'], fr: ['PAC', 'PAC'] }],
]) {
  SERVICES[type] = {
    name,
    label,
    features: [
      measure(
        'power',
        'Power',
        C.ENERGY_SENSOR,
        T.ENERGY_SENSOR.POWER,
        U.WATT,
        acPower('Ac/Power', 'Ac/Lx/Power'),
      ),
      measure('index', 'Energy', C.ENERGY_SENSOR, T.ENERGY_SENSOR.INDEX, U.KILOWATT_HOUR, [
        ['Ac/Energy/Forward'],
      ]),
    ],
  };
}

/** Paths that change which features a device has (besides the features' own). */
export const GATING_PATHS = new Set([
  'system/Hub',
  'vebus/ModeIsAdjustable',
  'multi/ModeIsAdjustable',
]);

/** Paths the GX device only publishes when asked (settings): read after each full publish. */
export const READ_ON_REFRESH = [ESS_MIN_SOC];

/** Paths every service publishes, used for the names and the connection test. */
export const GENERIC_PATHS = ['ProductId', 'ProductName', 'CustomName'];

/**
 * The topics to subscribe to for a portal: the paths of the catalog only (a GX
 * device publishes thousands of values a minute), plus the generic ones.
 */
export function subscriptions(portal) {
  const topics = new Set([
    `N/${portal}/full_publish_completed`,
    ...GENERIC_PATHS.map((p) => `N/${portal}/+/+/${p}`),
    `N/${portal}/system/0/Hub`,
    `N/${portal}/vebus/+/ModeIsAdjustable`,
    `N/${portal}/multi/+/ModeIsAdjustable`,
  ]);
  for (const [type, spec] of Object.entries(SERVICES)) {
    const instance = type === 'system' ? '0' : '+';
    for (const f of spec.features) {
      for (const path of f.sources.flat()) {
        topics.add(
          f.from ? `N/${portal}/${f.from}/${path}` : `N/${portal}/${type}/${instance}/${path}`,
        );
      }
    }
  }
  return [...topics];
}

/** The numeric value of a feature: the first alternative carrying a number, summed. */
export function sourceValue(feature, values) {
  for (const paths of feature.sources) {
    const numbers = paths.map((p) => values?.get(p)).filter((v) => Number.isFinite(v));
    if (numbers.length > 0) {
      return numbers.reduce((a, b) => a + b, 0);
    }
  }
  return undefined;
}
