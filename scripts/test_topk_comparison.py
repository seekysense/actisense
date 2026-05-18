"""
Confronto scoring: averaged vector (vecchio) vs per-frame top-k (nuovo).

Carica i frame JPEG dalla cartella frame_debug, li embedda singolarmente,
poi calcola:
  - score_avg: media dei vettori, poi cosine sim (vecchio metodo)
  - score_max: max cosine sim per-frame (top_k=1, nuovo metodo)
  - score_topk3: media dei top-3 cosine sim per-frame

Usato per confrontare i due clip:
  - 20260511_125620_EFCB_B8A44FC6820B  (falso positivo cabinet, pulizie)
  - 20260511_124924_10EA_B8A44FC6820B  (sessione pulizie completa)
"""
from __future__ import annotations

import asyncio
import base64
import sys
from pathlib import Path

# Aggiungi il progetto root al path
sys.path.insert(0, str(Path(__file__).parent.parent))

from engine.config.loader import load_config
from engine.embedding.client import EmbeddingClient
from engine.embedding.similarity import cosine_similarity

CONFIG_PATH = Path("config/site.yaml")
FRAME_DEBUG_DIR = Path("data/frame_debug")

# Signal da testare (id → testo usato per query)
SIGNALS_TO_TEST = [
    "cabinet_opened",
    "cabinet_taken",
    "cleaning_setup",
]

# Clip da analizzare: (clip_id, zone_da_caricare, descrizione)
CLIPS = [
    (
        "20260511_125620_EFCB_B8A44FC6820B",
        "cabinet",
        "Falso positivo cabinet (pulizie)",
    ),
    (
        "20260511_124924_10EA_B8A44FC6820B",
        "tables",
        "Sessione pulizie (tables zone)",
    ),
    (
        "20260511_124924_10EA_B8A44FC6820B",
        "counter",
        "Sessione pulizie (counter zone)",
    ),
]


def load_frames_b64(clip_dir: Path, zone: str) -> list[str]:
    """Carica tutti i frame JPEG della zona come base64."""
    frames = sorted(clip_dir.glob(f"{zone}-*.jpeg"))
    result = []
    for f in frames:
        with open(f, "rb") as fh:
            result.append(base64.b64encode(fh.read()).decode())
    return result


def avg_vector(vecs: list[list[float]]) -> list[float]:
    if not vecs:
        return []
    dim = len(vecs[0])
    return [sum(v[i] for v in vecs) / len(vecs) for i in range(dim)]


def topk_score(frame_scores: list[float], k: int) -> float:
    sorted_scores = sorted(frame_scores, reverse=True)
    k = min(k, len(sorted_scores))
    return sum(sorted_scores[:k]) / k


async def run():
    cfg = load_config(CONFIG_PATH)
    client = EmbeddingClient(
        cfg.embedding_base_url,
        model=cfg.embedding_model,
        api_key=cfg.embedding_api_key,
    )

    # Carica embedding testuali per i signal
    signal_vecs: dict[str, list[float]] = {}
    sig_texts = {sid: cfg.signals[sid].text for sid in SIGNALS_TO_TEST if sid in cfg.signals}
    print(f"Embedding {len(sig_texts)} signal texts...")
    text_vecs = await client.embed_texts(list(sig_texts.values()))
    for sid, vec in zip(sig_texts.keys(), text_vecs):
        signal_vecs[sid] = vec
    print("Signal texts embedded.\n")

    for clip_id, zone, description in CLIPS:
        clip_dir = FRAME_DEBUG_DIR / clip_id
        if not clip_dir.exists():
            print(f"[SKIP] {clip_id}: directory non trovata")
            continue

        frames_b64 = load_frames_b64(clip_dir, zone)
        if not frames_b64:
            print(f"[SKIP] {clip_id}/{zone}: nessun frame trovato")
            continue

        print(f"{'='*70}")
        print(f"Clip: {description}")
        print(f"      {clip_id} / zone={zone}")
        print(f"      Frames: {len(frames_b64)}")
        print()

        # Embedda ogni frame singolarmente
        print(f"  Embedding {len(frames_b64)} frames...")
        frame_vecs = await client.embed_frames(frames_b64)
        print(f"  Embedding dim: {len(frame_vecs[0])}\n")

        for sid, text_vec in signal_vecs.items():
            thr = cfg.signals[sid].default_threshold

            # Metodo vecchio: media vettori → cosine sim
            avg_vec = avg_vector(frame_vecs)
            score_avg = cosine_similarity(avg_vec, text_vec)

            # Metodo nuovo: per-frame cosine sim
            frame_scores = [cosine_similarity(fv, text_vec) for fv in frame_vecs]
            score_max   = topk_score(frame_scores, k=1)
            score_top3  = topk_score(frame_scores, k=3)

            exceeds_avg  = score_avg  > thr
            exceeds_max  = score_max  > thr
            exceeds_top3 = score_top3 > thr

            flag_avg  = "EXCEEDS" if exceeds_avg  else "below  "
            flag_max  = "EXCEEDS" if exceeds_max  else "below  "
            flag_top3 = "EXCEEDS" if exceeds_top3 else "below  "

            per_frame_str = "  ".join(f"{s:+.3f}" for s in sorted(frame_scores, reverse=True))
            print(f"  Signal: {sid}")
            print(f"    thr={thr:.2f}")
            print(f"    avg_vec (old): {score_avg:+.4f}  {flag_avg}")
            print(f"    top_k=1 (new): {score_max:+.4f}  {flag_max}")
            print(f"    top_k=3      : {score_top3:+.4f}  {flag_top3}")
            print(f"    per-frame    : {per_frame_str}")
            print()

    await client.close()


if __name__ == "__main__":
    asyncio.run(run())
