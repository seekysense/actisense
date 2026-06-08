# IQFrame — New UI/UX Specification

> Documento funzionale per la nuova interfaccia. Descrive entità, stati, interazioni e palette cromatica per ogni schermata. Non prescrive layout: si attiene al *cosa* è necessario a ogni livello di navigazione.

---

## 1. Design System

### 1.1 Token cromatici

| Token | Significato | Valore di riferimento |
|---|---|---|
| `--bg` | Sfondo pagina | `#F9FAFB` (off-white) |
| `--surface` | Superficie card / drawer | `#FFFFFF` |
| `--bg-2` | Sfondo secondario (row hover, input) | `#F3F4F6` |
| `--line` | Bordo sottile standard | `#E5E7EB` |
| `--line-2` | Bordo leggermente più marcato | `#D1D5DB` |
| `--ink` | Testo primario | `#111827` |
| `--ink-1` | Testo secondario | `#1F2937` |
| `--ink-2` | Testo terziario | `#374151` |
| `--ink-3` | Label, metadata | `#6B7280` |
| `--ink-4` | Placeholder, disabilitato | `#9CA3AF` |
| `--accent` | Primario interattivo | `#2563EB` |
| `--accent-soft` | Sfondo accent leggero | `#EFF6FF` |
| `--accent-ink` | Testo su accent-soft | `#1D4ED8` |
| `--ok` | Stato operativo / online | `#10B981` |

#### Palette stati semantici

| Stato | Colore | Sfondo | Uso |
|---|---|---|---|
| `alarm` | `#EF4444` | `#FEF2F2` | Evento critico, azione immediata |
| `notify` | `#F59E0B` | `#FFFBEB` | Evento da revisionare |
| `statistic` | `#6B7280` | `#F9FAFB` | Log silenzioso, solo registrazione |
| `ok` / `clear` | `#10B981` | `#ECFDF5` | Nessun evento, area pulita |
| `offline` | `#9CA3AF` | `#F3F4F6` | Dispositivo / motore non raggiungibile |

> **Regola cromatica**: i bordi sinistri delle card e i badge di stato derivano sempre da questa palette. Il colore `alarm` ha priorità su `notify`, `notify` su `statistic`, `statistic` su `ok`.

### 1.2 Tipografia

- Family: `Inter` (UI) + `Geist Mono` (valori numerici, ID, score, timestamp)
- Scale: 10px (meta), 11px (label uppercase), 12px (body small), 13px (body), 14px (body large), 16px (number stat), 18px (section title), 22–28px (page title)
- Page title: `font-weight: 700`
- Section label: `font-weight: 600, text-transform: uppercase, letter-spacing: 0.06em`

### 1.3 Componenti base

**Pill / Badge**: bordo arrotondato `border-radius: 999px`, padding `3px 10px`, `font-size: 11px`, `font-weight: 600`. Colore derivato dallo stato semantico.

**Card**: `background: var(--surface)`, `border: 1px solid var(--line)`, `border-radius: 10px`. Bordo sinistro spesso (4px) per indicare lo stato quando rilevante.

**Bottone primario**: `background: var(--accent)`, testo bianco, `border-radius: 6px`.

**Bottone secondario**: bordo `1px solid var(--line)`, sfondo trasparente, testo `var(--ink-2)`.

**Input / Select**: `border: 1px solid var(--line-2)`, `border-radius: 6px`, `font-size: 13px`. Focus: bordo `var(--accent)`.

**Drawer**: pannello laterale destro a scorrimento. Larghezza ~420px su desktop. Backdrop semitrasparente dietro. Chiusura con Escape o click sul backdrop.

---

## 2. Struttura di navigazione

```
/ (Login)
├── / (Dashboard)            ← vista principale, richiede autenticazione
├── /events                  ← storico eventi tabellare
├── /config                  ← panoramica configurazione sito
├── /setup                   ← ambiente di configurazione
│   ├── cameras              ← lista videocamere
│   │   ├── new              ← form nuova camera
│   │   ├── :id/edit         ← form modifica camera
│   │   └── :id/roi          ← editor zone ROI
│   ├── signals              ← libreria segnali
│   │   ├── new              ← wizard nuovo segnale (4 step)
│   │   └── :id/edit         ← modifica segnale esistente
│   └── site                 ← impostazioni sito
└── /logs                    ← log motore di elaborazione
```

