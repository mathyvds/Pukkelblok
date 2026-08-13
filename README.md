# Blokbar — Pukkelpop 2026

Virtuele tent van **Pukkelblok** op [Pukkelpop](https://www.pukkelpop.be/nl/) (PKP26, 20–23 augustus, Kiewit). Studenten blokken aan hun eigen bureau en stappen even deze wereld in om anderen te ontmoeten.

Geen e-mail. Wel: gastaccount met cookie, foto-avatar, lopen, zitten, chat, privéberichten en speeddate.

## Taal & stack (waarom dit)

Voor deze use case is **TypeScript** de aanbevolen taal: dezelfde types voor beweging, chat en avatars op client én server, zodat 100 simultane sockets niet stilletjes uit elkaar lopen.

| Keuze | Waarom |
| --- | --- |
| **TypeScript** | Gedeeld protocol, minder runtime-verrassingen op de festdag |
| **Node.js + Socket.IO** | WebSockets in de browser, 100 clients is routine |
| **Vite + Tailwind** | Moderne bundel, HMR, PKP-geel/zwart zonder extra CSS-framework |
| **Zod** | Join-payload valideren vóór die de tent in gaat |
| **Geen React/Next** | Een 60fps-wereld vecht met een component-tree; DOM+canvas is hier juister |
| **Geen Unity/Phaser** | Studenten zitten aan een laptop in Chrome/Safari, niet in een game-client |

Python of PHP zou kunnen, maar de realtime-browserstack is in Node/TS het kortst pad naar “het werkt in de tent”.

## Snel starten

```bash
npm install
npm run dev
```

Open http://localhost:3000 — Vite draait als middleware in hetzelfde proces.

Productie:

```bash
npm run build
COOKIE_SECRET=kies-iets-geheims HOST_PIN=kies-een-code npm start
```

Host-dashboard: http://localhost:3000/host

## Wat zit erin

- Gastlogin met voornaam, familienaam, leeftijd, school en studierichting (cookie, 7 dagen)
- **Bureaus 1–100** bij joinen = dezelfde tafel als in de echte tent; je start daar in studeermodus
- Status **Studeren** zet je terug aan jouw bureau; **Pauze** of **Kennismaken** om in de lounge te blijven
- Avatar: look kiezen (standaard); foto of camera als optie
- Tot 100 studenten, WASD / klik / touch, minimap
- Zwaai, praatcirkels in de lounge, schoolhoekjes (PXL / UCLL / UHasselt / Andere)
- **Proximity-chat** + bank-bubbels + 📣 hele tent; DMs, blokkeren en melden
- Speeddate aan een echte tafel, ijsbreker erboven, daarna ja/nee om verder te chatten
- Host (`/host`): dagkaart, momenten, zonebezetting, kick, omroep

## Aanbevelingen

- Host lokaal op tent-wifi als clients van elkaar geïsoleerd zijn
- Zet bureau-nummers 1–100 op de echte tafels
- Nog niet: voice, XP, minigames
