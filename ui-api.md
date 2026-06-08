# IQFrame — API Reference for Frontend / Mockup

> Documenta ogni endpoint consumato dal frontend, con payload request, shape response e note di utilizzo UI. Gli endpoint interni (engine → API) non sono inclusi.

---

## Autenticazione

### Meccanismo

Il frontend utilizza **due** schemi di autenticazione distinti:

| Schema | Usato per | Header |
|---|---|---|
| JWT (Bearer) | Dashboard, eventi, live, log, clip, config summary | `Authorization: Bearer <token>` |
| Config API Key | Setup wizard, CRUD config (cameras, signals, areas, site, prompts) | `Authorization: Bearer <CONFIG_API_KEY>` |

Il JWT si ottiene da `POST /api/auth/login`, scade dopo **24 ore** e va salvato in `localStorage` con chiave `vsa_token`.

La Config API Key è un segreto d'ambiente (`CONFIG_API_KEY`); il frontend la legge da `VITE_CONFIG_API_KEY` a build time.

---

## 1. Auth

### `POST /api/auth/login`

Login con credenziali. Risponde con token JWT.

**Request** — `application/x-www-form-urlencoded` (OAuth2 password form):

```
username=admin&password=changeme
```

**Response 200:**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiJ9...",
  "token_type": "bearer",
  "username": "admin"
}
```

**Response 401:**

```json
{ "detail": "Incorrect username or password" }
```

**UI:** pagina Login. Salva `access_token` e `username` in localStorage. Ridirige a `/`.

---

## 2. Dashboard — eventi storici

### `GET /api/events`

Legge eventi storici da LanceDB. Auth: **JWT**.

**Query params:**

| Param | Tipo | Default | Descrizione |
|---|---|---|---|
| `area_id` | string | — | Filtra per area |
| `signal_id` | string | — | Filtra per segnale |
| `limit` | int | 500 (max 2000) | Numero massimo di eventi |
| `since` | ISO datetime | — | Filtra da questa data/ora |
| `date_from` | `YYYY-MM-DD` | — | Inizio intervallo (00:00:00 UTC) |
| `date_to` | `YYYY-MM-DD` | — | Fine intervallo (23:59:59 UTC) |

**Response 200:**

```json
{
  "count": 47,
  "events": [
    {
      "event_id": "evt_abc123",
      "area_id": "kitchen",
      "signal_id": "smoking",
      "camera_id": "cam_kitchen_01",
      "timestamp": "2025-06-02T14:37:22.000Z",
      "score": 0.8471,
      "action": "notify",
      "priority": 2,
      "clip_path": "/data/clips/kitchen/evt_abc123.mp4",
      "llm_verdict_confirmed": true,
      "llm_verdict_confidence": 0.92,
      "llm_verdict_description": "A person is holding a cigarette near the counter area.",
      "area_name": "Kitchen",
      "signal_text": "a person holding a cigarette..."
    }
  ]
}
```

**Campi evento** (`events[]`):

| Campo | Tipo | Note |
|---|---|---|
| `event_id` | string | ID univoco evento |
| `area_id` | string | ID area |
| `signal_id` | string | ID segnale che ha triggerato |
| `camera_id` | string \| null | ID camera |
| `timestamp` | ISO 8601 string | Data/ora UTC dell'evento |
| `score` | float | Cosine similarity (0–1) |
| `action` | `"statistic"` \| `"notify"` \| `"alarm"` | Azione eseguita |
| `priority` | int 1–5 | Priorità (1=critico) |
| `clip_path` | string \| null | Path locale o `"axis:{cam}:{rec}:{disk}"` |
| `llm_verdict_confirmed` | bool \| null | Verdetto LLM se escalation attiva |
| `llm_verdict_confidence` | float \| null | Confidenza LLM (0–1) |
| `llm_verdict_description` | string \| null | Testo descrittivo del verdetto |
| `area_name` | string \| null | Nome leggibile area |
| `signal_text` | string \| null | Frase semantica del segnale |

**UI:** chiamato al cambio di data/range nella Dashboard. `date_from`/`date_to` per day view, stessa logica per week view. Risultato mescolato con live alerts via WebSocket per la data odierna.

---

## 3. Dashboard — configurazione sito

### `GET /api/config`

Config summary del sito, senza credenziali. Auth: **JWT**.

**Response 200:**

```json
{
  "site": {
    "id": "tc",
    "name": "The Castelletto",
    "type": "hotel",
    "webhook_url": null
  },
  "areas": [
    {
      "id": "kitchen",
      "name": "Kitchen",
      "type": "indoor_public",
      "cameras": ["cam_kitchen_01", "cam_kitchen_02"],
      "camera_count": 2,
      "webhook_url": null,
      "signals": [
        {
          "signal_id": "smoking",
          "enabled": true,
          "threshold_override": null,
          "action_override": null
        }
      ]
    }
  ],
  "signals": [
    {
      "id": "smoking",
      "name": "Smoking Detected",
      "text": "a person holding a cigarette...",
      "priority": 2,
      "default_threshold": 0.43,
      "default_action": "notify",
      "escalation_llm": true,
      "source": "embedder",
      "cooldown_sec": 300
    }
  ]
}
```

**Struttura `areas[]`:**

| Campo | Tipo | Descrizione |
|---|---|---|
| `id` | string | ID area |
| `name` | string | Nome leggibile |
| `type` | string | Tipo area (`indoor_public`, `indoor_restricted`, `outdoor`) |
| `cameras` | string[] | Lista ID camere assegnate |
| `camera_count` | int | Numero camere |
| `webhook_url` | string \| null | Webhook specifico dell'area |
| `signals[]` | object[] | Override segnali per l'area |
| `signals[].signal_id` | string | Riferimento al segnale in library |
| `signals[].enabled` | bool | Attivo per questa area |
| `signals[].threshold_override` | float \| null | Soglia locale (null = usa default) |
| `signals[].action_override` | string \| null | Azione locale (null = usa default) |

**Struttura `signals[]`:**

| Campo | Tipo | Descrizione |
|---|---|---|
| `id` | string | ID univoco segnale |
| `name` | string | Nome leggibile |
| `text` | string | Frase semantica per embedding |
| `priority` | int 1–5 | Priorità default |
| `default_threshold` | float | Soglia cosine similarity default |
| `default_action` | `"statistic"` \| `"notify"` \| `"alarm"` | Azione default |
| `escalation_llm` | bool | Richiede conferma LLM |
| `source` | `"embedder"` \| `"native_axis"` | Sorgente di valutazione |
| `cooldown_sec` | int | Cooldown tra alert consecutivi |

**UI:** chiamato una sola volta al caricamento della Dashboard; popola le aree nella griglia e la sidebar.

---

## 4. Dashboard — live alerts (WebSocket)

### `WebSocket /api/ws?token=<JWT>`

Connessione WebSocket per ricevere alert in tempo reale. Token JWT passato come query param (non come header, poiché `<video src>` e WebSocket non supportano header custom).

**Messaggi ricevuti** (JSON):

#### Tipo: `alert`
Evento di detection in tempo reale:

```json
{
  "type": "alert",
  "event_id": "evt_abc123",
  "area_id": "kitchen",
  "signal_id": "smoking",
  "camera_id": "cam_kitchen_01",
  "score": 0.847,
  "action": "notify",
  "priority": 2,
  "timestamp": "2025-06-02T14:37:22Z",
  "area_name": "Kitchen",
  "signal_text": "a person holding a cigarette...",
  "clip_path": "/data/clips/...",
  "llm_verdict": {
    "confirmed": true,
    "confidence": 0.92,
    "description": "Person holding cigarette near counter."
  }
}
```

#### Tipo: `engine_heartbeat`
Stato periodico del motore (~ogni 5s):

```json
{
  "type": "engine_heartbeat",
  "data": {
    "queue_depth": 3,
    "processed_count": 142,
    "dropped_count": 5,
    "avg_latency_ms": 3200.0,
    "workers_busy": 2,
    "max_workers": 4,
    "cameras": [
      {
        "camera_id": "cam_kitchen_01",
        "last_clip_at": 1717335420.0,
        "clips_last_hour": 12,
        "reachable": true
      }
    ],
    "pending_by_camera": { "cam_kitchen_01": 2 },
    "pending_by_area": { "kitchen": 2 },
    "current_jobs": [
      {
        "camera_id": "cam_kitchen_01",
        "area_id": "kitchen",
        "recording_id": "rec_001",
        "enqueued_at": 1717335410.0
      }
    ]
  }
}
```

#### Tipo: `engine_event`
Singolo evento di attività del motore:

```json
{
  "type": "engine_event",
  "data": {
    "kind": "clip_scored",
    "camera_id": "cam_kitchen_01",
    "area_id": "kitchen",
    "signal_id": "smoking",
    "recording_id": "rec_001",
    "score": 0.847,
    "action": "notify",
    "detail": null,
    "ts": 1717335422.5
  }
}
```

**UI:** il hook `useAlerts` mantiene un buffer degli ultimi 100 alert. Lo stato WebSocket (`connected` | `connecting` | `disconnected`) è mostrato nella sidebar. Gli `engine_heartbeat` alimentano il LivePanel. Gli `engine_event` alimentano l'ActivityLog nel LivePanel.

---

## 5. Dashboard — live status (polling fallback)

### `GET /api/live/status`

Snapshot istantaneo dello stato del motore. Auth: **JWT**. Usato all'apertura del LivePanel per ottenere lo stato iniziale prima che arrivino heartbeat via WebSocket.

**Response 200:**

```json
{
  "queue": {
    "queue_depth": 3,
    "processed_count": 142,
    "dropped_count": 5,
    "avg_latency_ms": 3200.0,
    "workers_busy": 2,
    "max_workers": 4,
    "_ts": 1717335422.5
  },
  "cameras": {
    "cam_kitchen_01": {
      "camera_id": "cam_kitchen_01",
      "last_clip_at": 1717335420.0,
      "clips_last_hour": 12,
      "reachable": true,
      "last_poll_at": 1717335415.0,
      "_ts": 1717335422.5
    }
  },
  "activity": [
    {
      "kind": "clip_scored",
      "camera_id": "cam_kitchen_01",
      "area_id": "kitchen",
      "signal_id": "smoking",
      "score": 0.847,
      "action": "notify",
      "ts": 1717335422.5
    }
  ],
  "pending_summary": {
    "pending_by_camera": { "cam_kitchen_01": 2 },
    "pending_by_area": { "kitchen": 2 },
    "current_jobs": []
  },
  "server_ts": 1717335422.5
}
```

**Campi queue:**

| Campo | Tipo | Descrizione |
|---|---|---|
| `queue_depth` | int | Clip in attesa di elaborazione |
| `processed_count` | int | Clip elaborate totali (sessione) |
| `dropped_count` | int | Clip scartate (sotto soglia o cooldown) |
| `avg_latency_ms` | float | Latenza media elaborazione clip (ms) |
| `workers_busy` | int | Worker thread attivi |
| `max_workers` | int | Worker thread totali disponibili |
| `_ts` | float | Unix timestamp dell'ultimo heartbeat |

**Campi cameras[camera_id]:**

| Campo | Tipo | Descrizione |
|---|---|---|
| `camera_id` | string | ID camera |
| `reachable` | bool | Camera raggiungibile |
| `last_clip_at` | float \| null | Unix timestamp ultima clip ricevuta |
| `last_poll_at` | float \| null | Unix timestamp ultimo polling |
| `clips_last_hour` | int | Clip ricevute nell'ultima ora |

**Campi activity[]:**

| Campo | Tipo | Valori | Descrizione |
|---|---|---|---|
| `kind` | string | Vedi tabella sotto | Tipo evento |
| `camera_id` | string \| null | | Camera coinvolta |
| `area_id` | string \| null | | Area coinvolta |
| `signal_id` | string \| null | | Segnale coinvolto |
| `recording_id` | string \| null | | ID registrazione |
| `score` | float \| null | | Score cosine similarity |
| `action` | string \| null | `statistic`, `notify`, `alarm` | Azione eseguita |
| `detail` | string \| null | | Messaggio errore o nota |
| `ts` | float | | Unix timestamp |

**Valori `kind`:**

| Kind | Icona UI | Colore |
|---|---|---|
| `clip_downloaded` | download | `#94a3b8` grigio |
| `clip_ingested` | inbox | accent blue |
| `clip_processing` | autorenew | `#6366f1` indigo |
| `clip_scored` | analytics | `#0ea5e9` sky |
| `clip_dropped` | delete_sweep | `#f59e0b` amber |
| `llm_suppressed` | do_not_disturb | grigio scuro |
| `clip_error` | error_outline | `#ef4444` rosso |
| `action_fired` | check_circle | `#10b981` verde |