---

## 3. Shell applicativa (frame comune)

Tutte le pagine autenticate condividono la stessa shell:

### 3.1 Sidebar sinistra

Contiene due aree funzionali:

**Area brand / sito**
- Logo applicazione
- Nome del sito attivo (es. "The Castelletto")
- Metadata: numero aree, numero camere
- Indicatore stato WebSocket: `live` (verde pulsante) | `connecting` | `disconnected`

**Navigazione principale** — voci:
- Dashboard (icona griglia)
- Events (icona lista)
- Config (icona ingranaggio / documento)
- Setup (icona tune / strumenti)
- Logs (icona terminale)

**Sezione filtri Dashboard** — visibile solo nella vista Dashboard:
- **Aree**: lista selezionabile multi-valore; a fianco di ogni area il conteggio eventi nel range temporale corrente
- **Priorità**: 5 pill selezionabili P1–P5 (P1 = critico, P5 = informativo). Colore gradiente: P1 rosso → P5 grigio
- **Azione**: 3 chip selezionabili — `alarm` (rosso), `notify` (arancio), `statistic` (grigio). Ogni chip ha un dot colorato
- Tutti i filtri sono multi-selezione e si applicano congiuntamente (AND logico)
- Stato "nessun filtro" equivale a "mostra tutto"

**Piede sidebar**
- Avatar utente (iniziali), nome, ruolo
- Pulsante logout

### 3.2 Topbar (area principale)

Contiene da sinistra a destra:
- Titolo dinamico della pagina corrente (con stato di caricamento inline)
- Subtitle: conteggio eventi e aree visibili nel range
- Controlli di navigazione temporale (solo Dashboard): frecce prev/next, label data/range, bottone "Today", toggle "Week"
- Bottone "Setup" (link rapido)
- Bottone "Live" (solo se la data visualizzata è oggi): punto colorato che indica stato WebSocket

### 3.3 Notifiche e utente (topbar globale)

Per coerenza col design di riferimento:
- Campo ricerca globale (placeholder: "Cerca in tutto il sistema…")
- Campanella notifiche con badge rosso se ci sono alert non letti
- Avatar utente + nome con dropdown (logout, impostazioni profilo)

---

## 4. Schermata Login

**Entità esposte**: solo form di autenticazione.

**Campi**:
- `username` (text)
- `password` (password)
- Bottone "Sign in"

**Stati**:
- Default
- Loading (bottone disabilitato, testo "Signing in…")
- Errore (messaggio inline rosso: "Incorrect username or password")

Logo centrato sopra il form. Sfondo `--bg`.

---

## 5. Dashboard

Schermata principale dell'applicazione. Mostra cosa è successo in un sito nel periodo selezionato.

### 5.1 Titolo contestuale

Il titolo cambia dinamicamente:
- Vista giornaliera, oggi: **"What happened today"**
- Vista giornaliera, passato: **"What happened on Mon, 2 Jun"**
- Vista settimanale: **"2 Jun – 8 Jun"**

Subtitle: `{N} events across {M} areas`

### 5.2 TimeBar — barra temporale interattiva

È il cuore dell'interazione della Dashboard. Va **preservata integralmente**.

**Struttura**:
- Header con label "Timeline · {data estesa}" a sinistra e range orario selezionato (es. `08:00 → 18:00 · 10h · 47 events`) a destra
- Track orizzontale a 24 ore con:
  - **Heatmap**: 24 colonne verticali, una per ora. Ogni colonna mostra 3 barre sovrapposte proporzionali al numero di eventi: `statistic` (grigio), `notify` (arancio), `alarm` (rosso). Altezza massima 48px normalizzata sul massimo della giornata.
  - **Finestra di selezione** (selection window): rettangolo semitrasparente trascinabile che delimita il range orario analizzato. Drag sul corpo = sposta il range. Drag sui manici laterali = ridimensiona.
  - **Dimmer**: aree fuori dalla finestra di selezione sono opacizzate
  - **Cursore "now"**: linea verticale che indica l'ora corrente (solo se visualizzato oggi)
  - Click sul track al di fuori della finestra: centra la finestra sul punto cliccato
- Tick temporali sotto il track: ogni 3 ore (00:00, 03:00, 06:00…)

