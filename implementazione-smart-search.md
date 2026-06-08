# Piano di Implementazione — Smart Search

> **Obiettivo:** Aggiungere la Smart Search a `frontend2`: la barra in Topbar diventa un filtro NL per eventi, con navigazione automatica alla pagina Eventi arricchita (drawer laterale + filtro giorno).

---

## Architettura scelta

```
Topbar (search input)
  → onEnter → POST /api/events/search   ← nuovo endpoint backend
                  → LLM estrae filtri JSON
                  → LanceDB query con filtri
                  ← {filters, events, confidence}
  → smartSearchStore.setResults(data)
  → navigate('/events')

Events.jsx
  → if smartSearchStore.isActive → mostra risultati smart + banner + pills
  → else → useEvents({date}) normale
  → click su riga → EventDrawer laterale (già esiste)
  + filtro giorno (date picker ← → oggi) sempre visibile
```

**Stato globale:** nuovo `smartSearchStore.js` (Zustand) separato da `dashboardStore` per non inquinare lo stato dashboard.

---

## Step B1 — Estendi `LanceDBReader.get_events`

**File:** `api/services/lancedb_reader.py`

Aggiungere parametri `action`, `camera_id`, `score_above`, `score_below`, `date_from`, `date_to` (come `date` string YYYY-MM-DD) al metodo `get_events` e al sync interno `_get_events_sync`.

> Il router `/api/events` esistente converte già `date_from`/`date_to` in `since`/`until` datetime — qui aggiungiamo solo i filtri action/camera/score sul DB side per efficienza.

### Checklist
- [x] Firma `get_events(...)` estesa con `action`, `camera_id`, `score_above`, `score_below`
- [x] `_get_events_sync` aggiunge i filtri nel where clause LanceDB
- [x] I valori stringa vengono validati con whitelist prima dell'interpolazione (prevenire SQL injection su LanceDB)
- [ ] Test manuale: query con `action='alarm'` restituisce solo alarm events
- [ ] Test manuale: query con `score_above=0.7` filtra correttamente
- [ ] Nessuna regressione sull'endpoint `/api/events` esistente

---

## Step B2 — Crea `api/routers/smart_search.py`

**File:** `api/routers/smart_search.py` (nuovo)

Implementa `POST /api/events/search`:
1. Legge `body.q` (query NL)
2. Chiama `load_config()` per aree/camere/segnali
3. Costruisce system prompt con contesto dinamico (template da `smart-search.md §4`)
4. Chiama LLM via `aiohttp` → `{LLM_BASE_URL}/chat/completions` con `FAST_MODEL`, temp 0.1, max_tokens 512
5. Parsing difensivo del JSON (strip markdown fence, regex fallback)
6. Validazione whitelist: `area_id`, `signal_id`, `action` contro config reale
7. Esegue query LanceDB con `LanceDBReader.get_events(...)` (parametri da Step B1)
8. Post-filtra client-side: `camera_id`, `score_above`, `score_below`, `action` se non filtrati dal DB
9. Risponde con `{query, filters, confidence, original_intent, count, events}`

**Gestione errori:**
- LLM timeout (15s): ritorna `confidence: "low"`, `events: []`, `error: "extraction_failed: ..."`
- JSON malformato: stesso fallback
- Config non disponibile: 500

### Checklist
- [x] File creato con `router = APIRouter()`
- [x] `_extract_filters(query, cfg)` implementata con timeout 15s
- [x] System prompt completo (aree + camere + segnali + regole da `smart-search.md §4`)
- [x] Iniezione data corrente nel prompt per riferimenti relativi (ieri, oggi, stamattina)
- [x] Parsing JSON difensivo (strip fence + regex fallback)
- [x] Validazione whitelist per `area_id`, `signal_id`, `action`
- [x] Casting sicuro di `score_above`, `score_below` a float
- [x] Casting sicuro di `limit` a int con cap a 2000
- [x] Risposta include `filters` dettagliati (per mostrare le pill nel frontend)
- [x] Fallback graceful: se LLM fallisce, ritorna struttura valida con `confidence: "low"`
- [ ] Test manuale: `curl -X POST /api/events/search -d '{"q":"alarm ieri"}'` restituisce JSON corretto

---

## Step B3 — Monta il router in `api/main.py`

**File:** `api/main.py`

Aggiungere import e `app.include_router(smart_search_router, ...)`.

### Checklist
- [x] Import `from .routers import smart_search as smart_search_router`
- [x] `app.include_router(smart_search_router.router, prefix="/api", tags=["events"])`
- [ ] Riavvio server → `GET /openapi.json` mostra `POST /api/events/search`
- [x] Autenticazione JWT richiesta (Depends su `get_current_user`)

---

## Step F1 — Crea `src/stores/smartSearchStore.js`