### `GET /api/live/queue-detail`

Dettaglio della coda con pending per camera/area e job correnti. Auth: **JWT**.

**Response 200:**

```json
{
  "pending_by_camera": { "cam_kitchen_01": 2 },
  "pending_by_area": { "kitchen": 2 },
  "current_jobs": [
    {
      "camera_id": "cam_kitchen_01",
      "area_id": "kitchen",
      "recording_id": "rec_001",
      "enqueued_at": 1717335410.0
    }
  ],
  "server_ts": 1717335422.5
}
```

---

## 6. Dashboard — statistiche orarie

### `GET /api/stats`

Statistiche aggregate per ora. Auth: **JWT**.

**Query params:**

| Param | Tipo | Descrizione |
|---|---|---|
| `area_id` | string | Filtra per area |
| `date` | `YYYY-MM-DD` | Filtra per giorno |

**Response 200:**

```json
{
  "count": 24,
  "stats": [
    {
      "area_id": "kitchen",
      "date": "2025-06-02",
      "hour": 14,
      "total_events": 5,
      "alarm_count": 1,
      "notify_count": 2,
      "statistic_count": 2
    }
  ]
}
```

**UI:** non usato direttamente nella Dashboard MVP; usato per grafico StatsChart.

---

## 7. Dashboard — clip video

