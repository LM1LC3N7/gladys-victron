# Victron Energy GX

Cette intégration amène votre installation **Victron Energy** dans Gladys via
son **GX** (Cerbo GX, Ekrano GX, Venus GX, ou Venus OS sur un
Raspberry Pi) : batteries, chargeurs solaires, onduleur/chargeur, compteurs et
borne de recharge, lus en direct sur votre réseau local. Elle dialogue avec le
broker MQTT intégré au GX : rien ne passe par Internet ni par VRM. Non
officielle, sans lien avec Victron Energy.

> **Version de développement (0.1).** Développée à partir de la documentation
> MQTT officielle de Victron et d'installations simulées, pas encore testée sur
> toutes les installations réelles. Vos retours sont les bienvenus sur le dépôt
> GitHub.

## Ce que vous obtenez

Chaque appareil Victron trouvé sur le GX devient un appareil Gladys de l'onglet
**Découverte**, nommé comme sur le GX (nom personnalisé, sinon nom du produit).

| Appareil Victron                          | Dans Gladys                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Contrôleur de batterie (SmartShunt, BMV…) | état de charge, puissance de charge et de décharge, tension, courant, température, énergie chargée/déchargée |
| Chargeur solaire (MPPT)                   | puissance PV, production du jour, production totale, état de charge (Bulk, Absorption, Float…)               |
| Onduleur/chargeur (MultiPlus, Multi RS…)  | puissance d'entrée et de sortie AC, état, **mode** (marche, arrêt, chargeur seul, onduleur seul)             |
| Compteur réseau                           | puissance réseau (positive en soutirage, négative en injection), énergie soutirée et injectée                |
| Compteur de charge AC, pompe à chaleur    | puissance et énergie                                                                                         |
| Onduleur PV (Fronius…)                    | puissance PV, production totale, état                                                                        |
| Borne de recharge                         | puissance de charge, énergie, état du connecteur et de la charge, état détaillé                              |
| Vue d'ensemble du système                 | consommation AC, puissance réseau (sans compteur réseau), état du système, **SOC minimum de l'ESS**          |

Les valeurs utilisent les catégories énergie de Gladys (stockage batterie,
production, réseau, sortie maison, capteur d'énergie) : elles apparaissent dans
les tableaux de bord énergie comme celles de n'importe quelle autre marque.

**Ce que vous pouvez piloter** : le mode de l'onduleur/chargeur (sauf si un BMS
VE.Bus le tient), et l'**état de charge minimum de l'ESS** (la réserve de
batterie gardée pour une coupure), en % — par exemple « monter la réserve à
80 % quand un orage est annoncé ».

## Prérequis

- Un GX en **Venus OS 3.20 ou plus récent**.
- **MQTT activé** sur le GX : _Paramètres → Services → MQTT_ (sur les versions
  récentes, « MQTT local » activé). Port 1883 (en clair) ou 8883 (TLS), selon
  le profil de sécurité réseau du GX.
- Le GX joignable depuis la machine Gladys (même réseau local, adresse IP fixe
  conseillée).

## Installation

1. Dans la configuration, saisissez l'**adresse du GX** : son adresse IP (par
   exemple `192.168.1.50`, ce qui vaut `mqtt://192.168.1.50:1883`).
2. Avec le profil de sécurité réseau **« Sécurisé »** ou **« Faible »**
   (_Paramètres → Général → Profil de sécurité réseau_), le GX n'accepte que le
   TLS avec son mot de passe : saisissez `mqtts://192.168.1.50:8883`, n'importe
   quel nom d'utilisateur (par exemple `gladys`) et le **mot de passe du GX**.
   Avec le profil « Non sécurisé », laissez l'utilisateur et le mot de passe
   vides.
3. Cliquez sur **Tester la connexion** : le GX et ses appareils sont listés.
4. Ouvrez l'onglet **Découverte** et ajoutez les appareils voulus.

L'identifiant du portail VRM est lu automatiquement sur le GX : ne le saisissez
que si plusieurs GX partagent le même broker.

## Options

| Option                          | Défaut    | Rôle                                                                                 |
| ------------------------------- | --------- | ------------------------------------------------------------------------------------ |
| Identifiant du portail VRM      | vide      | lu sur le GX ; seulement pour un broker partagé par plusieurs GX                     |
| Vérifier le certificat TLS      | désactivé | le GX utilise son propre certificat : à activer seulement avec un certificat reconnu |
| Intervalle minimum d'une mesure | 10 s      | le GX publie chaque seconde : Gladys enregistre la dernière valeur à ce rythme       |

Les états (état de charge, mode, état de la recharge) ne sont jamais retardés.
Gladys accepte 300 états par minute et par intégration : l'intégration arrondit
les valeurs, n'envoie que celles qui changent et reste sous cette limite.

## Fonctionnement

Le GX ne publie ses valeurs que tant qu'un client le maintient éveillé :
l'intégration envoie un keep-alive sur `R/<portal ID>/keepalive` toutes les 30
secondes, et redemande toutes les valeurs à chaque connexion et à chaque fois
que Gladys recherche les appareils. Elle ne s'abonne qu'aux topics dont elle a
besoin. Un appareil qui quitte le GX (un onduleur PV la nuit) apparaît
**injoignable** sur son badge, et revient de lui-même.

## Dépannage

- **« Aucun GX ne publie sur ce broker »** : MQTT est désactivé sur le GX, ou
  l'adresse est celle d'un autre broker.
- **« a refusé la connexion »** : avec le profil « Sécurisé », utilisez
  `mqtts://` sur le port 8883 et le mot de passe du GX.
- **« ne répond pas »** : le GX est en Venus OS antérieur à 3.20, ou
  l'identifiant du portail VRM saisi est faux (laissez-le vide).
- **Le mode ne peut pas être changé** : un BMS VE.Bus ou un Digital Multi
  Control tient le commutateur de l'onduleur/chargeur ; le GX le signale et
  Gladys affiche le mode en lecture seule.
- **Pas de « SOC minimum de l'ESS »** : le système n'est pas un ESS
  (Paramètres → ESS).

## Confidentialité

Tout reste sur votre réseau : l'intégration ne parle qu'au GX. Le mot de passe
est stocké comme secret par Gladys et n'apparaît jamais dans les logs.

## Avertissement

Intégration non officielle, sans lien avec Victron Energy. Victron Energy,
Cerbo GX, Venus OS et VRM sont des marques de Victron Energy B.V. Changer le
mode d'un onduleur/chargeur ou la réserve de l'ESS agit sur une vraie
installation électrique : faites-le en connaissance de cause.
