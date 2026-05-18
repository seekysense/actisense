#!/usr/bin/env python3
"""
Test massima capacità immagini LLM (256K token window).
Testa combinazioni di numero frame × dimensione pixel.
"""
import asyncio
import base64
import io
import time
from pathlib import Path

import aiohttp
from PIL import Image

LLM_BASE_URL = "https://api-gb10.elettra.ai/v1"
LLM_API_KEY  = "gln_qrKN0_OxXKIFK5GRvju6VatfXSOvr-Slx67qFpDFoM6q8TbgiOiBKWESn2n5-le1"
MODEL        = "Galene/LLM"

FRAME_PATH   = Path("data/frame_debug/20260511_125620_EFCB_B8A44FC6820B/cabinet-001.jpeg")
PROMPT       = "Describe briefly what you see in these security camera frames."

# Combinazioni da testare: (n_frames, pixel_size, jpeg_quality)
TESTS = [
    # Baseline single frame a varie risoluzioni
    (1, 224, 80),
    (1, 336, 80),
    (1, 448, 80),
    (1, 512, 80),
    (1, 640, 80),
    (1, 768, 80),
    # Più frame a 336px (dimensione attuale engine)
    (2, 336, 80),
    (3, 336, 80),
    (4, 336, 80),
    (5, 336, 80),
    (6, 336, 80),
    (8, 336, 80),
    (10, 336, 80),
    # Più frame a 224px
    (2, 224, 80),
    (4, 224, 80),
    (6, 224, 80),
    (8, 224, 80),
    (10, 224, 80),
    (12, 224, 80),
    # Qualità ridotta per risparmiare token
    (5, 336, 60),
    (8, 336, 60),
    (5, 448, 60),
    (8, 448, 60),
]


def make_frame_b64(size: int, quality: int) -> str:
    img = Image.open(FRAME_PATH).convert("RGB").resize((size, size), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    raw = buf.getvalue()
    kb = len(raw) / 1024
    return base64.b64encode(raw).decode(), kb


async def test_one(session: aiohttp.ClientSession, n: int, size: int, quality: int) -> tuple:
    frame_b64, kb = make_frame_b64(size, quality)
    frames = [frame_b64] * n
    total_kb = kb * n

    content = [{"type": "text", "text": PROMPT}]
    for f in frames:
        content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{f}"}})

    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": content}],
        "temperature": 0.1,
        "max_tokens": 64,
    }
    headers = {"Authorization": f"Bearer {LLM_API_KEY}", "Content-Type": "application/json"}
    t0 = time.perf_counter()
    try:
        async with session.post(
            f"{LLM_BASE_URL}/chat/completions",
            headers=headers,
            json=payload,
            timeout=aiohttp.ClientTimeout(total=60),
        ) as resp:
            elapsed = time.perf_counter() - t0
            if resp.status == 200:
                return ("OK", n, size, quality, round(total_kb), round(elapsed, 1))
            else:
                body = await resp.text()
                return (f"HTTP {resp.status}", n, size, quality, round(total_kb), round(elapsed, 1))
    except asyncio.TimeoutError:
        return ("TIMEOUT", n, size, quality, round(total_kb), 60.0)
    except Exception as e:
        return (f"ERR:{e}", n, size, quality, round(total_kb), 0)


async def main():
    print(f"{'Status':<12} {'Frames':>6} {'Size':>6}px {'Q':>3} {'KB':>7} {'Sec':>6}")
    print("-" * 50)

    async with aiohttp.ClientSession() as session:
        for n, size, q in TESTS:
            result = await test_one(session, n, size, q)
            status, frames, px, qual, kb, sec = result
            marker = "✓" if status == "OK" else "✗"
            print(f"{marker} {status:<10} {frames:>6} {px:>6}px {qual:>3} {kb:>6}KB {sec:>6}s")
            # Piccola pausa per non fare rate limiting
            await asyncio.sleep(0.5)

    print("\nFine test.")


if __name__ == "__main__":
    asyncio.run(main())
