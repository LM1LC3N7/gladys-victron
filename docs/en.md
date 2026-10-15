# Victron Energy GX

This integration brings your **Victron Energy** installation into Gladys
through its **GX device** (Cerbo GX, Ekrano GX, Venus GX, or Venus OS
on a Raspberry Pi): batteries, solar chargers, inverter/charger, meters and EV
charging station, read live on your local network. It talks to the MQTT broker
built into the GX device: nothing goes through the Internet or VRM.
Unofficial, not affiliated with Victron Energy.

> **Development version (0.1).** Developed against the official MQTT
> documentation of Victron and simulated installations, not yet tested on
> every real system. Your feedback is welcome on the GitHub repository.

## What you get

Each Victron device found on the GX becomes a Gladys device in the
**Discovery** tab, named as on the GX (custom name, else product name).

| Victron device                          | In Gladys                                                                                             |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Battery monitor (SmartShunt, BMV…)      | state of charge, charge and discharge power, voltage, current, temperature, charged/discharged energy |
| Solar charger (MPPT)                    | PV power, yield today, total production, charge state (Bulk, Absorption, Float…)                      |
| Inverter/charger (MultiPlus, Multi RS…) | AC input and output power, state, **mode** (on, off, charger only, inverter only)                     |
| Grid meter                              | grid power (positive when importing, negative when exporting), imported and exported energy           |
| AC load meter, heat pump                | power and energy                                                                                      |
| PV inverter (Fronius…)                  | PV power, total production, status                                                                    |
| EV charging station                     | charging power, energy, connector and charging state, detailed status                                 |
| System overview                         | AC consumption, grid power (without a grid meter), system state, **ESS minimum SOC**                  |

The values use the Gladys energy categories (battery storage, energy
production, grid, home output, energy sensor): they show up in the energy
dashboards like those of any other brand.

**What you can control**: the mode of the inverter/charger (unless a VE.Bus
BMS holds it), and the **minimum state of charge of the ESS** (the battery
reserve kept for a power cut), in % — for example "raise the reserve to 80 %
when a storm is announced".

## Requirements

- A GX device with **Venus OS 3.20 or later**.
- **MQTT turned on** on the GX: _Settings → Services → MQTT_ (on recent
  versions, "Local MQTT" set to on). Port 1883 (plain) or 8883 (TLS),
  depending on the network security profile of the GX.
- The GX reachable from the Gladys machine (same local network, fixed IP
  address recommended).

## Installation

1. In the configuration, type the **address of the GX device**: its IP address
   (for example `192.168.1.50`, which means `mqtt://192.168.1.50:1883`).
2. With the **"Secured"** or **"Weak"** network security profile
   (_Settings → General → Network security profile_), the GX only accepts TLS
   with its password: type `mqtts://192.168.1.50:8883`, any user name (for
   example `gladys`) and the **password of the GX**. With the "Unsecured"
   profile, leave the user name and the password empty.
3. Click **Test the connection**: the GX and its devices are listed.
4. Open the **Discovery** tab and add the devices you want.

The VRM portal ID is read automatically from the GX: type it only if several
GX devices share the same broker.

## Options

| Option                        | Default | Purpose                                                                      |
| ----------------------------- | ------- | ---------------------------------------------------------------------------- |
| VRM portal ID                 | empty   | read from the GX; only for a broker shared by several GX devices             |
| Verify the TLS certificate    | off     | the GX uses its own certificate: turn on only if you installed a trusted one |
| Minimum interval of a reading | 10 s    | the GX publishes every second: Gladys records the last value at this pace    |

States (charge state, mode, EV charging state) are never delayed. Gladys
accepts 300 states per minute per integration: the integration rounds the
values, only sends those that change, and stays under that limit.

## How it works

The GX device only publishes its values while a client keeps it awake: the
integration sends a keep-alive on `R/<portal ID>/keepalive` every 30 seconds,
and asks for every value again at each connection and each time Gladys scans
the devices. It subscribes to the topics it needs only. A device that leaves
the GX (a PV inverter at night) shows as **unreachable** on its badge, and
comes back by itself.

## Troubleshooting

- **"No GX device publishes on this broker"**: MQTT is off on the GX, or the
  address is the one of another broker.
- **"refused the connection"**: with the "Secured" profile, use `mqtts://` on
  port 8883 and the password of the GX device.
- **"does not answer"**: the GX runs a Venus OS older than 3.20, or the VRM
  portal ID typed in the configuration is wrong (leave it empty).
- **The mode cannot be changed**: a VE.Bus BMS or a Digital Multi Control holds
  the switch of the inverter/charger; the GX reports it and Gladys shows the
  mode read-only.
- **No "ESS minimum SOC"**: the system is not an ESS (Settings → ESS).

## Privacy

Everything stays on your network: the integration only talks to the GX
device. The password is stored as a secret by Gladys and never appears in the
logs.

## Disclaimer

Unofficial integration, not affiliated with Victron Energy. Victron Energy,
Cerbo GX, Venus OS and VRM are trademarks of Victron Energy B.V. Changing the
mode of an inverter/charger or the ESS reserve acts on a real power
installation: use it knowingly.