**Comportamento drag**:
- `mode: move` — trascinando il corpo della finestra si sposta mantenendo la durata
- `mode: l` — trascinando il manico sinistro si modifica `from` (min span: 30 min)
- `mode: r` — trascinando il manico destro si modifica `to` (min span: 30 min)

### 5.3 Navigazione temporale

**Modalità Day (default)**:
- freccia ‹ = giorno precedente, freccia › = giorno successivo
- Label: giorno esteso (es. "Mon, 2 Jun")
- Bottone "Today" appare solo se non si è nella data odierna

**Modalità Week**:
- freccia ‹/› = settimana precedente/successiva
- Label: range settimana (es. "2 Jun – 8 Jun")
- Sotto la topbar: 7 pill di navigazione giornaliera, una per giorno della settimana
  - Ogni pill: nome giorno abbreviato, numero del giorno, conteggio eventi nel range orario selezionato
  - Pill "oggi": bordo accent
  - Pill attiva (giorno selezionato): filled accent
  - Click su una pill: entra in Day view per quel giorno

### 5.4 Griglia AreaTile

Griglia responsive di card, una per area. Ogni card espone:

**Header card**:
- Nome area (cliccabile → apre AreaDrawer)
- Badge stato semantico con punto animato (pulse): `Clear` (verde) | `{N} notify` (arancio) | `{N} alarm{s}` (rosso) | `Normal` (grigio)

**Statistiche**:
- 3 numeri: Events totali, Notify, Alarm — i valori > 0 sono colorati con il rispettivo colore semantico

**Sparkline 24h**:
- 24 barre verticali micro (una per ora), colorate per severità massima dell'ora
- Barre fuori dal range temporale selezionato: opacità ridotta
- Barre nel range: colore pieno

**Lista segnali attivi**:
- Header: "Active Signals · {N}" + badge clip count se presenti
- Per ogni segnale con eventi nel range: dot colorato (verde=attivo, grigio=disabilitato), nome segnale, conteggio eventi, icona settings
- Se nessun evento nel range: messaggio "No events in range"

**Colori bordo card**:
- `sev-alarm`: bordo `--sev-alarm`, sfondo lievemente rosato
- `sev-notify`: bordo `--sev-notify`, sfondo lievemente arancio
- `sev-statistic`: bordo `--line` con accento grigio
- `sev-ok`: bordo `--ok`, sfondo neutro

### 5.5 AreaDrawer (pannello area)

Si apre cliccando il nome dell'area nella tile. Pannello destro con due view:

**View: Lista eventi**
- Header: nome area, conteggio camere, conteggio eventi nel range
- Lista eventi ordinati più recente prima:
  - Ora (HH:MM), nome segnale, pill azione, score cosine
  - Click su riga → View Dettaglio evento

**View: Dettaglio evento** (interno al drawer)
- Navbar con: ← Back, paginatore "N / tot" con frecce prev/next
- Player video clip (con fallback "Clip non disponibile")
- Metadata clip: ID camera, orario, risoluzione
- Scheda informativa: Signal, Score, Action, Camera, LLM verdict se presente
- Bottone "Open full detail" → apre EventDrawer

### 5.6 EventDrawer (dettaglio completo evento)

Pannello destro full-detail:

**Header**: frase semantica del segnale, breadcrumb area + orario + event ID

**Sezione "Captured Frame"**: placeholder frame (o immagine se disponibile), overlay REC + camera ID + orario

**Sezione "Detection Pipeline"** — 3 step visualizzati come card orizzontali:
1. **Embedder**: score cosine (es. 0.847), barra di progresso colorata — sopra threshold = colore action, sotto = grigio
2. **Threshold**: valore soglia configurato, esito "passed" / "below threshold"
3. **Action**: azione eseguita (alarm/notify/statistic), priorità, cooldown applicato

**Sezione "Vision LLM Verdict"** (opzionale, se presente):
- Card con avatar LLM, nome modello, latenza ms, confidenza %
- Testo descrittivo del verdetto

**Sezione "Other Events · {area}"**:
- Lista ultimi 10 eventi della stessa area (escluso quello corrente)
- Click su un evento → naviga a quell'evento nel drawer

### 5.7 SignalPopover (configurazione segnale inline)

Si apre cliccando l'icona settings su un segnale nella AreaTile. Piccolo overlay inline:

**Entità**:
- Nome segnale (titolo)
- Toggle enabled / disabled
- Slider threshold (0.10 – 0.90, step 0.01) con valore numerico
- Selector azione: statistic / notify / alarm

### 5.8 LivePanel (monitor real-time)

Si apre cliccando il bottone "Live" nella topbar. Drawer destro (~420px) attivo solo se si visualizza la data odierna.

**Entità**:

**Summary bar**: stato engine — "Up to date" | "N clips in queue · M/K workers busy · ~X min"

**Pending pills**: per ogni area/camera con clip in attesa: "{area}: N pending"

**Queue card**:
- Barra workers busy / max (colore rosso se tutti occupati)
- 3 statistiche: In queue, Processed, Dropped (Dropped in rosso se > 0)
- Avg processing time

**Active jobs**: lista job correnti — camera_id, area_id, età in coda

**Camera status**: per ogni camera nota —
- Dot colorato: verde (ok) | arancio (stale > 5 min) | rosso (irraggiungibile)
- ID camera, "poll X ago", "clip X ago", clips/h se > 0

**Activity log**:
- Filter pills: All | clip_ingested | clip_processing | clip_scored | clip_dropped
- Lista eventi real-time: icona tipo, camera, segnale, score, azione, timestamp
- Icone e colori per tipo evento:
  - `clip_ingested`: accent blue (↓ ingresso)
  - `clip_processing`: grigio (rotante, in elaborazione)
  - `clip_scored`: notify orange (analitica)
  - `clip_dropped`: alarm red (eliminato)

---

## 6. Events (storico tabellare)

Tabella paginata di tutti gli eventi nel database.

**Colonne**: Time, Area, Signal, Score, Action, Priority

**Entità per riga**:
- Timestamp HH:MM:SS (monospace)
- ID area
- ID segnale
- Score cosine (monospace, 3 decimali)
- Pill azione colorata
- Priorità P1–P5

**Filtri**: (da implementare) per data range, area, azione, priorità

---

## 7. Config (panoramica sito)

Vista di sola lettura della configurazione attiva del sito.

**Header sito**:
- Nome sito, ID, tipo (es. "hotel")

**Sezione Aree** — lista card per area:
- Nome, numero camere, numero segnali assegnati

**Sezione Segnali** — lista card per segnale:
- Frase semantica, ID (monospace), priorità, azione default, threshold default
- Tag colore derivato dall'azione default

---

## 8. Setup (configurazione ambiente)

Interfaccia di configurazione avanzata. Layout senza sidebar filtri, con topnav propria.

### 8.1 TopNav Setup

- Bottone "← Dashboard" (torna alla vista principale)
- Titolo "IQFrame / Setup{/ breadcrumb}"
- Avatar + nome utente
- Bottone logout

### 8.2 Landing Setup

4 card di accesso rapido:

| Card | Icona | Descrizione | Badge |
|---|---|---|---|
| Cameras | videocam | IP camera, analytics Axis, ROI | "{N} cameras configured" |
| Signals | graph | Segnali semantici, calibrazione AI | "{N} signals in library" |
| Site settings | settings | Metadati sito, assegnazioni area-camera | — |
| Engine Logs | terminal | Log elaborazione real-time | — |

### 8.3 Camera List

**Header**: "Cameras · {N} configured", bottone "+ Add Camera"

**Lista card camera**:
- ID camera (monospace), chip IP Axis se presente, chip area
- Nome display
- Conteggio zone configurate, event ID Axis, flag people counting
- Azioni: Edit, ROI Editor, Delete (con conferma inline)

### 8.4 Camera Form (add / edit)

**Campi**:
- Camera ID (solo add, lowercase, regex `[a-z0-9_-]`)
- Display name
- Area (select, disabilitato in edit)
- Axis IP (opzionale, formato IPv4)
- Axis Event ID (opzionale)
- Toggle "People counting" (switch on/off)

**Validazione inline**: IP non valido → hint rosso

**Footer**: Cancel | "Save & continue to ROI Editor" (add) / "Save Changes" (edit)

### 8.5 ROI Editor

Editor visuale per le zone di interesse della camera.

**Toolbar**:
- Bottone "Get snapshot" (carica immagine live dalla camera)
- Toggle mode: "Draw polygon" / "Select / move"

