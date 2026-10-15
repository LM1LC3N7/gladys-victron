# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15). It
connects to the MQTT broker of a Victron Energy GX device (FlashMQ +
dbus-flashmq, Venus OS 3.20+), keeps it publishing with keep-alives, and turns
its D-Bus services into Gladys devices, states and two commands (inverter/charger
mode, ESS minimum SOC). Unofficial, not affiliated with Victron Energy.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` and `audit` before every commit.

## Architecture

```
index.js            SDK bootstrap only
src/handlers.js     every SDK handler -> the app (shared with the tests)
src/app.js          VictronApp: broker lifecycle, portal ID, keep-alive,
                    message routing, writes, transports, connection test
src/topics.js       N/ R/ W/ topics, payloads, keep-alive payloads (pure)
src/catalog.js      D-Bus service + path -> Gladys feature, subscriptions (pure)
src/store.js        last value of every subscribed path, per service (pure)
src/devices.js      store -> Gladys devices + routing tables (pure)
src/publisher.js    states within the Gladys rate limit
src/mqtt.js         the only network access (mqtt.js)
src/config.js       config_schema normalized
src/constants.js    manifest keys, limits, timings
src/i18n.js         runtime texts (en/fr)
test/fixtures/      notifications of a Cerbo GX ESS installation
test/helpers/       a fake mqtt.js client; Gladys is the SDK's fake
```

## Rules

- **External ids are forever**: the device id is built by
  `gladys.externalIds()` from the service type, the portal ID and the device
  instance (`ext:<selector>:battery:c0619ab1c2d3-279`), the feature id is
  `<device>:<catalog key>`. Never rename a catalog key, never change how ids
  are built.
- Manifest keys (`test_connection`, config keys) and the mode option values
  (`on`, `off`, `charger-only`, `inverter-only`) are frozen: users store them.
- Topic names and units come from Victron's documentation only:
  https://github.com/victronenergy/dbus-flashmq and
  https://github.com/victronenergy/venus/wiki/dbus. Never guess a path.
- Category conventions: the comments of `DEVICE_FEATURE_TYPES` in the SDK
  (`device-constants.js`). Map whichever form the device natively reports
  (Victron grid power is signed: `grid-sensor/power`), never both.
- Never publish retained messages, never write a path that is not in the
  catalog (a GX drives a real power installation).
- Container limits: 256 MB RAM, 0.5 CPU, read-only rootfs, only `/data`
  writable, bridge network (unicast to the GX is fine, no mDNS without
  `scanNetwork`).
- Gladys rate limits: 300 states/min, 300 scene events/min.
- Never log or put in a status message a password or a secret config value.
- Code, comments, README in English; `docs/en.md` and `docs/fr.md` kept in sync.
