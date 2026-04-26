# Configurazione — VisionSemanticAgent

Guida completa alla struttura dei file di configurazione YAML, alla gestione delle zone ROI e all'uso dell'editor grafico.

---

## Struttura directory

```
config/
├── site.yaml                  # struttura del sito: aree, cam, signal attivi
├── signals/
│   ├── hotel.yaml             # libreria signal per tipo struttura
│   └── custom.yaml            # signal specifici del cliente (sovrascrivono hotel.yaml)
└── cameras/
    ├── cam_kitchen_01.yaml    # preprocessing e zone per singola camera
    └── cam_lobby_01.yaml
```

---

## `site.yaml`

Punto di ingresso della configurazione. Definisce il sito, le aree logiche e quale signal è attivo per quale area.

```yaml
site:
  id: tc
  name: The Castelletto
  type: hotel
  signal_library:
    - config/signals/hotel.yaml    # caricato per primo
    - config/signals/custom.yaml   # sovrascrive hotel.yaml per stesso id
  alert_cooldown_sec: 300          # default globale per tutte le aree

areas:
  - id: kitchen
    name: Ager Patris Lounge
    type: indoor_public
    alert_cooldown_sec: 180        # override: kitchen più reattiva
    cameras: [cam_kitchen_01]
    signals:
      - id: eating_drinking
      - id: cabinet_opened
        action_override: alarm     # override solo action per quest'area
      - id: person_count_stat
        enabled: false             # signal temporaneamente disabilitato
```

### Campi `area`

| Campo | Tipo | Default | Descrizione |
|-------|------|---------|-------------|
| `id` | string | — | Identificatore univoco snake_case |
| `name` | string | — | Nome leggibile dell'area |
| `type` | string | — | `indoor_public`, `indoor_semipublic`, `outdoor` |
| `alert_cooldown_sec` | int | globale | Cooldown minimo tra alert per questa area |
| `cameras` | list[string] | — | ID camera presenti nell'area |
| `signals` | list | — | Signal attivi per questa area |

### Campi override signal in area

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `id` | string | ID del signal nella libreria |
| `threshold_override` | float | Sovrascrive `default_threshold` del signal |
| `action_override` | string | Sovrascrive `default_action`: `statistic`, `notify`, `alarm` |
| `time_filter` | object | `{from: "HH:MM", to: "HH:MM"}` — attivo solo in quest'orario |
| `enabled` | bool | `false` per disabilitare temporaneamente |

---

## `signals/hotel.yaml`

Libreria di signal riusabili. Un signal descrive in linguaggio naturale un comportamento da rilevare.

```yaml
signals:
  - id: eating_drinking
    name: "Eating or Drinking"
    text: "a person eating food or drinking from a cup, glass or bottle"
    priority: 4
    default_threshold: 0.20
    default_action: statistic
    escalation_llm: false
    zone:
      - tables
      - counter

  - id: cabinet_opened
    name: "Cabinet Opened"
    text: "a person standing at or opening a locked storage unit, accessing items inside"
    priority: 2
    default_threshold: 0.40
    default_action: notify
    escalation_llm: true
    llm_prompt_key: cabinet_access
    zone: cabinet
```

### Campi signal

