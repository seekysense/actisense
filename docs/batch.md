# Batch Import — VisionSemanticAgent

Guida all'importazione storica delle registrazioni Axis attraverso il pipeline completo (embedding → signal evaluation → action routing → LanceDB).

---

## Prerequisiti

1. Venv attivo e `.env` configurato
2. Embedding service in esecuzione (`EMBEDDING_SERVICE_URL` raggiungibile)
3. API server avviato su porta 8000 (per la ricezione alert via webhook interno)

```bash
# Terminal 1 — API server
source .venv/bin/activate
uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2 — batch
source .venv/bin/activate

# Terminal 3 — local embedder
python3 server_qwen.py 
```




---

## Argomenti CLI

```
python scripts/batch_process.py \
    --camera <camera_id> \
    --from   YYYY-MM-DD \
    --to     YYYY-MM-DD \
    [--event-id   <event_id>] \
    [--config     config/site.yaml] \
    [--no-llm] \
    [--dry-run]

python scripts/batch_process.py  --camera cam_entrance_01 --from 2026-05-04:15.00  --to 2026-05-04:16.00
python scripts/batch_process.py  --camera cam_lobby_01 --from 2026-05-01  --to 2026-05-03
python scripts/batch_process.py  --camera cam_kitchen_01 --from 2026-05-01  --to 2026-05-03



# Oppure con clip già scaricate localmente:
python scripts/batch_process.py \
    --camera <camera_id> \
    --local-clips-dir <path/>
```

| Argomento | Tipo | Default | Descrizione |
|-----------|------|---------|-------------|
| `--camera` | string | — | ID camera da `config/site.yaml` (es. `cam_kitchen_01`) |
| `--from` | YYYY-MM-DD o YYYY-MM-DD:HH.MM[.SS] | — | Data/ora di inizio UTC (default 00:00:00) |
| `--to` | YYYY-MM-DD o YYYY-MM-DD:HH.MM[.SS] | — | Data/ora di fine UTC (default 23:59:59) |
| `--local-clips-dir` | path | — | Processa clip `.mp4` già presenti in locale (salta download Axis) |
| `--event-id` | string | valore in `.env` o `cabinet` | Event ID VAPIX da usare se non configurato nel YAML della camera |
| `--config` | path | `config/site.yaml` | Path alternativo al config file |
| `--no-llm` | flag | off | Disabilita l'escalation LLM (più veloce, meno preciso) |
| `--dry-run` | flag | off | Elenca le registrazioni senza scaricarle né processarle |

---

## Esempi pratici

### Importare una fascia oraria specifica

```bash
python scripts/batch_process.py \
    --camera cam_entrance_01 \
    --from 2026-05-04:15.00 \
    --to   2026-05-04:16.00
```

### Importare un singolo giorno

```bash
python scripts/batch_process.py \
    --camera cam_kitchen_01 \
    --from 2026-04-24 \
    --to   2026-04-24
```

### Importare un intervallo di più giorni

```bash
python scripts/batch_process.py \
    --camera cam_kitchen_01 \
    --from 2026-04-22 \
    --to   2026-04-25
```

### Entrambe le telecamere in parallelo (background)

```bash
python scripts/batch_process.py \
    --camera cam_kitchen_01 \
    --from 2026-04-22 --to 2026-04-25 \
    > logs/batch_kitchen.log 2>&1 &

python scripts/batch_process.py \
    --camera cam_lobby_01 \
    --from 2026-04-22 --to 2026-04-25 \
    > logs/batch_lobby.log 2>&1 &
```

Monitoraggio:

```bash
tail -f logs/batch_kitchen.log
tail -f logs/batch_lobby.log
```

### Dry run — verifica quante registrazioni ci sono

```bash
python scripts/batch_process.py \
    --camera cam_kitchen_01 \
    --from 2026-04-22 --to 2026-04-25 \
    --dry-run
```

