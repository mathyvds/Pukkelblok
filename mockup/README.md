# UniVerse mockup

Interactieve click-through van hoe UniVerse eruitziet en werkt. Geen Firebase, geen account nodig.

## Openen

Open `mockup/index.html` in een browser, of start vanuit de repo-root:

```bash
python3 -m http.server 8080
```

Daarna: [http://localhost:8080/mockup/](http://localhost:8080/mockup/)

## Wat je ziet

1. **Concept boards** — statische schermen van landing, lounge, customize, game room en de user flow.
2. **Interactieve demo** — klikbare prototype van de volledige student-journey.

## Hoe de demo werkt

| Stap | Wat je doet | Wat er gebeurt |
| --- | --- | --- |
| 1 | Landing → **Try the demo** | Je komt binnen als `HawkCoder` (CS, Lv.3) |
| 2 | Of **Create Account** | Alleen `@mylaurier.ca` e-mails (nep-auth, niets wordt opgeslagen) |
| 3 | Lounge | Loop met **WASD** / pijltjes of klik op de campus |
| 4 | Andere penguins | Klik voor profiel, chat, status en XP |
| 5 | Sidebar | Online-lijst, realtime-achtige chat, study goals, leaderboard |
| 6 | **Study (+15 XP)** | XP, level-ups en dagelijkse streak |
| 7 | **Customize** | Kleur, accessoire en statusbericht van je penguin |
| 8 | **Change Room** | Main Hall, CS, Business, Psychology |
| 9 | **Game Room** | Type Sprint, Quiz Blitz, Debug Rush, Math Blitz — XP bij winst |

Alles is client-side mock-data. Refresh = demo reset.