| Campo | Tipo | Default | Descrizione |
|-------|------|---------|-------------|
| `id` | string | — | Identificatore univoco snake_case |
| `name` | string | id | Nome leggibile per la UI |
| `text` | string | — | Frase in inglese che descrive il comportamento |
| `priority` | int 1–5 | 3 | 1=critico, 5=informativo. Determina posizione in coda |
| `default_threshold` | float 0–1 | 0.50 | Soglia cosine similarity |
| `default_action` | enum | `statistic` | `statistic` \| `notify` \| `alarm` |
| `escalation_llm` | bool | false | Se true (e action ≠ statistic): chiama LLM vision |
| `llm_prompt_key` | string | null | Chiave nel catalogo prompt. Null = prompt generico |
| `cooldown_sec` | int | 300 | Intervallo minimo tra alert per `(area, signal)` |
| `time_filter` | object | null | `{from: "HH:MM", to: "HH:MM"}`. Supporta overnight (es. 22:00–07:00) |
| `source` | enum | `embedder` | `embedder` \| `native_axis` (bypassa l'embedder) |
| `zone` | string \| list[string] | null | Nome zona(e) ROI della camera su cui valutare il signal |

### Merge librerie

Le librerie in `signal_library` vengono caricate in ordine. Se due librerie definiscono lo stesso `id`, **vince l'ultima** (last-wins). Usa `custom.yaml` per sovrascrivere signal di `hotel.yaml` senza modificarlo.

```yaml
# custom.yaml — abbassa la soglia di cabinet_opened per questa struttura
signals:
  - id: cabinet_opened
    text: "a person standing at or opening a locked storage unit"
    priority: 1
    default_threshold: 0.35
    default_action: alarm
    escalation_llm: true
```

---

## `cameras/cam_*.yaml`

Configurazione per singola camera: connessione Axis, preprocessing ROI e zone.

```yaml
id: cam_kitchen_01
name: Ager Patris Lounge
area: kitchen
axis_ip: 10.46.67.5
axis_event_id: cabinet           # event_id VAPIX per list_recordings

preprocessing:
  roi:
    enabled: true
    zones:
      - name: tables
        polygon:
          - [62, 442]
          - [258, 932]
          - [514, 652]
          - [740, 540]
          - [660, 174]
        rotation: -23
        perspective_quad:
          - [34, 72]
          - [754, 30]
          - [876, 1008]
          - [62, 932]

      - name: windows
        polygon:
          - [12, 232]
          - [608, 24]
          - [642, 186]
          - [58, 434]
        exclude: true             # questa zona viene mascherata (nero)

native_analytics:
  people_counting: true
  cross_line: false
```

### Campi camera

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `id` | string | Deve coincidere con il nome del file (senza `.yaml`) |
| `area` | string | ID area in `site.yaml` a cui appartiene la camera |
| `axis_ip` | string | IP o hostname della camera (con o senza `http://`) |
| `axis_user` / `axis_pass` | string | Opzionali: usa valori da `.env` se assenti |
| `axis_event_id` | string | Event ID VAPIX per `list_recordings` (es. `cabinet`, `motion`) |
| `preprocessing.roi.enabled` | bool | Abilita il sistema zone |
| `preprocessing.roi.zones` | list | Lista zone (vedi sotto) |
| `native_analytics.people_counting` | bool | Usa API Axis per conteggio persone invece dell'embedder |

### Schema zona

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `name` | string | Identificatore zona — corrisponde al campo `zone` del signal |
| `polygon` | list[[x,y]] | Vertici del poligono (coordinate pixel del frame originale) |
| `exclude` | bool | Se true, la zona viene azzerata (nero) invece di essere ritagliata |
| `rotation` | float | Rotazione in gradi da applicare al crop (−45 → +45) |
| `perspective_quad` | list[[x,y]] | 4 punti per correzione prospettica (angoli reali → rettangolo) |

---

## `.env`

Variabili di ambiente lette da `config/loader.py`. Non committare mai questo file.

```dotenv
# Servizi AI
EMBEDDING_SERVICE_URL=http://10.40.65.53:6755
LLM_BASE_URL=http://10.40.65.53:11434
LLM_VISION_MODEL=Galene/VLM-Instruct
LLM_API_KEY=

# Dimensioni frame
FRAME_SIZE_EMBEDDER=224          # risoluzione frame → embedder (px)
FRAME_SIZE_LLM=768               # risoluzione frame → LLM in escalation (px)

# Estrazione frame con variabilità
EMBED_FPS=2                      # FPS a cui campionare il clip
EMBED_WINDOW_SEC=4               # secondi per finestra (embed_fps × embed_window_sec frame)
EMBED_MAX_WINDOWS=5              # max finestre per clip (0 = illimitato)
EMBED_MIN_FRAME_DIFF=0.05        # soglia MAD/255 per scartare frame simili

# LLM
LLM_MAX_CALLS=5                  # max chiamate LLM per clip in escalation
LLM_TIMEOUT=280                  # timeout in secondi per risposta LLM

# Axis
AXIS_USERNAME=admin
AXIS_PASSWORD=changeme
AXIS_POLL_INTERVAL_SEC=10
AXIS_DOWNLOAD_FPS=4              # FPS per il download clip da VAPIX

# Storage
CLIP_TEMP_DIR=data/clips_temp
CLIP_STORAGE_DIR=data/clips
LANCEDB_PATH=data/lancedb

# Output
WEBHOOK_DEFAULT_URL=http://localhost:8000/api/internal/alert

# API
API_USERNAME=admin
API_PASSWORD=vsa2025!
JWT_SECRET=change-me-in-production

# Runtime
LOG_LEVEL=INFO
```

---

## Zone Editor

Editor grafico browser-based per disegnare poligoni ROI, applicare rotazioni e correzioni prospettiche, e salvarli nel YAML della camera.

### Avvio

```bash
source .venv/bin/activate

python tools/zone_editor.py \
    --video  video-test/kitchen_sample.mp4 \
    --camera config/cameras/cam_kitchen_01.yaml
```

Il browser si apre automaticamente su `http://127.0.0.1:8765`. Premi `Ctrl+C` nel terminale per chiudere.

Porta alternativa:

```bash
python tools/zone_editor.py --video VIDEO.mp4 --camera CAM.yaml --port 9000
```

### Interfaccia

L'editor ha tre pannelli principali:

**Navigatore frame** — slider per scorrere il video e scegliere il frame rappresentativo su cui disegnare. Conviene scegliere un frame con la scena tipica (persone sedute, oggetti al posto).

**Canvas** — visualizza il frame corrente con le zone disegnate sovrapposte. Ogni zona ha un colore diverso; le zone `exclude` appaiono rosse semitrasparenti.

**Pannello zone** — lista delle zone con pulsanti per aggiungere, selezionare, modificare e cancellare.

**Preview crop** — riquadro 280×280 che mostra in tempo reale il risultato del crop per la zona selezionata, con rotazione e prospettiva applicati.

### Workflow: aggiungere una zona

1. Naviga allo slider del frame per trovare un momento rappresentativo
2. Click **"+ Aggiungi zona"**
3. Assegna un nome (deve corrispondere al campo `zone` nel signal YAML, es. `tables`)
4. Click sul canvas per aggiungere i vertici del poligono — il poligono si chiude automaticamente
5. Verifica la preview crop in basso a destra
6. Se la zona è da mascherare (es. finestre, specchi), spunta **"Zona exclude"**

### Correzione rotazione

Se la zona è inclinata (es. tavolo non allineato con l'asse orizzontale):

1. Seleziona la zona nella lista
2. Usa lo **slider Rotazione** (−45° → +45°) per ruotare il crop
3. La preview si aggiorna in tempo reale

### Correzione prospettica

Per correggere distorsioni prospettiche (es. ripresa dall'alto o laterale):

1. Seleziona la zona
2. Click **"Modifica prospettiva"**
3. Appaiono 4 handle rossi ai vertici del poligono
4. Trascina ogni handle sull'angolo reale dell'oggetto nel frame
5. La prospettiva viene corretta nella preview: i bordi paralleli dell'oggetto appaiono paralleli nel crop

### Zona exclude

Le zone exclude mascherano aree che disturbano il rilevamento (es. finestre con luce diretta, specchi):

1. Click **"+ Aggiungi zona"**
2. Assegna un nome descrittivo (es. `windows`)
3. Disegna il poligono sull'area da escludere
4. Spunta **"Zona exclude"**

Le zone exclude vengono applicate dopo tutte le zone include: i pixel dentro zone exclude vengono azzerati (nero) nel frame prima del resize.

### Salvataggio

Click **"Salva YAML"** — le zone vengono scritte nel file YAML della camera preservando tutto il resto della configurazione (`axis_ip`, `native_analytics`, ecc.).

**Il file YAML viene sovrascritto in-place.** Prima di fare modifiche significative, considera di fare un backup:

```bash
cp config/cameras/cam_kitchen_01.yaml config/cameras/cam_kitchen_01.yaml.bak
```

### Formato YAML generato

```yaml
preprocessing:
  roi:
    enabled: true
    zones:
      - name: tables
        polygon:
          - [62, 442]
          - [258, 932]
          - [514, 652]
          - [740, 540]
          - [660, 174]
        rotation: -23.0
        perspective_quad:
          - [34, 72]
          - [754, 30]
          - [876, 1008]
          - [62, 932]
      - name: windows
        polygon:
          - [12, 232]
          - [608, 24]
          - [642, 186]
          - [58, 434]
        exclude: true
```

### Collegare zone ai signal

Dopo aver salvato le zone, aggiorna i signal in `signals/hotel.yaml` (o `custom.yaml`) per indicare su quale zona valutarli:

```yaml
- id: eating_drinking
  text: "a person eating food or drinking"
  zone:
    - tables
    - counter

- id: cabinet_opened
  text: "a person opening a locked storage unit"
  zone: cabinet          # stringa singola se solo una zona
```

Se `zone` è assente o `null`, il signal viene valutato sulla prima zona include della camera (default).

---

## Ricaricare la configurazione a caldo

L'engine in esecuzione può ricaricare `site.yaml` e le librerie signal senza riavvio:

```bash
kill -HUP $(pgrep -f "engine.main")
```

Il reload aggiorna: aree, signal, soglie, time_filter, cooldown. Non aggiorna le coordinate delle zone nelle camera YAML (queste richiedono un riavvio).
