# Porttypen
## Netzwerk-Schnittstellen

| Gruppe     | Typen                                                                                                                                                                                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Allgemein  | Ethernet (`ethernet`)                                                                                                                                                                                                                                                         |
| Virtuell   | Virtual (`virtual`), Bridge (`bridge`), LAG (`lag`)                                                                                                                                                                                                                           |
| Kupfer     | 100BASE-TX (`100base-tx`), 1000BASE-T (`1000base-t`), 2.5GBASE-T (`2.5gbase-t`), 5GBASE-T (`5gbase-t`), 10GBASE-T (`10gbase-t`)                                                                                                                                               |
| Modular    | SFP (`1000base-x-sfp`), SFP+ (`10gbase-x-sfpp`), SFP28 (`25gbase-x-sfp28`), QSFP+ (`40gbase-x-qsfpp`), SFP56 (`50gbase-x-sfp56`), QSFP28 (`100gbase-x-qsfp28`), QSFP56 (`200gbase-x-qsfp56`), QSFP-DD (`400gbase-x-qsfpdd`)                                                   |
| WLAN       | 802.11a (`ieee802.11a`), 802.11b/g (`ieee802.11g`), 802.11n (`ieee802.11n`), 802.11ac (`ieee802.11ac`), 802.11ax (`ieee802.11ax`), 802.11be (`ieee802.11be`)                                                                                                                  |
| Mobilfunk  | LTE (`lte`), 5G (`5g`)                                                                                                                                                                                                                                                        |
| Sonstige   | Other (`other`)                                                                                                                                                                                                                                                               |

## Anschlüsse

| Gruppe    | Typen                                                                                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Allgemein | Anschluss (`port`), Stecker unbekannt                                                                                                                                                       |
| Seriell   | RJ-45 (`rj-45`), DE-9 (`de-9`), DB-25 (`db-25`), RJ-11 (`rj-11`), RJ-12 (`rj-12`), Mini-DIN-8 (`mini-din-8`)                                                                                |
| USB       | USB-A (`usb-a`), USB-B (`usb-b`), USB-C (`usb-c`), Mini-A (`usb-mini-a`), Mini-B (`usb-mini-b`), Micro-A (`usb-micro-a`), Micro-B (`usb-micro-b`), Micro-AB (`usb-micro-ab`)                 |

## Strom und Bildschirm

| Klasse               | Typen                                                                       |
| -------------------- | --------------------------------------------------------------------------- |
| Stromanschlüsse      | Strom (`power`)                                                             |
| Steckdosen           | Steckdose (`power-outlet`)                                                  |
| Bildschirmanschlüsse | HDMI (`hdmi`), DisplayPort (`displayport`), VGA (`vga`), DVI (`dvi`)        |


## Front- und Rückports
Front- und Rückports bilden Patchpanels ab. Front ist die Panel-Seite, Rück die Dosenseite.

| Gruppe    | Typen                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------- |
| Kupfer    | 8P8C (`8p8c`), 110 Punch (`110-punch`)                                                                                    |
| Glasfaser | LC (`lc`), LC/APC (`lc-apc`), SC (`sc`), SC/APC (`sc-apc`), ST (`st`), FC (`fc`), MPO (`mpo`), MTRJ (`mtrj`)              |
| Spleiß    | Splice (`splice`)                                                                                                         |

### Bereich einer Dose
Ein Rückport mit genau einer Position ist eine Dose. Ihr Bereich ist der Raum, in dem das Installationskabel endet. Er ist unabhängig vom Bereich des Patchpanels und darf auch an einem anderen Standort liegen.

- Gesetzt wird er am Patchpanel über den Bearbeiten-Knopf der Zeile (dort auch Namen und Kabel von Front- und Rückport).
- Der Bereich muss zum Mandanten des Patchpanels gehören oder geteilt sein.
- Die Detailseite eines Bereichs listet seine Dosen und die seiner Unterbereiche.
- Wird eine Dose auf dem Grundriss eines Bereichs platziert, erhält sie diesen Bereich, falls sie noch keinen hat. Liegt sie danach in einem anderen Bereich, wird sie vom Grundriss entfernt.
- Ein Bereich mit Dosen kann nicht gelöscht werden.
