# Discord Invite + Currency Bot

Gotowy bot pod:
- kanał **witamy**
- kanał **twoje-zaproszenia**
- kanał **oblicz-ile-dostaniesz**
- liczenie zaproszeń, wyjść i fake invite
- komendy admina do dodawania/odejmowania/resetu invite
- panel na przyciskach i selectach
- kalkulator waluty w obie strony
- panel administratora do zmiany kursów, prowizji i banneru
- zapis do plików JSON, więc po restarcie nic nie znika

## Ważne o bannerze
Link `blob:` z Imgur **nie zadziała w bocie**.  
W `config.json` albo w panelu admina ustaw **bezpośredni link do obrazka**, np. taki który kończy się na `.png`, `.jpg`, `.webp`.

## Instalacja
1. Zainstaluj Node.js 18+.
2. W folderze projektu:
   ```bash
   npm install
   ```
3. Skopiuj `.env.example` do `.env` i wpisz:
   - `TOKEN`
   - `CLIENT_ID`
   - `GUILD_ID`
4. Uzupełnij `config.json` jeśli chcesz zmienić startowe ustawienia.
5. Odpal:
   ```bash
   node index.js
   ```

## Uprawnienia i intenty
W Discord Developer Portal włącz:
- **SERVER MEMBERS INTENT** — potrzebny do `guildMemberAdd`.  
- **GUILDS / GUILD_MEMBERS / GUILD_INVITES** są używane przez klienta bota. Official discord.js guide opisuje te intenty i wskazuje, że `GuildMembers` jest uprzywilejowany. citeturn822894search0

Bot używa `discord.js` 14.25.1 na npm. citeturn822894search1turn822894search4

## Pierwsze uruchomienie
Po starcie wpisz na serwerze:
- `/setup-panels` — bot wrzuci panel statystyk i panel kalkulatora na odpowiednie kanały
- `/syncinvites` — odświeży cache invite

## Komendy
### Dla wszystkich
- `/invites` — Twoje statystyki
- `/invites user:@ktoś` — statystyki wskazanej osoby
- `/invitetop` — top zaproszeń

### Dla administratora
- `/inviteadd user:@ktoś amount:5`
- `/inviteremove user:@ktoś amount:5`
- `/invitereset user:@ktoś`
- `/setup-panels`
- `/syncinvites`

## Hosting
Projekt działa lokalnie i nadaje się też na hosting 24/7:
- Railway
- Render
- VPS
- Pterodactyl

Wystarczy wrzucić pliki, ustawić zmienne środowiskowe i uruchomić `npm install && node index.js`.
