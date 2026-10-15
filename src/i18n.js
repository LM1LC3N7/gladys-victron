// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, button), in English and French.
// -----------------------------------------------------------------------------

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const MQTT_HINT = {
  en: 'turn on MQTT on the GX device (Settings → Services → MQTT)',
  fr: 'activez MQTT sur le GX (Paramètres → Services → MQTT)',
};

export const T = {
  notConfigured: {
    en: 'Type the address of your GX device in the configuration (for example 192.168.1.50).',
    fr: "Saisissez l'adresse de votre GX dans la configuration (par exemple 192.168.1.50).",
  },
  badUrl: (reason) =>
    reason === 'credentials'
      ? {
          en: 'Put the user name and the password in their own fields, not in the address.',
          fr: "Mettez l'utilisateur et le mot de passe dans leurs champs, pas dans l'adresse.",
        }
      : {
          en: 'The address is not valid: use the IP address of the GX device, mqtt://host:1883 or mqtts://host:8883.',
          fr: "L'adresse n'est pas valide : utilisez l'adresse IP du GX, mqtt://hôte:1883 ou mqtts://hôte:8883.",
        },
  badPortal: {
    en: 'The VRM portal ID is not valid: letters and digits only (Settings → VRM online portal on the GX device), or leave it empty.',
    fr: "L'identifiant du portail VRM n'est pas valide : lettres et chiffres seulement (Paramètres → Portail VRM en ligne sur le GX), ou laissez-le vide.",
  },
  connecting: {
    en: 'Connecting to the GX device…',
    fr: 'Connexion au GX…',
  },
  lost: {
    en: 'Connection to the GX device lost, reconnecting…',
    fr: 'Connexion au GX perdue, reconnexion…',
  },
  waiting: {
    en: 'Connected to the broker, waiting for the GX device…',
    fr: 'Connecté au broker, en attente du GX…',
  },
  noGx: {
    en: `Connected, but no GX device publishes on this broker: ${MQTT_HINT.en}, and check the address.`,
    fr: `Connecté, mais aucun GX ne publie sur ce broker : ${MQTT_HINT.fr}, et vérifiez l'adresse.`,
  },
  noAnswer: (portal) => ({
    en: `Connected, but the GX device ${portal} does not answer: check the VRM portal ID, and that the GX runs Venus OS 3.20 or later.`,
    fr: `Connecté, mais le GX ${portal} ne répond pas : vérifiez l'identifiant du portail VRM, et que le GX est en Venus OS 3.20 ou plus récent.`,
  }),
  connected: (devices, portal) => ({
    en: `Connected to the GX device ${portal}: ${plural(devices, 'device', 'devices')}. Open Discovery to add them.`,
    fr: `Connecté au GX ${portal} : ${plural(devices, 'appareil', 'appareils')}. Ouvrez Découverte pour les ajouter.`,
  }),
  noDevice: (portal) => ({
    en: `Connected to the GX device ${portal}, but no supported device yet (battery, solar charger, inverter/charger, meter, EV charger).`,
    fr: `Connecté au GX ${portal}, mais aucun appareil pris en charge pour l'instant (batterie, chargeur solaire, onduleur/chargeur, compteur, borne).`,
  }),
  unreachable: (message) => ({
    en: `The GX device is unreachable: ${message}. Retrying every few seconds; ${MQTT_HINT.en}.`,
    fr: `Le GX est injoignable : ${message}. Nouvel essai toutes les quelques secondes ; ${MQTT_HINT.fr}.`,
  }),
  refused: (message) => ({
    en: `The GX device refused the connection: ${message}. With the "Secured" network security profile, use mqtts:// (port 8883) and the password of the GX device.`,
    fr: `Le GX a refusé la connexion : ${message}. Avec le profil de sécurité réseau « Sécurisé », utilisez mqtts:// (port 8883) et le mot de passe du GX.`,
  }),
  notConnected: {
    en: 'The GX device is not connected yet: check the configuration and the status above.',
    fr: "Le GX n'est pas encore connecté : vérifiez la configuration et l'état ci-dessus.",
  },
  test: {
    ok: (portal, found, others) => ({
      en: `Connection OK: GX device ${portal}${found.en ? `, ${found.en}` : ', no supported device yet'}.${others ? ` Not supported yet: ${others}.` : ''}`,
      fr: `Connexion OK : GX ${portal}${found.fr ? `, ${found.fr}` : ", aucun appareil pris en charge pour l'instant"}.${others ? ` Pas encore pris en charge : ${others}.` : ''}`,
    }),
    noGx: {
      en: `Connection to the broker OK, but no GX device publishes on it: ${MQTT_HINT.en}.`,
      fr: `Connexion au broker OK, mais aucun GX ne publie dessus : ${MQTT_HINT.fr}.`,
    },
  },
};

/** "2 solar chargers, 1 battery monitor" in both languages. */
export function countList(counts, labels) {
  const parts = { en: [], fr: [] };
  for (const [type, n] of counts) {
    for (const lang of ['en', 'fr']) {
      const [one, many] = labels[type][lang];
      parts[lang].push(plural(n, one, many));
    }
  }
  return { en: parts.en.join(', '), fr: parts.fr.join(', ') };
}
