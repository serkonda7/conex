# Porttypen
## Netzwerkschnittstellen

| Gruppe     | Typen                                                                                                                                                                                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Virtuell   | Virtual (`virtual`), Bridge (`bridge`), LAG (`lag`)                                                                                                                                                                                                                           |
| Kupfer     | 10/100M (100BASE-TX) (`100base-tx`), 1G (1000BASE-T) (`1000base-t`), 2.5G (2.5GBASE-T) (`2.5gbase-t`), 5G (5GBASE-T) (`5gbase-t`), 10G (10GBASE-T) (`10gbase-t`)                                                                                                           |
| Modular    | 1G (SFP) (`1000base-x-sfp`), 10G (SFP+) (`10gbase-x-sfpp`), 25G (SFP28) (`25gbase-x-sfp28`), 40G (QSFP+) (`40gbase-x-qsfpp`), 50G (SFP56) (`50gbase-x-sfp56`), 100G (QSFP28) (`100gbase-x-qsfp28`), 200G (QSFP56) (`200gbase-x-qsfp56`), 400G (QSFP-DD) (`400gbase-x-qsfpdd`) |
| WLAN       | Wi-Fi (IEEE 802.11a) (`ieee802.11a`), Wi-Fi (IEEE 802.11b/g) (`ieee802.11g`), Wi-Fi 4 (IEEE 802.11n) (`ieee802.11n`), Wi-Fi 5 (IEEE 802.11ac) (`ieee802.11ac`), Wi-Fi 6 (IEEE 802.11ax) (`ieee802.11ax`), Wi-Fi 7 (IEEE 802.11be) (`ieee802.11be`)                               |
| Mobilfunk  | LTE (`lte`), 5G (`5g`)                                                                                                                                                                                                                                                        |
| Sonstige   | Other (`other`)                                                                                                                                                                                                                                                               |

Bestehende Schnittstellen mit dem älteren Typ Ethernet (`ethernet`) bleiben erhalten.

## USB & Seriell

| Gruppe    | Typen                                                                                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Allgemein | Anschluss (`port`), Stecker unbekannt                                                                                                                                                       |
| Seriell   | RJ-45 (`rj-45`), DE-9 (`de-9`), DB-25 (`db-25`), RJ-11 (`rj-11`), RJ-12 (`rj-12`), Mini-DIN-8 (`mini-din-8`)                                                                                |
| USB       | USB-A (`usb-a`), USB-B (`usb-b`), USB-C (`usb-c`), Mini-A (`usb-mini-a`), Mini-B (`usb-mini-b`), Micro-A (`usb-micro-a`), Micro-B (`usb-micro-b`), Micro-AB (`usb-micro-ab`)                 |

## Strom und Bildschirm

| Klasse               | Typen                                                                       |
| -------------------- | --------------------------------------------------------------------------- |
| Stromeingänge        | Strom (`power`), Gerät nimmt Strom auf (z. B. Netzteil)                     |
| Stromausgänge        | Steckdose (`power-outlet`), Gerät gibt Strom ab (z. B. PDU)                 |
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
