// -----------------------------------------------------------------------------
// What a Cerbo GX publishes on its MQTT broker (dbus-flashmq) for a
// single-phase ESS installation: a SmartShunt, two MPPTs, a MultiPlus-II, a
// grid meter, an AC load meter, a Fronius PV inverter, an EV charging station
// and a tank sensor (not supported yet). Topic and payload shapes follow
// https://github.com/victronenergy/dbus-flashmq, paths and units the Venus OS
// D-Bus documentation. Values are float32 as on a real GX (52.31000137329102).
// -----------------------------------------------------------------------------

export const PORTAL = 'c0619ab1c2d3';

/** One notification: `N/<portal>/<service>/<instance>/<path>` with `{"value": …}`. */
export const n = (service, path, value, portal = PORTAL) => ({
  topic: `N/${portal}/${service}/${path}`,
  payload: JSON.stringify({ value }),
});

/** The device left the D-Bus: an empty payload. */
export const gone = (service, path, portal = PORTAL) => ({
  topic: `N/${portal}/${service}/${path}`,
  payload: '',
});

/** Retained by the broker: the only message before any keep-alive. */
export const SERIAL = n('system/0', 'Serial', PORTAL);

export const completion = (echo, portal = PORTAL) => ({
  topic: `N/${portal}/full_publish_completed`,
  payload: JSON.stringify(
    echo === undefined
      ? { value: 1760000000 }
      : { 'full-publish-completed-echo': echo, value: 1760000000 },
  ),
});

const product = (service, id, name, custom = '') => [
  n(service, 'ProductId', id),
  n(service, 'ProductName', name),
  n(service, 'CustomName', custom),
];

export const SYSTEM = [
  n('system/0', 'Hub', 4),
  n('system/0', 'Ac/Consumption/L1/Power', 512.4000244140625),
  n('system/0', 'Ac/Consumption/L2/Power', null),
  n('system/0', 'Ac/Consumption/L3/Power', null),
  n('system/0', 'Ac/Grid/L1/Power', -350.6000061035156),
  n('system/0', 'Ac/Grid/L2/Power', null),
  n('system/0', 'Ac/Grid/L3/Power', null),
  n('system/0', 'SystemState/State', 256),
];

export const BATTERY = [
  ...product('battery/279', 41865, 'SmartShunt 500A/50mV'),
  n('battery/279', 'Soc', 76.5),
  n('battery/279', 'Dc/0/Voltage', 52.31000137329102),
  n('battery/279', 'Dc/0/Current', -8.399999618530273),
  n('battery/279', 'Dc/0/Power', -439.20001220703125),
  n('battery/279', 'Dc/0/Temperature', null),
  n('battery/279', 'History/ChargedEnergy', 1234.5),
  n('battery/279', 'History/DischargedEnergy', 1100.25),
];

export const SOLAR = [
  ...product('solarcharger/278', 41057, 'SmartSolar Charger MPPT 150/35', 'MPPT toit'),
  n('solarcharger/278', 'Yield/Power', 1520.300048828125),
  n('solarcharger/278', 'History/Daily/0/Yield', 4.820000171661377),
  n('solarcharger/278', 'Yield/System', 2345.669921875),
  n('solarcharger/278', 'State', 3),
  ...product('solarcharger/289', 41055, 'SmartSolar Charger MPPT 100/20'),
  n('solarcharger/289', 'Yield/Power', 0),
  n('solarcharger/289', 'History/Daily/0/Yield', 0.4000000059604645),
  n('solarcharger/289', 'Yield/System', 120.0999984741211),
  n('solarcharger/289', 'State', 0),
];

export const VEBUS = [
  ...product('vebus/276', 9763, 'MultiPlus-II 48/5000/70-50'),
  // A total for the input, only phases for the output: both forms exist.
  n('vebus/276', 'Ac/ActiveIn/P', -120),
  n('vebus/276', 'Ac/ActiveIn/L1/P', -120),
  n('vebus/276', 'Ac/Out/L1/P', 645),
  n('vebus/276', 'Ac/Out/L2/P', null),
  n('vebus/276', 'Ac/Out/L3/P', null),
  n('vebus/276', 'State', 9),
  n('vebus/276', 'Mode', 3),
  n('vebus/276', 'ModeIsAdjustable', 1),
];

export const METERS = [
  ...product('grid/30', 45069, 'Energy Meter ET112'),
  n('grid/30', 'Ac/Power', -350.6000061035156),
  n('grid/30', 'Ac/L1/Power', -350.6000061035156),
  n('grid/30', 'Ac/Energy/Forward', 8765.4296875),
  n('grid/30', 'Ac/Energy/Reverse', 1234.56005859375),
  ...product('acload/31', 45069, 'Energy Meter ET112', 'Pompe piscine'),
  n('acload/31', 'Ac/Power', 812),
  n('acload/31', 'Ac/Energy/Forward', 431.20001220703125),
];

export const PV_INVERTER = [
  ...product('pvinverter/20', 41284, 'Fronius Primo 3.0-1'),
  n('pvinverter/20', 'Ac/Power', 1890.5),
  n('pvinverter/20', 'Ac/Energy/Forward', 15432.099609375),
  n('pvinverter/20', 'StatusCode', 7),
];

export const EV_CHARGER = [
  ...product('evcharger/40', 49239, 'EV Charging Station', 'Borne garage'),
  n('evcharger/40', 'Ac/Power', 7360),
  n('evcharger/40', 'Ac/Energy/Forward', 3210.89990234375),
  n('evcharger/40', 'Status', 2),
];

export const TANK = [...product('tank/22', 41312, 'Tank sensor', 'Eau douce')];

/** Everything the GX publishes after a full keep-alive (before the completion). */
export const ALL = [
  ...SYSTEM,
  ...BATTERY,
  ...SOLAR,
  ...VEBUS,
  ...METERS,
  ...PV_INVERTER,
  ...EV_CHARGER,
  ...TANK,
];

/** The answer to the read request of the ESS minimum SOC (a setting: min and max too). */
export const MIN_SOC = {
  topic: `N/${PORTAL}/settings/0/Settings/CGwacs/BatteryLife/MinimumSocLimit`,
  payload: JSON.stringify({ max: 100, min: 0, value: 20 }),
};
