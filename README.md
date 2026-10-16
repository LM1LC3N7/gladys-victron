# gladys-victron

[Gladys Assistant](https://gladysassistant.com) external integration for
**Victron Energy GX devices** (Cerbo GX, Ekrano GX, Venus GX, Venus OS on
a Raspberry Pi): battery monitors, solar chargers, PV inverters,
inverter/chargers, grid and AC load meters, EV charging stations, read and
controlled through the **local MQTT broker of the GX device**. No cloud, no
VRM. Unofficial, not affiliated with Victron Energy.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> **In the Gladys store.** Install it from **Integrations**, or with **Install
> from GitHub** and `https://github.com/LM1LC3N7/gladys-victron`. First version,
> tested against Victron's MQTT documentation and simulated installations, not
> yet on a real GX device. Feedback and bug reports are welcome in the
> [GitHub issues](https://github.com/LM1LC3N7/gladys-victron/issues).

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (VictronApp) ⇄ src/mqtt.js ⇄ FlashMQ on the GX
                                   ├─ src/topics.js     N/ R/ W/ topics, payloads, keep-alive (pure)
                                   ├─ src/catalog.js    D-Bus service + path -> Gladys feature (pure)
                                   ├─ src/store.js      last value of every subscribed path (pure)
                                   ├─ src/devices.js    store -> Gladys devices + routing tables (pure)
                                   └─ src/publisher.js  states within 300/min, measurement throttling
```

- **The GX device** runs FlashMQ with Victron's
  [dbus-flashmq](https://github.com/victronenergy/dbus-flashmq) plugin (Venus
  OS 3.20 and later): every D-Bus value is published on
  `N/<portal ID>/<service>/<instance>/<path>` as `{"value": …}`, but only while
  a client sends keep-alives on `R/<portal ID>/keepalive`.
- **Portal ID**: read from `N/+/system/0/Serial`, the only retained topic (or
  typed in the configuration when several GX devices share a broker).
- **Keep-alive**: a full one at each connection and each Discovery scan (with
  a `full-publish-completed-echo`, so our `full_publish_completed` is told from
  another client's), then `suppress-republish` every 30 s (the GX stops 60 s
  after the last one). Services the full publish does not mention are gone.
- **Subscriptions**: only the paths of the catalog (`N/<portal>/battery/+/Soc`…)
  and the generic `ProductId` / `ProductName` / `CustomName`: a GX publishes
  thousands of values a minute.
- **Devices**: one per D-Bus service of a supported type (`battery`,
  `solarcharger`, `vebus`, `multi`, `grid`, `acload`, `heatpump`,
  `pvinverter`, `evcharger`, plus the `system` overview). A feature exists once
  one of its paths carried a number. External ids:
  `ext:<selector>:<service>:<portal>-<instance>:<key>`.
- **States**: rounded, sent only for the devices the user created,
  deduplicated (`publishChangedStates`), budgeted at 250/min, measurements
  throttled to the configured interval.
- **Writes**: `W/<portal>/vebus/<n>/Mode` (inverter/charger mode) and
  `W/<portal>/settings/0/Settings/CGwacs/BatteryLife/MinimumSocLimit` (ESS
  minimum SOC, read back with `R/` since settings are only published on read).
- **Transport badge**: local while the service is on the GX, unreachable when
  it leaves (a PV inverter at night) or when the broker is lost.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/fixtures/venus.js` holds the notifications of a Cerbo GX ESS
installation, shaped like dbus-flashmq publishes them.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic lists the repository in the Gladys store.

## License

Apache-2.0. Victron Energy, Cerbo GX, Venus OS and VRM are trademarks of
Victron Energy B.V.; this project is not affiliated with Victron Energy.
