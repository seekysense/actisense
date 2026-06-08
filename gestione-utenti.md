# Gestione Utenti — Analisi e Piano di Implementazione

## Contesto attuale

| Componente | Stato |
|---|---|
| `api/routers/auth.py` | Admin + 1 utente opzionale caricati da `.env`, password in chiaro in memoria, nessuna persistenza |
| `frontend2/src/pages/Login.jsx` | Form funzionante, nessun link "recupera password" |
| `frontend2/src/components/shell/Topbar.jsx` | Voci "Profilo" e "Impostazioni" nel menu utente presenti ma solo chiudono il menu, nessuna navigazione |
| `frontend2/src/pages/setup/SetupLanding.jsx` | 5 card (telecamere, segnali, sito, prompt, log), nessuna sezione utenti |
| LanceDB | Usato per eventi; nessuna tabella utenti |

---

## Architettura target

### Storage utenti

Tabella LanceDB `users` con schema:

```
id          string  — uuid generato
email       string  — chiave univoca (usata come username nel login)
password    string  — hash bcrypt (formato $2b$...)
role        string  — "user" (admin rimane solo da .env)
created_at  string  — ISO 8601
last_logins list    — ultimi 5 timestamp di login (JSON serializzato)
```

> L'utente **admin** non viene mai scritto su LanceDB; viene risolto solo da `.env` come oggi.
> Il campo `last_logins` viene aggiornato ad ogni login riuscito (sliding window di 5 elementi).

---

## Step di implementazione

### STEP 1 — Backend: servizio UserStore

**File da creare:** `api/services/user_store.py`

- Classe `UserStore` che wrappa LanceDB per la tabella `users`
- Metodi: `get_all()`, `get_by_email(email)`, `create(email, plain_password)`, `delete(email)`, `set_password(email, new_plain_password)`, `verify_password(email, plain_password) -> bool`, `record_login(email)`
- Inizializzazione lazy della tabella (crea schema se non esiste)
- Hashing con `bcrypt`: `bcrypt.hashpw(password.encode(), bcrypt.gensalt())` al momento della creazione/aggiornamento; verifica con `bcrypt.checkpw()` — mai esposto all'esterno del servizio
- Dipendenza da aggiungere: `bcrypt` (puro Python, nessuna dipendenza C necessaria)

**Check:** unit test manuale con `pytest -s` che crea/legge/cancella un utente.

---

### STEP 2 — Backend: aggiornare auth.py

**File da modificare:** `api/routers/auth.py`

- Il login controlla prima admin da `.env` (invariato)
- Se non è admin, cerca in LanceDB via `UserStore.verify_password(email, plain_password)`
- `verify_password` usa `bcrypt.checkpw()` internamente — nessun hash visibile nel router
- Dopo login riuscito chiama `user_store.record_login(email)`
- Il JWT include già `role` e `sub` (email), nessuna modifica al token

**Check:** login con utente LanceDB restituisce token valido; login con credenziali errate → 401.

---

### STEP 3 — Backend: router /api/users (admin only)

**File da creare:** `api/routers/users.py`

Dipendenza `require_admin` che legge il JWT e verifica `role == "admin"`.

| Endpoint | Metodo | Descrizione |
|---|---|---|
| `GET /api/users` | GET | Lista tutti gli utenti (escluso admin .env) |
| `POST /api/users` | POST | Crea utente `{email, password}` |
| `DELETE /api/users/{email}` | DELETE | Elimina utente |
| `PUT /api/users/{email}/password` | PUT | Imposta nuova password (body: `{password}`) |

Tutti protetti da `require_admin`. Password ricevuta in chiaro → `UserStore` la hasha con bcrypt prima di persistere, il router non tocca mai l'hash.

**Check:** con token admin tutte le rotte rispondono 2xx; con token user → 403.

---

### STEP 4 — Backend: endpoint profilo (utente corrente)

**File da modificare/creare:** `api/routers/profile.py`

| Endpoint | Metodo | Descrizione |
|---|---|---|
| `GET /api/profile` | GET | Restituisce `{email, role, last_logins[]}` dell'utente corrente |
| `PUT /api/profile/password` | PUT | Cambia password `{old_password, new_password}` — verifica old_password prima |

Utente admin: `GET /api/profile` ritorna i dati dal JWT, `last_logins` vuoto (non tracciato).

**Check:** cambia password con old_password errata → 400; corretta → 200, successivo login con nuova password funziona.

---

### STEP 5 — Frontend: Login — link "Recupera password"

**File da modificare:** `frontend2/src/pages/Login.jsx`

- Aggiungere sotto il bottone "Accedi" un link `<a>` stilizzato (testo piccolo, colore `text-ink-3`)
- Il link è un `<a href="#" onClick={e => e.preventDefault()}>` — nessuna navigazione, nessuna funzionalità
- Testo: `t('auth.forgot_password')` → IT: "Password dimenticata?" / EN: "Forgot your password?"
- Aggiungere chiave di traduzione in entrambi i file `translation.json`

**Check:** il link è visibile, cliccabile senza effetti, nessun errore console.

---

### STEP 6 — Frontend: pagina Profilo

**File da creare:** `frontend2/src/pages/Profile.jsx`

Layout a card singola, 3 sezioni:

1. **Intestazione** — avatar con iniziali, email/username, badge ruolo
2. **Cambia password** — form con 3 campi: vecchia password, nuova password, conferma nuova password; bottone "Salva"; validazione client-side (nuova ≠ vecchia, conferma === nuova); chiamata `PUT /api/profile/password`
3. **Ultimi accessi** — lista dei 5 timestamp in formato `DD/MM/YYYY HH:mm`; se admin o lista vuota mostra "Nessun accesso registrato"

