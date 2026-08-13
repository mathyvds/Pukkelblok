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
COOKIE_SECRET=kies-iets-geheims npm start
```

## Wat zit erin

- Gastlogin met voornaam + familienaam (cookie, 7 dagen)
- Avatar: foto nemen, uploaden, of een look kiezen
- Tot 100 studenten, WASD / klik / touch
- Bureaus 1–24, tentchat met tekst boven de avatar, DMs, speeddate

## Aanbevelingen

- Host lokaal op tent-wifi als clients van elkaar geïsoleerd zijn
- Zet bureau-nummers 1–24 op de echte tafels
- Nog niet: voice, XP, minigames
- Later: proximity-chat, vak-filter, pauze-timer, host-kick