### Solo segnali senza escalation LLM

```bash
python scripts/batch_process.py \
    --camera cam_kitchen_01 \
    --from 2026-04-24 --to 2026-04-24 \
    --no-llm
```

### Clip già scaricate in locale

```bash
python scripts/batch_process.py \
    --camera cam_kitchen_01 \
    --local-clips-dir data/clips/kitchen/2026-04-24
```

---

## Cosa fa per ogni registrazione

```
[1/142] recording_XXXX  (2026-04-24T08:12:35Z → 2026-04-24T08:12:50Z)
  Downloading ...
  Downloaded: recording_XXXX.mp4  (1824.3 KB)
  Zone=tables          frames=30  windows=3/3   duration=14.8s
  Zone=counter         frames=28  windows=3/3   duration=14.8s
  eating_drinking        score=+0.4521  thr=0.20  EXCEEDS   zone=counter
  working_with_pc        score=+0.3812  thr=0.20  below     zone=tables
  → FIRED  signal=eating_drinking  action=notify  llm=True
```

Per ogni recording il batch:

1. Scarica il clip da Axis VAPIX (o usa clip locale)
2. Estrae frame a `EMBED_FPS` fps per ogni zona configurata
3. Deduplica i frame per variabilità (MAD/255 < `EMBED_MIN_FRAME_DIFF`)
4. Divide in finestre (`EMBED_WINDOW_SEC` secondi), capped a `EMBED_MAX_WINDOWS`
5. Embeds ogni finestra → score MAX per signal
6. Per ogni signal che supera la soglia: salva evento in LanceDB + clip su disco
7. Se il signal ha `escalation_llm: true`: chiama LLM su al più `LLM_MAX_CALLS` finestre
8. Notifica via webhook (`WEBHOOK_DEFAULT_URL` nel `.env`)

Il cooldown **viene resettato per ogni recording** (nessun cooldown tra recording storiche).

---

## Output finale (batch summary)

```
========================================================================
  BATCH SUMMARY
========================================================================
  Recordings : 142
  Events     : 38
  Errors     : 0

  [OK ] recording_0001
        frames=24  duration=11.8s
        ✓ eating_drinking          score=+0.4521  action=notify  zone=counter
        → STORED: eating_drinking / notify [LLM]

  [OK ] recording_0002
        frames=20  duration=9.9s
        no threshold exceeded  (working_with_pc=+0.198, cleaning_setup=+0.171 ...)

  [ERR] recording_0099
        ERROR: Connection reset by peer
========================================================================
```

---

## Reset e reimportazione

Per cancellare il database LanceDB e reimportare da zero:

```bash
# ATTENZIONE: elimina tutti gli eventi storici
rm -rf data/lancedb

# Ricrea automaticamente al prossimo avvio del batch o dell'API
python scripts/batch_process.py --camera cam_kitchen_01 --from 2026-04-22 --to 2026-04-25
```

I clip già salvati in `data/clips/` non vengono eliminati dal comando sopra.

---

## Troubleshooting

| Problema | Causa probabile | Soluzione |
|----------|----------------|-----------|
| `Camera offline` | Telecamera non raggiungibile | Verifica rete e credenziali in `.env` |
| `Signal cache warm-up failed` | Embedding service non risponde | Verifica `EMBEDDING_SERVICE_URL` e avvia il servizio |
| `0 recordings found` | Date errate o nessun evento nel range | Verifica con `--dry-run`; controlla l'`event_id` corretto in VAPIX |
| Nessun evento in frontend | Soglie troppo alte | Abbassa `default_threshold` nei signal o usa `--no-llm` per debug |
| Clip non servite | `clip_path` vuoto nel DB | Verifica che `CLIP_STORAGE_DIR` sia scrivibile |
| Velocità bassa | LLM troppo lento | Usa `--no-llm` per importazione iniziale, poi riesegui con LLM solo sui giorni rilevanti |