### `GET /api/clips/{event_id}?token=<JWT>`

Serve la clip MP4 associata a un evento. Auth: JWT come **query param** (obbligatorio perché usato in tag `<video src>`).

**Path param:** `event_id` — ID dell'evento

**Query param:** `token` — JWT

**Response 200:** `video/mp4` stream (FileResponse o StreamingResponse proxy Axis)

**Response 404:** evento non trovato o nessuna clip associata

```json
{ "detail": "No clip for this event" }
```

**Response 410:** clip su camera Axis non più disponibile

```json
{ "detail": "Video no longer available on camera" }
```

**UI:** usato in `<video src="/api/clips/{event.id}?token=...">` nell'AreaDrawer e nell'EventDrawer.

---

## 8. Log motore

### `GET /api/logs`

Ultimi log di attività del motore (buffer in-memory, max 200). Auth: **JWT**.

**Query params:**

| Param | Tipo | Default | Descrizione |
|---|---|---|---|
| `limit` | int | 100 (max 200) | Numero massimo di entry |
| `kind` | string | — | Filtra per tipo evento (vedi tabella kind sopra) |

**Response 200:**

```json
{
  "count": 42,
  "entries": [
    {
      "kind": "clip_scored",
      "camera_id": "cam_kitchen_01",
      "area_id": "kitchen",
      "signal_id": "smoking",
      "recording_id": "rec_20250602T143700_cam_kitchen_01",
      "score": 0.847,
      "action": "notify",
      "detail": null,
      "ts": 1717335422.5
    }
  ]
}
```