**File:** `frontend2/src/stores/smartSearchStore.js` (nuovo)

Store Zustand con:
```js
{
  isActive: false,        // true quando c'è una ricerca smart attiva
  query: '',              // testo originale dell'utente
  results: [],            // array eventi dalla risposta
  filters: {},            // filtri estratti dall'LLM
  confidence: null,       // "high" | "medium" | "low"
  originalIntent: '',     // parafrasi inglese dell'intento
  setResults(data),       // setta tutto da risposta API
  clearResults(),         // resetta allo stato vuoto
}
```

### Checklist
- [x] File creato, store esportato come `useSmartSearchStore`
- [x] `setResults(data)` salva `query`, `results`, `filters`, `confidence`, `originalIntent`, `isActive: true`
- [x] `clearResults()` riporta tutto al default con `isActive: false`
- [x] Importabile da Topbar e Events senza circolare imports

---

## Step F2 — Crea `src/hooks/useSmartSearch.js`

**File:** `frontend2/src/hooks/useSmartSearch.js` (nuovo)

Hook basato su `useMutation` di TanStack Query:
```js
export function useSmartSearch() {
  return useMutation({
    mutationFn: async (query) =>
      apiFetch('/api/events/search', {
        method: 'POST',
        body: JSON.stringify({ q: query }),
      }),
  })
}
```

### Checklist
- [x] File creato e funzionante
- [x] `isPending` esposto (usato dal Topbar per loading state)
- [x] Errori non bloccanti (gestiti nel `onError` del chiamante)
- [x] Usa `apiFetch` da `@/lib/api` (include auth header automaticamente)

---

## Step F3 — Aggiorna `Topbar.jsx`

**File:** `frontend2/src/components/shell/Topbar.jsx`

Modifiche:
1. Aggiungere state locale `searchText`
2. Usare `useSmartSearch()` e `useSmartSearchStore`
3. Gestire `onKeyDown` (Enter): chiama `smartSearch.mutate(q)`
4. Mentre `isPending`: mostrare spinner nel campo al posto dell'icona Search
5. Su `onSuccess`: chiamare `store.setResults(data)` + `navigate('/events')`
6. Su `onError`: mostrare messaggio breve inline (non bloccante)
7. Se `smartSearchStore.isActive`: mostrare un indicatore visivo nella barra (bordo colorato accent + testo "Ricerca attiva")
8. Aggiungere tasto × nella barra quando `isActive` per chiamare `store.clearResults()`

**UX del loading:**
- L'icona `Search` viene sostituita da uno spinner `animate-spin` mentre `isPending`
- L'input è disabilitato durante il pending (con `opacity-60`)
- Placeholder dinamico: `"Cerca eventi… (Premi Invio)"` di default, `"Analisi in corso…"` durante pending (ricordarsi del multilingua italiano e inglese)

### Checklist
- [x] `useState('')` per `searchText`
- [x] `onKeyDown` gestisce Enter + trim vuoto
- [x] Spinner visibile durante `isPending` al posto dell'icona Search
- [x] Input disabilitato durante pending
- [x] `navigate('/events')` su success
- [x] `smartSearchStore.setResults(data)` su success
- [x] Bordo/badge "ricerca attiva" quando `isActive`
- [x] Tasto × per `clearResults()` visibile quando `isActive`
- [x] Gestione errore graceful (nessun crash, messaggio visivo opzionale)
- [x] Nessuna regressione sulle altre funzionalità del Topbar (live, menu, notifiche)

---

## Step F4 — Arricchisci `Events.jsx`

**File:** `frontend2/src/pages/Events.jsx`

### 4a — Filtro giorno (date picker)

Aggiungere sopra i filtri esistenti un navigatore data identico alla dashboard:
- Pulsante `‹` giorno precedente
- Label giorno corrente (format: `lun 8 giu`)
- Pulsante `›` giorno successivo
- Pulsante `Oggi` per tornare a oggi
- Il `date` selezionato controlla `useEvents({date})`
- gestione delle etichette italiano e inglese

Lo state del giorno viene gestito localmente in `Events.jsx` (non serve nel store globale).

Quando `smartSearchStore.isActive` il navigatore data viene nascosto (i risultati smart hanno già il range temporale).

### 4b — EventDrawer laterale

Il componente `EventDrawer` esiste già in `src/components/dashboard/EventDrawer.jsx`.

Aggiungere alla tabella eventi:
- Ogni riga è cliccabile → `onClick={() => setSelectedEvent(e)}`
- State locale: `selectedEvent`, `selectedIndex` (per navigazione prev/next nel drawer)
- Mostrare `EventDrawer` quando `selectedEvent != null`
- `onClose` → `setSelectedEvent(null)`
- `onOpenEvent` → naviga all'evento cliccato nella sezione "Altri eventi" del drawer
- Prop `siblings` = array completo degli eventi visibili (per la navigazione)
- Aggiungere overlay scuro semitrasparente quando il drawer è aperto (click fuori → chiude)
- Navigazione prev/next nell'header del drawer (indice `1 / 34` come nello screenshot)