**Canvas**:
- Sfondo: snapshot della camera (o placeholder "no image")
- SVG overlay con viewBox 1920×1080
- Zone disegnate come poligoni colorati:
  - `include`: verde `rgba(40,200,130)`, testo bianco
  - `exclude`: rosso `rgba(255,80,80)`, testo bianco
- Zona selezionata: bordo accent, punti di controllo trascinabili
- In draw mode: linee draft, punto iniziale con snap animato al chiudersi del poligono

**Pannello zone** (lista destra):
- Header "Zones · N", bottone "Add Zone"
- Per ogni zona: card collassabile
  - Header: icona expand, nome (doppio click per rinominare), badge tipo (include/exclude, cliccabile per toggle)
  - Corpo (espanso): slider rotazione (−45° a +45°), checkbox perspective quad, conteggio punti, Bottoni Preview / Delete

**Dialog "Name this zone"** (inline, appare dopo chiusura poligono):
- Input nome zona
- Toggle include / exclude
- Cancel | "Add zone"

**Zone Preview Modal** (fullscreen):
- Immagine snapshot con zona evidenziata
- Overlay: nome zona, tipo, numero punti
- Chiusura con Escape o click backdrop

**Footer barra contestuale**: istruzioni contestuali al mode corrente e allo stato del draft.

### 8.6 Signal List

**Header**: "Signal Library · {N}", ricerca testuale (ID / nome / frase), bottone "+ New Signal"