**UI:** pagina Logs. Auto-refresh ogni 10 secondi via `setInterval`. Filter pills per `kind`.

---

## 9. Config — Camera CRUD

Auth: **Config API Key** per tutti gli endpoint di questa sezione.

### `GET /api/config/cameras`

Lista tutte le camere. Credenziali Axis **non incluse**.

**Response 200:** `CameraRead[]`

```json
[
  {
    "id": "cam_kitchen_01",
    "name": "Ager Patris Lounge",
    "area": "kitchen",
    "axis_ip": "10.46.67.5",
    "axis_channel": null,
    "axis_user": null,
    "axis_event_id": "cabinet",
    "preprocessing": {
      "roi": {
        "enabled": true,
        "zones": [
          {
            "name": "counter",
            "polygon": [[100, 200], [400, 200], [400, 600], [100, 600]],
            "exclude": false,
            "rotation": 0,
            "perspective_quad": null
          }
        ]
      }
    },
    "native_analytics": {
      "people_counting": true
    }
  }
]
```

**Schema `CameraRead`:**

| Campo | Tipo | Descrizione |
|---|---|---|
| `id` | string | ID camera (lowercase, a-z0-9_-) |
| `name` | string | Nome leggibile |
| `area` | string | ID area di appartenenza |
| `axis_ip` | string | IP camera Axis |
| `axis_channel` | int \| null | Canale ottica (multi-optics, 1-based) |
| `axis_user` | string \| null | Username Axis (null = variabile globale) |
| `axis_event_id` | string \| null | Event ID VAPIX per trigger registrazione |
| `preprocessing` | object | Configurazione preprocessing (ROI) |
| `preprocessing.roi.enabled` | bool | ROI attivo |
| `preprocessing.roi.zones[]` | object[] | Zone definite |
| `native_analytics` | object | Configurazione analytics native Axis |
| `native_analytics.people_counting` | bool | People counting attivo |

**Schema zona ROI** (`zones[]`):

| Campo | Tipo | Descrizione |
|---|---|---|
| `name` | string | Nome zona |
| `polygon` | `[[x, y], ...]` | Vertici in pixel 1920×1080 |
| `exclude` | bool | `true` = zona di esclusione, `false` = inclusione |
| `rotation` | int | Rotazione in gradi (−45 a +45) |
| `perspective_quad` | `[[x, y], ...]` \| null | Rettangolo prospettico (4 punti) |

---

### `GET /api/config/cameras/{camera_id}`

Singola camera. **Response:** `CameraRead` (stesso schema sopra).

---

### `POST /api/config/cameras`

Crea nuova camera. **Request body** `CameraCreate`:

```json
{
  "id": "cam_kitchen_01",
  "name": "Ager Patris Lounge",
  "area": "kitchen",
  "axis_ip": "10.46.67.5",
  "axis_channel": null,
  "axis_user": null,
  "axis_event_id": "cabinet",
  "native_analytics": { "people_counting": false }
}
```

**Response 201:** `CameraRead`

**Response 409:** `{ "detail": "Camera 'cam_kitchen_01' already exists" }`

