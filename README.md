# Pukkelblok — Pukkelpop 2026

Virtuele tent van **Pukkelblok** op [Pukkelpop](https://www.pukkelpop.be/nl/) (PKP26, 20–23 augustus, Kiewit). Studenten blokken aan hun eigen bureau en stappen even deze wereld in om anderen te ontmoeten.

Geen e-mail. Wel: gastaccount met cookie, foto-avatar, lopen, zitten, chat, privéberichten en speeddate. Binnen in twee korte stappen: naam + bureaunummer, daarna school en look.

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
TZ=Europe/Brussels COOKIE_SECRET=kies-iets-geheims HOST_PIN=kies-een-code npm start
```

`COOKIE_SECRET` is verplicht in productie (geen dev-default). `HOST_PIN` beschermt `/host`. `TZ` zet de dagkaart op Belgische tijd (standaard `Europe/Brussels`). Cookies zijn `Secure` zodra `NODE_ENV=production`. Healthcheck: `GET /api/health`.

Host-dashboard: http://localhost:3000/host

## Wat zit erin

- Gastlogin met voornaam, familienaam, leeftijd, school en studierichting (cookie, 7 dagen)
- **Bureaus 1–100**: typ het nummer op je tafel (of kies in het overzicht); je start in studeermodus
- Tafels van 4 met gangpaden; tafels zijn **bubbels** (E = aansluiten of verlaten)
- Status **Blokken / Pauze / Kennismaken** onderaan; korte coach bij de eerste keer
- Avatar: foto nemen, uploaden, of een look kiezen + sfeer van jouw bureau
- Tot 100 studenten, WASD / klik / touch
- **Proximity-chat** (dichtbij) + tafelbubbel + 📣 hele tent; DMs lekken niet als spraakwolk
- Speeddate, optioneel dezelfde studierichting eerst
- Host (`/host`): kick, unkick, bureau vrijgeven, omroep, bezetting 1–100, simulatie-bots