**Lista card segnale**:
- Dot colore azione, ID monospace, badge priorità, badge azione
- Nome display (se diverso dall'ID)
- Frase semantica in corsivo (ellipsis se troppo lunga)
- Metadata: threshold, zone assegnate, flag LLM attivo, flag webhook
- Azioni: Edit, Delete (con conferma inline)

### 8.7 Signal Wizard (nuovo segnale / edit)

Wizard a 4 step con stepper visuale in alto.

**Stepper**: Step dot colorati — `done` (verde, check), `active` (accent, filled), `pending` (grigio outline)

#### Step 1 — Describe

**Campi**:
- Camera context (select camera)
- "What should this camera detect?" (textarea, min 12 char per triggerare AI)
- Priorità (5 pill P1–P5, colorate)
- Action (select: statistic / notify / alarm)
- Zone applicabili (chip multi-select, solo zone include della camera selezionata)

**AI Card — Suggested semantic phrase**:
- Header con icona sparkle "AI · Suggested semantic phrase"
- Stati:
  - `empty`: "Start typing a description above…"
  - `loading`: "Generating phrase optimized for the embedder…"
  - `ready`: frase in virgolette, bottoni "Edit phrase" / "Regenerate"
  - `editing`: textarea per modifica diretta

#### Step 2 — Examples

Due colonne affiancate: **Positive examples** (verde) / **Negative examples** (rosso).

Per ogni colonna:
- Titolo + badge conteggio clip
- Descrizione scopo (cosa deve/non deve triggerare)
- **Drop zone**: area drag-and-drop per upload video (`video/*`, max 500 MB, multi-file)
- Divisore "OR CAPTURE FROM CAMERA"
- **Capture from Axis**: select camera, date, time_from, time_to, bottone "Capture clip"
- Lista clip caricate: icona video, nome file, durata/dimensione, check verde, rimozione

**Warning inline** (giallo): se negative < 3, suggerimento calibrazione migliorata.

#### Step 3 — Calibrate

**Card frase corrente**: frase semantica con bottone Edit inline. Edit + "Re-run with new phrase" triggera ricalibrazione.

**Progress bar** (durante calibrazione): barra accent con contatore N/tot.

**Due colonne score**:
- **Positive clips**: header "X/Y detected", lista ScoreRow per ogni clip
- **Negative clips**: header "X/Y correctly ignored", lista ScoreRow per ogni clip

**ScoreRow**: nome file, barra fillata proporzionale allo score, linea threshold verticale, valore numerico, icona esito (check verde / warning arancio / X rosso).

**Slider threshold**: range 0.10–0.90, step 0.01. Header con label + valore numerico. Footer "← lower (more sensitive) / higher (more strict) →"

**Contatori esito**: "X/Y positive detected" + "X/Y false positives" con icona check/cancel colorata.

**AI Suggestion card** (se disponibile): suggerimento automatico sul threshold ottimale.

#### Step 4 — Review

Riepilogo finale prima del salvataggio:

**Campi mostrati** (read-only):
- ID segnale generato (monospace, editabile)
- Display name
- Frase semantica
- Camera, zone, priorità, azione, threshold
- Conteggio clip positive / negative
- Flag escalation LLM (toggle)
- Configurazione webhook (URL notify, URL alarm primary)
- Toggle "Enabled on save"

**Bottone finale**: "Save Signal" / "Save Changes"

### 8.8 Site Settings

Visualizzazione e modifica metadata del sito.

**Sezione sito**: nome, ID, tipo

**Sezione aree**: lista aree con camere assegnate, nome area, modifica inline nomi

---

## 9. Engine Logs

Interfaccia di monitoraggio del pipeline di elaborazione video.

**Topnav**: "← Setup / Engine Logs", timestamp ultimo refresh, indicazione "auto-refresh 10s"

**Titolo**: "Engine Logs", subtitle "Last N engine events — clip processing, LLM decisions, errors."

**Filter pills** (singola selezione):
- All
- `clip_downloaded` (grigio, Download) — scaricato da camera
- `clip_ingested` (accent, Inbox) — messo in coda
- `clip_processing` (indigo, Autorenew) — in elaborazione
- `clip_scored` (sky, Analytics) — score calcolato
- `clip_dropped` (amber, Delete sweep) — eliminato (sotto threshold / cooldown)
- `llm_suppressed` (grigio scuro, Do not disturb) — soppresso da LLM
- `clip_error` (rosso, Error outline) — errore di elaborazione
- `action_fired` (verde, Check circle) — evento salvato nel DB

**Lista log entry** — per ogni entry:
- Badge tipo colorato + timestamp assoluto (HH:MM:SS) + tempo relativo ("2m ago")
- Dettagli: camera_id (monospace), area_id, signal_id, score numerico colorato, pill azione, testo detail/errore, recording_id (monospace)

**Empty state**: icona terminale + "No log entries yet. Events will appear here as the engine processes clips."

---

## 10. Stati globali e feedback

### Connettività WebSocket

| Stato | Indicatore |
|---|---|
| `connected` | Dot verde pulsante + label "live" nella sidebar |
| `connecting` | Dot arancio + label "connecting" |
| `disconnected` | Dot grigio + label "disconnected" |

### Loading

- Schermata iniziale: testo "Loading…" centrato
- Aggiornamenti parziali (eventsLoading): "…" animato inline nel titolo
- Operazioni async (save, calibrate): bottoni disabilitati con testo "Saving…" / "Calibrating…"

### Empty states

Ogni lista vuota ha:
- Icona Material Symbols grande
- Testo esplicativo
- CTA se applicabile (es. "Add Camera" / "New Signal")

### Toast

Notifica temporanea (2.4s) in basso per conferme inline: "ROI saved", "Zone 'entrance' added", "Snapshot failed: …"

### Conferma distruttiva

Pattern "inline confirm": click su Delete → appare "Cancel | Confirm delete" nello stesso posto. Nessun dialog modale per operazioni singole.

---

## 11. Accesso rapido da Setup a Logs

La pagina Setup > Landing espone una card "Engine Logs" che naviga direttamente a `/logs`. La topnav di Logs ha "← Setup" per tornare.

---

## 12. Entità dati esposte — riferimento rapido

| Entità | Attributi chiave esposti in UI |
|---|---|
| **Site** | id, name, type |
| **Area** | id, name, camera_count, signals[] |
| **Camera** | id, name, area, axis_ip, axis_event_id, people_counting, zones[] |
| **Zone** | id, name, type (include/exclude), points[], rotation, perspective |
| **Signal** | id, name, text (frase semantica), priority (1–5), default_action, default_threshold, zone[], escalation_llm, webhook, enabled |
| **Event** | event_id, area_id, signal_id, camera_id, timestamp, score, action, priority, llm_verdict, clip_path |
| **LLM Verdict** | verdict (confirmed/rejected), confidence (0–1), description, model, latency_ms |
| **Log Entry** | ts, kind, camera_id, area_id, signal_id, score, action, detail, recording_id |
| **Queue** | workers_busy, max_workers, queue_depth, processed_count, dropped_count, avg_latency_ms |
| **Camera Status** | reachable, last_poll_at, last_clip_at, clips_last_hour |