**Response 404:** `{ "detail": "Area 'kitchen' not found in site.yaml" }`

---

### `PATCH /api/config/cameras/{camera_id}`

Aggiorna camera (campi parziali). **Request body** `CameraPatch`:

```json
{
  "name": "Nuovo nome",
  "axis_ip": "10.46.67.6",
  "axis_event_id": "entrance",
  "preprocessing": {
    "roi": {
      "enabled": true,
      "zones": [
        {
          "name": "counter",
          "polygon": [[100, 200], [400, 200], [400, 600], [100, 600]],
          "exclude": false,
          "rotation": 0
        }
      ]
    }
  },
  "native_analytics": { "people_counting": true }
}
```

> Il campo `preprocessing` sostituisce **integralmente** la configurazione ROI. Inviare le zone complete aggiornate ogni volta.

**Response 200:** `CameraRead`

---

### `DELETE /api/config/cameras/{camera_id}`

Elimina camera e la rimuove dalla lista camere dell'area.

**Response 204:** No content

---

### `GET /api/config/cameras/{camera_id}/snapshot`

Snapshot JPEG live dalla camera Axis via VAPIX.

**Response 200:** `image/jpeg`

**Response 404:** camera non trovata o senza IP

**Response 502:** camera irraggiungibile

**UI:** bottone "Get snapshot" nel ROI Editor. Risultato mostrato come sfondo del canvas SVG.

---

## 10. Config — Signal CRUD

Auth: **Config API Key**.

### `GET /api/config/signals`

Lista tutti i segnali da tutte le librerie.

**Response 200:** `SignalRead[]`

```json
[
  {
    "id": "smoking",
    "name": "Smoking Detected",
    "text": "a person holding a cigarette between their fingers, hand raised near their face, thin smoke trail visible",
    "priority": 2,
    "default_threshold": 0.43,
    "default_action": "notify",
    "escalation_llm": true,
    "llm_prompt_key": "smoking_context",
    "source": "embedder",
    "cooldown_sec": 300,
    "zone": ["tables", "counter"],
    "temporal_context_sec": 2,
    "webhook": {
      "notify": { "url": "https://hooks.example.com/notify", "retries": 3 },
      "alarm_primary": null,
      "alarm_fallback": null
    }
  }
]
```

**Schema `SignalRead`:**

| Campo | Tipo | Descrizione |
|---|---|---|
| `id` | string | ID univoco segnale |
| `name` | string \| null | Nome leggibile (null = usa id) |
| `text` | string | Frase semantica per embedding |
| `priority` | int 1–5 | 1=critico, 5=informativo |
| `default_threshold` | float | Soglia cosine similarity (−1.0 – 1.0, tipico 0.35–0.55) |
| `default_action` | ActionType | `statistic` \| `notify` \| `alarm` |
| `escalation_llm` | bool | Richiede conferma LLM prima di salvare |
| `llm_prompt_key` | string \| null | Chiave nel catalogo prompt LLM |
| `source` | `"embedder"` \| `"native_axis"` | Sorgente |
| `cooldown_sec` | int | Secondi tra alert consecutivi dello stesso segnale |
| `zone` | string[] \| null | Zone a cui si applica (null = tutte) |
| `temporal_context_sec` | int | Secondi di contesto video inviati all'LLM (0 = disabilitato) |
| `webhook` | object \| null | Configurazione webhook per azione |
| `webhook.notify` | `{url, retries}` \| null | Webhook per azione `notify` |
| `webhook.alarm_primary` | `{url, retries}` \| null | Webhook primario per `alarm` |
| `webhook.alarm_fallback` | `{url, retries}` \| null | Webhook fallback per `alarm` |

---

### `GET /api/config/signals/{signal_id}`

Singolo segnale. **Response:** `SignalRead`.

---

### `POST /api/config/signals`

Crea segnale nella libreria custom. **Request body** `SignalCreate`:

```json
{
  "id": "cabinet_access",
  "name": "Cabinet Access",
  "text": "a person opening or reaching into a cabinet with arm extended",
  "priority": 3,
  "default_threshold": 0.43,
  "default_action": "notify",
  "escalation_llm": false,
  "llm_prompt_key": null,
  "source": "embedder",
  "cooldown_sec": 300,
  "zone": ["counter"],
  "temporal_context_sec": 0,
  "webhook": null
}
```

**Response 201:** `SignalRead`

**Response 409:** `{ "detail": "Signal 'cabinet_access' already exists" }`

---

### `PATCH /api/config/signals/{signal_id}`

Aggiornamento parziale. **Request body** `SignalPatch` (tutti i campi opzionali):

```json
{
  "default_threshold": 0.48,
  "escalation_llm": true,
  "webhook": {
    "notify": { "url": "https://...", "retries": 3 }
  }
}
```