### 4c — Banner smart search

Quando `smartSearchStore.isActive`, mostrare sopra la tabella un banner:
```
[🔍 "alarm ieri in lobby"]  area: lobby  azione: alarm  dal: 2025-04-09  [× Cancella ricerca]
```
- Pill per ogni filtro non-null (area, segnale, azione, date, camera, score)
- Badge `confidence: LOW` in giallo se confidence è "low" con messaggio "Risultati approssimativi"
- Tasto "Cancella ricerca" → `store.clearResults()` torna alla lista normale

### 4d — Lista eventi arricchita

Quando smart search attiva, la sorgente dati è `smartSearchStore.results` invece di `useEvents`.

I filtri area/azione del pannello locale continuano a funzionare come ulteriore raffinamento (applicati client-side sopra i risultati smart).

### Checklist
- [x] Navigatore data funzionante (‹ oggi ›) con state locale `selectedDate`
- [x] Navigatore nascosto quando `isActive`
- [x] `useEvents({date: selectedDate})` aggiornato con date dinamica
- [x] Ogni riga tabella ha `cursor-pointer` e `onClick`
- [x] `EventDrawer` importato e montato con overlay
- [x] Prop `siblings` passata correttamente
- [x] Navigazione prev/next nel drawer (aggiornare `selectedEvent` per indice)
- [x] Banner smart search visibile quando `isActive`
- [x] Pill filtri nel banner per ogni campo non-null
- [x] Warning "approssimativo" se `confidence === 'low'`
- [x] Tasto "Cancella ricerca" chiama `store.clearResults()`
- [x] Filtri area/azione locali si applicano anche sui risultati smart
- [ ] Test: click riga → drawer si apre con video e dettagli
- [ ] Test: chiudi drawer → overlay scompare, lista rimane
- [ ] Test: "Altri eventi" nel drawer naviga all'evento cliccato

---

## Step F5 — i18n: aggiungi chiavi traduzione

**File:** `frontend2/src/locales/it/translation.json` e `en/translation.json`

Nuove chiavi in `events`:
```json
{
  "events": {
    "day_filter": "Giorno",
    "today_btn": "Oggi",
    "smart_search_active": "Ricerca intelligente attiva",
    "smart_search_clear": "Cancella ricerca",
    "smart_search_approx": "Risultati approssimativi — l'AI non era sicura di tutti i filtri",
    "smart_search_intent": "Intento: {{intent}}",
    "filter_pill_area": "Area: {{val}}",
    "filter_pill_signal": "Segnale: {{val}}",
    "filter_pill_action": "Azione: {{val}}",
    "filter_pill_date": "Dal {{from}} al {{to}}",
    "filter_pill_camera": "Camera: {{val}}",
    "filter_pill_score": "Score > {{val}}"
  },
  "topbar": {
    "search_placeholder": "Cerca eventi… (Invio per cercare)",
    "search_loading": "Analisi in corso…",
    "search_active": "Ricerca attiva"
  }
}
```

### Checklist
- [x] Chiavi aggiunte in `it/translation.json`
- [x] Chiavi aggiunte in `en/translation.json` (tradotte in inglese)
- [x] Nessuna chiave esistente modificata o rimossa
- [x] Tutte le nuove chiavi usate nei componenti con `t('...')`

---

## Sequenza di implementazione consigliata

```
B1 → B2 → B3   (backend, testabile con curl)
      ↓
F1 → F2 → F3   (store + hook + topbar)
      ↓
F4 → F5        (events page + i18n)
```

Ogni step è indipendente e testabile prima di passare al successivo.

---

## Note tecniche

| Aspetto | Decisione |
|---------|-----------|
| LLM model | `FAST_MODEL` env var (es. `qwen2.5vl:7b`) — già in memoria su Ollama |
| Timeout LLM | 15s — se scade, ritorna `confidence: "low"` senza bloccare la UI |
| SQL injection LanceDB | Whitelist per stringhe + cast esplicito per numeri prima dell'interpolazione |
| Privacy | LLM riceve solo nomi di config, mai dati evento reali |
| Caching | Nessun caching aggiuntivo (il contesto cambia raramente; config già in `useConfig`) |
| Navigazione | La pagina Events mostra i risultati senza perdere lo stato se si naviga e torna |
| Overlay drawer | `z-[130]` come nel componente esistente; overlay a `z-[129]` |
| Backward compat | Il router `/api/events` esistente non viene modificato |
