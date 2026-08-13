# Blokbar

Virtuele tent van **Pukkelblok** (Pukkelpop, Club-tent / Bootstraat). Studenten blokken aan hun eigen bureau en stappen even deze wereld in om anderen te ontmoeten.

Geen e-mail, geen university-login, geen gamerooms. Wel: gastaccount met cookie, foto-avatar, lopen, zitten, chat, privéberichten en speeddate.

## Wat zit erin

- Gastlogin met **voornaam + familienaam** (cookie, 7 dagen)
- Avatar: foto nemen, uploaden, of een look kiezen (geen pinguïns)
- Eén tent, tot **100** studenten tegelijk
- Bewegen met WASD / pijltjes / klikken / touch
- Bureaus 1–24: klik om te zitten (handig: kies het nummer van je echte plek)
- Tentchat: tijdens typen én na verzenden verschijnt de tekst **boven je avatar**
- Privéberichten (kennismaken / speeddate)
- Speeddate-hoek: wachtrij, match, 3 minuten + ijsbreker

## Snel werkend krijgen (festival-dag)

1. Op een laptop of kleine VM:

   ```bash
   npm install
   COOKIE_SECRET=kies-iets-geheims npm start
   ```

2. Open `http://localhost:3000` (of het LAN-IP van de tent-wifi).
3. Plak een QR-code aan elke tafel naar die URL.
4. Studenten komen binnen met voornaam, familienaam en een foto. Klaar.

Eén Node-proces is genoeg voor 100 simultane sockets. Zet `COOKIE_SECURE=true` alleen achter HTTPS.

### Deploy in 10 minuten

Railway, Render of Fly.io: root = deze repo, startcommando `npm start`, poort uit `PORT`. Zet `COOKIE_SECRET`. Geen database nodig (alles zit in het geheugen — herstart wist de tent, wat voor één festdag oké is).

## Aanbevelingen

**Wifi in de tent.** WebSockets moeten open blijven. Als festival-wifi clients isoleert, host lokaal op een access point in de Club-tent.

**Fysieke bureaus = virtuele bureaus.** Zet nummers 1–24 op de echte tafels. Studenten zitten dan in de wereld “naast” wie ook fysiek naast hen zit, plus ze kunnen naar de lounge of speeddate-hoek lopen.

**Moderatie (volgende stap).** Een host-laptop met kick/mute en een vast scherm in de tent dat de wereld toont. Nu nog niet ingebouwd om het concept simpel te houden.

**Niet doen op dag 1.** Voice chat, XP, minigames, e-mail. Dat leidt af van blokken en kennismaken.

**Wel later, als het werkt.** Proximity-chat (alleen wie dichtbij staat hoort je), optioneel vak/school als filter voor speeddate, en een “pauze-timer” van 10 minuten zodat mensen terug naar hun cursus gaan.

**Privacy.** Geen accounts, geen mail. Foto’s blijven in het servergeheugen tot herstart. Zeg dat duidelijk aan de ingang: gastcookie, geen tracking.

## Ontwikkelen

```bash
npm install
npm test
npm start
```

Tech: Node.js, Express, Socket.IO, Canvas + DOM-avatars. Geen Firebase, geen React.