**Response 200:** `SignalRead`

---

### `DELETE /api/config/signals/{signal_id}`

**Response 204:** No content

---

## 11. Config — Area CRUD

Auth: **Config API Key**.

### `GET /api/config/areas`

Lista tutte le aree.

**Response 200:** `AreaRead[]`

```json
[
  {
    "id": "kitchen",
    "name": "Kitchen",
    "type": "indoor_public",
    "alert_cooldown_sec": null,
    "webhook_url": null,
    "cameras": ["cam_kitchen_01"],
    "signals": [
      {
        "id": "smoking",
        "enabled": true,
        "threshold_override": null,
        "action_override": null,
        "escalation_llm_override": null,
        "llm_prompt_key_override": null,
        "time_filter": null
      }
    ]
  }
]
```

**Schema `AreaRead`:**

| Campo | Tipo | Descrizione |
|---|---|---|
| `id` | string | ID area |
| `name` | string | Nome leggibile |
| `type` | string | `indoor_public`, `indoor_restricted`, `outdoor` |
| `alert_cooldown_sec` | int \| null | Cooldown area-specifico (null = usa sito) |
| `webhook_url` | string \| null | Webhook area-specifico (null = usa sito) |
| `cameras` | string[] | ID camere assegnate |
| `signals[]` | object[] | Override segnali per questa area |

**Schema `signals[]` (override):**

| Campo | Tipo | Descrizione |
|---|---|---|
| `id` | string | Riferimento al segnale in library |
| `enabled` | bool | Attivo in questa area |
| `threshold_override` | float \| null | Soglia locale |
| `action_override` | ActionType \| null | Azione locale |
| `escalation_llm_override` | bool \| null | LLM escalation locale |
| `llm_prompt_key_override` | string \| null | Prompt key locale |
| `time_filter` | `{from: "HH:MM", to: "HH:MM"}` \| null | Finestra oraria UTC |

---

### `GET /api/config/areas/{area_id}`

Singola area. **Response:** `AreaRead`.

---

### `PATCH /api/config/areas/{area_id}`

Aggiorna metadata area. **Request body** `AreaPatch`:

```json
{
  "name": "Cucina",
  "alert_cooldown_sec": 120,
  "webhook_url": null,
  "cameras": ["cam_kitchen_01", "cam_kitchen_03"]
}
```

**Response 200:** `AreaRead`

---

### `GET /api/config/areas/{area_id}/signals`

Lista override segnali per un'area. **Response:** `AreaSignalOverride[]`

---

### `POST /api/config/areas/{area_id}/signals`

Aggiungi segnale a un'area. **Request body** `AreaSignalOverride`:

```json
{
  "id": "cabinet_access",
  "enabled": true,
  "threshold_override": 0.40,
  "action_override": "alarm",
  "time_filter": { "from": "22:00", "to": "06:00" }
}
```

**Response 201:** `AreaSignalOverride`

**Response 409:** già presente

---

### `PATCH /api/config/areas/{area_id}/signals/{signal_id}`

Aggiorna override. **Request body** `AreaSignalOverridePatch` (tutti opzionali):

```json
{
  "enabled": false,
  "threshold_override": 0.45
}
```

**Response 200:** `AreaSignalOverride`

---

### `DELETE /api/config/areas/{area_id}/signals/{signal_id}`

Rimuovi segnale dall'area. **Response 204.**

---

## 12. Config — Site

Auth: **Config API Key**.

### `GET /api/config/site`

**Response 200:** `SiteRead`

```json
{
  "id": "tc",
  "name": "The Castelletto",
  "type": "hotel",
  "alert_cooldown_sec": 300,
  "webhook_url": null,
  "signal_library": [
    "config/signals/hotel.yaml",
    "config/signals/custom.yaml"
  ]
}
```

### `PATCH /api/config/site`

**Request body** `SitePatch`:

```json
{
  "name": "Nuovo nome",
  "alert_cooldown_sec": 180
}
```

**Response 200:** `SiteRead`

---

## 13. Config — Prompt LLM

Auth: **Config API Key**.

### `GET /api/config/prompts`

Lista chiavi prompt disponibili.

**Response 200:** `PromptRead[]`

```json
[
  {
    "key": "smoking_context",
    "file": "hotel.yaml",
    "preview": "You are analyzing a video frame from a hotel surveillance camera...",
    "has_final_eval": false,
    "final_eval_preview": null
  }
]
```

### `GET /api/config/prompts/{key}`

Testo completo del prompt.

**Response 200:** `PromptDetail`

```json
{
  "key": "smoking_context",
  "file": "hotel.yaml",
  "prompt": "You are analyzing a video frame from a hotel surveillance camera...",
  "final_eval": null
}
```

