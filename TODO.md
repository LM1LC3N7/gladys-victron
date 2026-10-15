# TODO — Victron Energy GX v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`,
  `npm audit`, then update README, `docs/en.md`, `docs/fr.md`, `CHANGELOG.md`
  and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only (before, the store would list an empty integration).

## Status

- [x] **Milestone 1 — core** (2026-10-15): connection to the GX broker, portal
      ID from the retained serial, keep-alive (full + `suppress-republish`),
      selective subscriptions, devices for battery, solarcharger, vebus,
      multi, grid, acload, heatpump, pvinverter, evcharger and system, writes
      (mode, ESS minimum SOC), transport badge, rate limit, connection test,
      manifest, docs en/fr. Run against a Mosquitto 2 broker replaying
      Victron topics; never against a real GX yet.
- [ ] **Milestone 2 — real GX**: run on a Cerbo GX (Venus OS 3.5x / 3.6x) with
      testers; collect `mosquitto_sub -v -t 'N/#'` dumps as fixtures; check the
      points listed below.
- [ ] **Milestone 3 — more**: solar charger on/off (`/Mode` 1/4), EV charger
      start/stop, mode and current (`/StartStop`, `/Mode`, `/SetCurrent`), ESS
      mode (`/Settings/CGwacs/BatteryLife/State` 1/9/10), Multi RS ESS
      settings (`acsystem/<n>/Settings/Ess/MinimumSocLimit`), inverters
      (`inverter` service, `/Mode` 2/4/5), gensets, tanks and temperatures,
      alarms as a scene trigger, vebus `/Soc` when no battery monitor exists.
- [ ] **Milestone 4 — first release**: cover image, Docker image build check,
      `npx github:GladysAssistant/integration-store .`, Release workflow,
      topic, GHCR package public.

## To check on a real GX

- `History/Daily/0/Yield` of a VE.Can MPPT (only VE.Direct ones are
  documented) and the day it resets on.
- `/Ac/Out/P` on vebus (a total is assumed, the phases are summed otherwise).
- `system/0/Ac/Consumption/Total/Power` (named in the dbus-flashmq README
  only; the phases are summed otherwise).
- Writes accepted on `vebus/<n>/Mode` and `settings/0/.../MinimumSocLimit`
  with the "Secured" profile, and the settings change notification.
- Multi RS: `multi/<n>/Mode` vs `acsystem/<n>/Mode`.
- Anonymous login on the "Unsecured" profile with mqtt.js.

## Forum

No dedicated topic for this integration. Once the 10 integrations claimed on
2026-10-15 are published, a single recap message in the general thread
(/t/10385) lists each of them with its version and capabilities.

## Decisions

- **Local MQTT only** (FlashMQ on the GX). No VRM cloud broker: it needs a
  token and the Internet, and Gladys is local-first.
- **One device per D-Bus service**, id from the portal ID and the device
  instance: how Victron addresses devices (MQTT, Modbus, VRM). The `system`
  service is an extra "Victron system" device (consumption, state, ESS).
- **Grid**: a grid meter publishes `grid-sensor/power` (signed, import > 0, as
  Victron reports it) and its two indexes. The system grid power is only
  offered when there is no grid meter, so the same exchange is never counted
  twice.
- **Battery power** is signed on the D-Bus: split into `charge-power` and
  `discharge-power` (both >= 0, the only battery-storage types).
- **Inverter/charger**: AC input power in `energy-sensor/power` (signed: the
  AC input is not always the grid), AC output in `home-output-sensor/power`.
- **Yield today** goes to `energy-production-sensor/daily-production` (the
  running total of the day, as on the GX screen); the production **index**
  (`Yield/System`, never reset) feeds the Gladys energy views.
- **Mode** is a `text`/`select` (a vendor list, string values `on`, `off`,
  `charger-only`, `inverter-only`), read-only when `/ModeIsAdjustable` is 0.
- **ESS minimum SOC** is `unknown`/`unknown` in %: Gladys has no type for a
  battery reserve. Only offered when `/Hub` is 4 (ESS). Read with `R/` after
  each full publish and after each write (settings are published on read).
- **States as text** (charge state, system state, EV status) use Victron's
  English words, as on the GX screen.
- **Services gone**: an empty `ProductId` (the device left the D-Bus), or
  absent from our own echoed full publish (missed while disconnected).
- **TLS certificate verification off by default**: the GX serves its own
  certificate.