**File da modificare:** `frontend2/src/router.jsx`
- Aggiungere route `/profile` dentro `RequireAuth`

**File da modificare:** `frontend2/src/components/shell/Topbar.jsx`
- Il pulsante "Profilo" nel menu utente naviga verso `/profile` invece di solo chiudere il menu

**Check:** navigazione a `/profile` funziona; cambio password con old errata mostra errore; con dati corretti mostra successo e fa logout automatico (token invalidato implicitamente).

---

### STEP 7 — Frontend: sezione Utenti nel Setup

**File da creare:** `frontend2/src/pages/setup/users/UserList.jsx`

- Tabella con colonne: Email, Ruolo, Creato il, Azioni
- Azioni per riga: "Imposta password" (apre dialog), "Elimina" (confirm dialog con `ConfirmDelete`)
- Bottone in header: "Aggiungi utente" → apre dialog con form email + password
- Usa i componenti `Dialog`, `Input`, `Button`, `ConfirmDelete` già presenti
- Hook `useUsers` (da creare) che wrappa `GET/POST/DELETE/PUT /api/users`

**File da modificare:** `frontend2/src/pages/setup/SetupLanding.jsx`
- Aggiungere card "Utenti" con icona `Users` da lucide-react
- Visibile solo se `role === 'admin'` (già garantito dal router, ma la card non deve comparire nemmeno visivamente per non-admin)

**File da modificare:** `frontend2/src/router.jsx`
- Aggiungere route `/setup/users` → `<UserList />`

**Check:** admin vede la card e può aggiungere/eliminare utenti; non-admin reindirizzato a `/`.

---

### STEP 8 — Traduzioni

**File da modificare:** `frontend2/src/locales/it/translation.json` e `en/translation.json`

Chiavi da aggiungere:

```json
"auth": {
  "forgot_password": "Password dimenticata?"   // EN: "Forgot your password?"
},
"profile": {
  "title": "Profilo",
  "change_password": "Cambia password",
  "old_password": "Password attuale",
  "new_password": "Nuova password",
  "confirm_password": "Conferma nuova password",
  "save_password": "Salva password",
  "password_changed": "Password aggiornata",
  "password_mismatch": "Le password non coincidono",
  "password_same": "La nuova password è uguale alla vecchia",
  "last_logins": "Ultimi accessi",
  "no_logins": "Nessun accesso registrato"
},
"users": {
  "title": "Utenti",
  "subtitle": "Gestione degli utenti con accesso alla console.",
  "add_user": "Aggiungi utente",
  "email": "Email",
  "password": "Password",
  "role": "Ruolo",
  "created_at": "Creato il",
  "set_password": "Imposta password",
  "delete_user": "Elimina utente",
  "confirm_delete": "Eliminare l'utente {{email}}? L'operazione non è reversibile.",
  "user_created": "Utente creato",
  "user_deleted": "Utente eliminato",
  "password_updated": "Password aggiornata",
  "new_password": "Nuova password",
  "no_users": "Nessun utente creato",
  "no_users_hint": "Aggiungi il primo utente con il pulsante in alto a destra."
}
```

Aggiungere anche la card nel setup:
```json
"setup": {
  "users": "Utenti",
  "users_desc": "Aggiungi, rimuovi e gestisci le password degli utenti.",
  "users_count": "{{count}} utenti"
}
```

---

## Checklist riepilogativa

### Backend
- [ ] `api/services/user_store.py` — CRUD + record_login su LanceDB
- [ ] `api/routers/auth.py` — login ibrido .env + LanceDB, registra login
- [ ] `api/routers/users.py` — CRUD utenti protetto da require_admin
- [ ] `api/routers/profile.py` — profilo corrente + cambio password con verifica old
- [ ] `api/main.py` — registrare i nuovi router
- [ ] Test manuale: login admin, login user LanceDB, operazioni CRUD utenti, cambio password

### Frontend
- [ ] `Login.jsx` — link "Password dimenticata?" (placeholder)
- [ ] `Profile.jsx` — pagina profilo con cambio password e ultimi accessi
- [ ] `Topbar.jsx` — voce "Profilo" naviga a `/profile`
- [ ] `router.jsx` — route `/profile` e `/setup/users`
- [ ] `setup/users/UserList.jsx` — gestione utenti per admin
- [ ] `setup/SetupLanding.jsx` — card Utenti (visibile solo ad admin)
- [ ] Traduzioni IT + EN complete per auth, profile, users, setup.users
- [ ] Test manuale: flusso completo login → profilo → cambio password → logout → login con nuova password

---

## Note tecniche

- **bcrypt per le password**: algoritmo adatto alla produzione — include salt automatico per ogni hash, cost factor configurabile (default 12), resistente a rainbow table e brute force GPU. La libreria `bcrypt` è puro Python senza dipendenze native e si aggiunge con un singolo `pip install bcrypt`. Tutta la logica di hashing è incapsulata in `user_store.py`; router e frontend non vedono mai l'hash.
- **Admin da .env**: l'admin non appare mai nella lista utenti LanceDB né nella pagina Setup > Utenti, evitando conflitti o duplicazione.
- **last_logins**: salvato come stringa JSON nella tabella LanceDB (lista di ISO strings). LanceDB non supporta array nativi in modo portabile, serializzazione/deserializzazione nel `UserStore`.
- **Token JWT**: non viene invalidato al cambio password — dopo il cambio password l'UI fa logout automatico per forzare il re-login con le nuove credenziali.
- **Recupera password**: link placeholder nel login, senza routing né logica backend. Da implementare in un secondo momento (es. email SMTP o reset code).