### `PATCH /api/config/prompts/{key}`

Imposta o rimuove il `final_eval`. **Request body:**

```json
{ "final_eval": "Based on the analysis windows above, provide a final verdict..." }
```

Set a `null` per rimuovere. **Response 200:** `PromptDetail`

---

## 14. Setup Wizard

Auth: **Config API Key** per tutti gli endpoint.

### `POST /api/setup/signal/suggest-phrase`

Genera una frase semantica ottimizzata dall'LLM.

**Request body:**

```json
{
  "description": "A person accessing the honour bar cabinet, reaching inside to take a product",
  "zones": ["counter", "cabinet"],
  "area_type": "indoor_public",
  "camera_snapshot_b64": null
}
```

| Campo | Tipo | Richiesto | Descrizione |
|---|---|---|---|
| `description` | string | Sì (min 12 char) | Descrizione in linguaggio naturale |
| `zones` | string[] | No | Zone rilevanti per contestualizzare |
| `area_type` | string | No | Tipo area (default: `indoor_public`) |
| `camera_snapshot_b64` | string \| null | No | JPEG base64 per contesto visivo all'LLM |

**Response 200:**

```json
{
  "phrase": "a person extending their arm into an open cabinet with hand inside, standing close to the counter viewed from an overhead camera angle",
  "reasoning": "Focused on the visible visual cues of arm extension and cabinet access rather than intent."
}
```

**Response 502:** LLM non disponibile

**UI:** Step 1 del wizard segnale. Chiamato con debounce 900ms dopo che l'utente smette di digitare la descrizione. Risposta mostrata nella "AI Card".

---

### `POST /api/setup/signal/upload-clip`

Upload clip video per calibrazione. **Content-Type:** `multipart/form-data`

**Campi form:**

| Campo | Tipo | Descrizione |
|---|---|---|
| `label` | string | `"positive"` o `"negative"` |
| `file` | binary | Video (.mp4, .mov, .avi, max 500 MB) |

**Response 201:**

```json
{
  "clip_id": "wiz_a1b2c3d4",
  "filename": "evidence_smoking.mp4",
  "size_bytes": 18540000,
  "label": "positive",
  "duration_sec": 12.4
}
```

**Response 413:** file > 500 MB

**UI:** Step 2, drop zone. Per ogni file caricato con successo appare una riga nella lista clip con nome, durata e X per rimuovere.

---

### `POST /api/setup/signal/capture-clip`

Estrae clip dall'archivio registrazioni Axis.

**Request body:**

```json
{
  "camera_id": "cam_kitchen_01",
  "date": "2025-06-02",
  "time_from": "17:30",
  "time_to": "17:35",
  "label": "positive"
}
```

**Response 201:**

```json
{
  "clip_id": "wiz_e5f6g7h8",
  "filename": "cam_kitchen_01_20250602T1730.mp4",
  "size_bytes": 24300000,
  "label": "positive",
  "duration_sec": 300.0
}
```

**Response 404:** `{ "detail": "no_recordings — no Axis recordings found for the specified time range" }`

**Response 502:** camera irraggiungibile

**UI:** Step 2, sezione "Axis recording extract". Select camera, datepicker, due time input, bottone "Capture clip".

---

### `DELETE /api/setup/signal/clips/{clip_id}`

Rimuove una clip temporanea dalla sessione wizard.

**Response 204:** No content

**Response 404:** clip non trovata

**UI:** icona X nella lista clip dello Step 2.

---

### `POST /api/setup/signal/calibrate` — SSE

Esegue embedding di tutte le clip contro la frase e restituisce score in streaming SSE.

**Request body:**

```json
{
  "phrase": "a person extending their arm into an open cabinet...",
  "positive_clips": ["wiz_a1b2c3d4"],
  "negative_clips": ["wiz_e5f6g7h8"],
  "threshold": 0.43,
  "llm_recommendation": true
}
```

**Response:** `Content-Type: text/event-stream`

**Sequenza eventi SSE:**

#### `progress` — avanzamento
```
data: {"type": "progress", "current": 1, "total": 2, "clip_id": "wiz_a1b2c3d4", "clip_type": "positive"}
```

#### `score` — score calcolato per una clip
```
data: {"type": "score", "clip_id": "wiz_a1b2c3d4", "clip_type": "positive", "score": 0.7832}
```

#### `error` — errore su una clip
```
data: {"type": "error", "clip_id": "wiz_a1b2c3d4", "detail": "clip_not_found"}
```

#### `recommendation` — suggerimento AI (se falsi positivi presenti)
```
data: {
  "type": "recommendation",
  "has_false_positives": true,
  "false_positive_clips": ["wiz_e5f6g7h8"],
  "suggested_threshold": 0.52,
  "suggested_phrase": "a person opening a cabinet reaching inside to take a product, arm fully extended...",
  "reasoning": "Clip scores 0.46 above threshold. Consider raising threshold to 0.52 or refining the phrase."
}
```

