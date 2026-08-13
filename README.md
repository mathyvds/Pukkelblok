# Blokbar

Virtuele tent van **Pukkelblok** (Pukkelpop, Club-tent / Bootstraat). Studenten blokken aan hun eigen bureau en stappen even deze wereld in om anderen te ontmoeten.

Geen e-mail, geen university-login, geen gamerooms. Wel: gastaccount met cookie, foto-avatar, lopen, zitten, chat, privéberichten en speeddate.

## Wat zit erin

- Gastlogin met **voornaam + familienaam** (cookie, 7 dagen)
- Optioneel **vakgebied** (voor speeddate-matching)
- Avatar: foto nemen, uploaden, of een look kiezen (geen pinguïns)
- Eén tent, tot **100** studenten tegelijk
- Bewegen met WASD / pijltjes / klikken / touch · **E** = dichtstbijzijnde bureau
- Bureaus 1–24: klik, of kies het nummer van je echte plek in de balk
- **Proximity-chat**: wie dichtbij staat hoort je; 📣 roept naar de hele tent (1×/min)
- Spraakwolk boven de avatar bij typen en nabije chat — **niet** bij privéberichten
- Privéberichten (kennismaken / speeddate)
- Speeddate-hoek: wachtrij, match, 3 minuten + ijsbreker, optioneel zelfde vak eerst
- **Pauze van 10 minuten**, daarna een tik terug naar blokken
- Minimap + bezette bureaus
- Host-dashboard (`/host`): omroep, kick, bezetting

## Snel werkend krijgen (festival-dag)

1. Op een laptop of kleine VM:

   ```bash
   npm install
   COOKIE_SECRET=kies-iets-geheims HOST_PIN=kies-een-code npm start
   ```

2. Open `http://localhost:3000` (of het LAN-IP van de tent-wifi).
3. Plak een QR-code aan elke tafel naar die URL.
4. Host-laptop: `http://localhost:3000/host` met dezelfde `HOST_PIN`.
5. Studenten komen binnen met voornaam, familienaam en een foto. Klaar.

Eén Node-proces is genoeg voor 100 simultane sockets. Zet `COOKIE_SECURE=true` alleen achter HTTPS.

### Deploy in 10 minuten

Railway, Render of Fly.io: root = deze repo, startcommando `npm start`, poort uit `PORT`. Zet `COOKIE_SECRET` en `HOST_PIN`. Geen database nodig (alles zit in het geheugen — herstart wist de tent, wat voor één festdag oké is).

## Aanbevelingen

**Wifi in de tent.** WebSockets moeten open blijven. Als festival-wifi clients isoleert, host lokaal op een access point in de Club-tent.

**Fysieke bureaus = virtuele bureaus.** Zet nummers 1–24 op de echte tafels. Studenten kiezen dat nummer in de balk en zitten “naast” wie ook fysiek naast hen zit.

**Host-laptop.** Open `/host` op een vast scherm aan de infostand. Kick bij misbruik, omroep als de speeddate-ronde begint.

**Niet doen op dag 1.** Voice chat, XP, minigames, e-mail. Dat leidt af van blokken en kennismaken.

**Privacy.** Geen accounts, geen mail. Foto’s blijven in het servergeheugen tot herstart. Zeg dat duidelijk aan de ingang: gastcookie, geen tracking. Privéberichten verschijnen niet als tekstwolk boven iemands hoofd.

## Ontwikkelen

```bash
npm install
npm test
npm start
```

Tech: Node.js, Express, Socket.IO, Canvas + DOM-avatars. Geen Firebase, geen React.
