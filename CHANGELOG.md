# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.2] - 2026-10-28

### Fixed

- Plain string labels for the select options of the inverter/charger mode, so
  Discovery lists the devices (the Gladys core refused the whole publication
  because of `{ en, fr }` labels).

### Changed

- README: the store install note replaces the work-in-progress notice, and the
  Releasing section no longer says the store topic is still to be added.

## [0.1.1] - 2026-10-15

### Added

- Connection to the MQTT broker of a Victron Energy GX device (Venus OS 3.20
  or later, dbus-flashmq): mqtt or mqtts, password of the "Secured" network
  security profile, self-signed certificate accepted by default.
- The VRM portal ID read automatically from the retained
  `N/<portal ID>/system/0/Serial`, or typed in the configuration.
- The keep-alive: a full one at each connection and each scan (echoed, so
  another client's full publish is told apart), then `suppress-republish`
  every 30 s.
- Devices for the battery monitors, solar chargers, VE.Bus and Multi RS
  inverter/chargers, grid meters, AC load and heat pump meters, PV inverters,
  EV charging stations and the system overview, in the Gladys energy
  categories (battery storage, energy production, grid, home output, energy
  sensor, charging station).
- Writable inverter/charger mode (on, off, charger only, inverter only) and
  ESS minimum state of charge.
- The transport badge: unreachable when a device leaves the GX (a PV inverter
  at night) or the broker is lost.
- "Test the connection" button: the GX device and its devices, counted.
- Measurements rounded and throttled to a configurable interval, all states
  within the Gladys rate limit.

[Unreleased]: https://github.com/LM1LC3N7/gladys-victron/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/LM1LC3N7/gladys-victron/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LM1LC3N7/gladys-victron/releases/tag/v0.1.1