#### `done` — calibrazione completata
```
data: {
  "type": "done",
  "summary": {
    "positive_detected": 1,
    "positive_total": 1,
    "false_positives": 0,
    "negative_total": 1
  }
}
```

**UI:** Step 3. La barra di progresso si aggiorna su ogni `progress`. Le `ScoreRow` si aggiornano su ogni `score`. La recommendation card compare dopo `recommendation`. Il bottone "Next" si sblocca su `done`.

---

## 15. Alerts — history

### `GET /api/alerts?limit=N`

Ultimi N alert dal bus in-memory (max 100). Auth: **JWT**.

**Response 200:** lista di `AlertPayload[]`

```json
[
  {
    "event_id": "evt_abc123",
    "area_id": "kitchen",
    "signal_id": "smoking",
    "score": 0.847,
    "action": "notify",
    "priority": 2,
    "timestamp": "2025-06-02T14:37:22Z",
    "area_name": "Kitchen",
    "signal_text": "a person holding a cigarette...",
    "clip_path": "/data/clips/kitchen/evt_abc123.mp4",
    "llm_verdict": {
      "confirmed": true,
      "confidence": 0.92,
      "description": "Person holding cigarette near counter."
    },
    "camera_id": "cam_kitchen_01"
  }
]
```

**Schema `AlertPayload`:**

| Campo | Tipo | Descrizione |
|---|---|---|
| `event_id` | string | ID evento |
| `area_id` | string | ID area |
| `signal_id` | string | ID segnale |
| `score` | float | Score cosine |
| `action` | ActionType | Azione eseguita |
| `priority` | int | Priorità 1–5 |
| `timestamp` | ISO 8601 | Data/ora UTC |
| `area_name` | string \| null | Nome area leggibile |
| `signal_text` | string \| null | Frase semantica |
| `clip_path` | string \| null | Percorso clip |
| `llm_verdict` | object \| null | Verdetto LLM |
| `llm_verdict.confirmed` | bool | Confermato |
| `llm_verdict.confidence` | float | Confidenza 0–1 |
| `llm_verdict.description` | string | Descrizione testuale |
| `camera_id` | string \| null | ID camera |

**UI:** usato dal hook `useAlerts` per pre-popolare il buffer al mount.

---

## 16. Health check

### `GET /health`

Endpoint pubblico, nessuna auth.

**Response 200:**

```json
{ "status": "ok", "service": "vsa-api" }
```

---

## 17. Riepilogo autenticazione per endpoint

| Endpoint | Auth |
|---|---|
| `POST /api/auth/login` | Nessuna |
| `GET /health` | Nessuna |
| `GET /api/config` (summary) | JWT |
| `GET /api/events` | JWT |
| `GET /api/stats` | JWT |
| `GET /api/alerts` | JWT |
| `GET /api/logs` | JWT |
| `GET /api/live/status` | JWT |
| `GET /api/live/queue-detail` | JWT |
| `GET /api/clips/{id}` | JWT (query param `?token=`) |
| `WS /api/ws` | JWT (query param `?token=`) |
| `GET /api/config/cameras*` | Config API Key |
| `POST/PATCH/DELETE /api/config/cameras*` | Config API Key |
| `GET /api/config/signals*` | Config API Key |
| `POST/PATCH/DELETE /api/config/signals*` | Config API Key |
| `GET /api/config/areas*` | Config API Key |
| `POST/PATCH/DELETE /api/config/areas*` | Config API Key |
| `GET/PATCH /api/config/site` | Config API Key |
| `GET/PATCH /api/config/prompts*` | Config API Key |
| `POST /api/setup/signal/*` | Config API Key |
| `DELETE /api/setup/signal/clips/*` | Config API Key |

---

## 18. Codici di errore comuni

| HTTP | Significato | Corpo |
|---|---|---|
| 401 | Token mancante, scaduto o non valido | `{ "detail": "..." }` |
| 403 | Permessi insufficienti | `{ "detail": "..." }` |
| 404 | Risorsa non trovata | `{ "detail": "..." }` |
| 409 | Conflitto (ID già esistente) | `{ "detail": "..." }` |
| 410 | Clip su camera non più disponibile | `{ "detail": "Video no longer available on camera" }` |
| 413 | File troppo grande | `{ "detail": "File too large (max 500 MB)" }` |
| 422 | Errore di validazione | `{ "detail": [...] }` (FastAPI standard) |
| 502 | Servizio esterno irraggiungibile (LLM, camera) | `{ "detail": "..." }` |
