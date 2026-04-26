# InternVideo2 HTTP Service

Documentazione del servizio HTTP offerto da `server_internvideo2.py` per il modello 1b.

## Descrizione

Il servizio espone un server FastAPI per ottenere embedding testuali e video usando il modello `OpenGVLab/InternVideo2_CLIP_S` (1b).
- Porta predefinita: `6756`
- Modello: `OpenGVLab/InternVideo2_CLIP_S`
- Output embedding: vettori normalizzati di dimensione `512`
- logit_scale_exp: `100.0`

## Endpoint

### GET /health

Controllo di stato del servizio.

Richiesta:
- Metodo: `GET`
- URL: `http://localhost:6756/health`

Esempio:
```bash
curl http://localhost:6756/health
```

Risposta JSON:
```json
{
  "status": "ok",
  "model_loaded": true,
  "logit_scale_exp": 100.0,
  "device": "cpu",
  "dtype": "torch.bfloat16"
}
```

Campi:
- `status`: stato del servizio
- `model_loaded`: `true` se il modello è caricato
- `logit_scale_exp`: scala dei logit del modello (sempre 100.0)
- `device`: dispositivo in uso (`cpu` o `cuda`)
- `dtype`: tipo di dati usato per l’inferenza

---

### POST /v1/embeddings

Produce embedding per testo o lista di testi.

Richiesta:
- Metodo: `POST`
- URL: `http://localhost:6756/v1/embeddings`
- Content-Type: `application/json`

Corpo JSON:
```json
{
  "input": "Una descrizione testuale"
}
```

Oppure con più testi:
```json
{
  "input": ["Testo 1", "Testo 2"]
}
```

Parametri:
- `input`: stringa singola o lista di stringhe
- `model`: opzionale, valore di default `OpenGVLab/InternVideo2_CLIP_S`

Risposta JSON:
```json
{
  "object": "list",
  "model": "OpenGVLab/InternVideo2_CLIP_S",
  "data": [
    {
      "object": "embedding",
      "index": 0,
      "embedding": [0.123, -0.456, ...]
    }
  ]
}
```

Campi di risposta:
- `object`: tipo di oggetto, sempre `list`
- `model`: modello usato
- `data`: array di oggetti embedding
  - `object`: sempre `embedding`
  - `index`: indice della stringa input corrispondente
  - `embedding`: vettore float normalizzato

---

### POST /v1/video_embeddings

Produce embedding per un video a partire da frame JPEG codificati in base64.

Richiesta:
- Metodo: `POST`
- URL: `http://localhost:6756/v1/video_embeddings`
- Content-Type: `application/json`

Corpo JSON:
```json
{
  "frames": [
    "<base64-encoded JPEG frame 1>",
    "<base64-encoded JPEG frame 2>",
    "..."
  ]
}
```

Parametri:
- `frames`: lista di stringhe Base64, ciascuna rappresenta un’immagine JPEG
- `model`: opzionale, valore di default `OpenGVLab/InternVideo2_CLIP_S`

Note:
- Il server campiona esattamente `8` frame dai frame inviati.
- Se la lista è vuota viene restituito un errore `422`.

Risposta JSON:
```json
{
  "object": "list",
  "model": "OpenGVLab/InternVideo2_CLIP_S",
  "data": [
    {
      "object": "embedding",
      "index": 0,
      "embedding": [0.123, -0.456, ...]
    }
  ]
}
```

Campi di risposta:
- `object`: tipo di oggetto, sempre `list`
- `model`: modello usato
- `data`: array con un singolo embedding video
  - `index`: sempre `0`
  - `embedding`: vettore float normalizzato

---

## Esempio completo con `curl`

Embedding testuale:
```bash
curl -X POST http://localhost:6756/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{"input": "Ciao mondo"}'
```

Embedding video:
```bash
curl -X POST http://localhost:6756/v1/video_embeddings \
  -H "Content-Type: application/json" \
  -d '{"frames": ["<base64_jpeg_1>", "<base64_jpeg_2>"]}'
```

## Lancio del server

Per avviare il server con il modello 1b:
```bash
python server_internvideo2.py --model 1b --port 6756
```

## Errori comuni

- `503`: modello non ancora caricato
- `422`: richiesta non valida (ad esempio `frames` vuoto)
- `500`: errore interno durante la generazione degli embedding