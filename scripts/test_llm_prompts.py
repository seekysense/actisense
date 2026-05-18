#!/usr/bin/env python3
"""
Quick LLM vision prompt validation on real sample frames.
Tests cabinet_interaction_context and cabinet_item_taken_context.
"""
import asyncio
import base64
import io
import json
import re
import sys
from pathlib import Path

import aiohttp
from PIL import Image

ROOT = Path(__file__).parent.parent
FRAMES_DIR = ROOT / "data/frame_debug/20260513_170100_823B_B8A44FC6820B"

LLM_BASE_URL = "https://api-gb10.elettra.ai/v1"
LLM_API_KEY  = "gln_qrKN0_OxXKIFK5GRvju6VatfXSOvr-Slx67qFpDFoM6q8TbgiOiBKWESn2n5-le1"
MODEL        = "Galene/LLM"
SEND_SIZE    = 336   # px — resize before sending to avoid 500 on large payloads

sys.path.insert(0, str(ROOT))
from engine.config.prompts import PROMPT_CATALOG


def load_b64(path: Path, size: int = SEND_SIZE) -> str:
    img = Image.open(path).convert("RGB")
    img = img.resize((size, size), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=80)
    return base64.b64encode(buf.getvalue()).decode()


def img_block(b64: str) -> dict:
    return {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}}


def parse_json(raw: str) -> dict:
    text = raw.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        end = next((i for i, l in enumerate(lines[1:], 1) if l.startswith("```")), len(lines))
        text = "\n".join(lines[1:end])
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        matches = list(re.finditer(r'\{[^{}]*"confirmed"[^{}]*\}', text, re.DOTALL))
        if matches:
            return json.loads(matches[-1].group())
        return {"raw": raw[:300]}


async def ask_llm(session: aiohttp.ClientSession, frames_b64: list[str], prompt: str) -> dict:
    content = [{"type": "text", "text": prompt}] + [img_block(f) for f in frames_b64]
    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": content}],
        "temperature": 0.1,
        "max_tokens": 512,
    }
    headers = {"Authorization": f"Bearer {LLM_API_KEY}", "Content-Type": "application/json"}
    async with session.post(f"{LLM_BASE_URL}/chat/completions", headers=headers, json=payload) as resp:
        resp.raise_for_status()
        data = await resp.json()
        raw = data["choices"][0]["message"].get("content", "") or ""
        return parse_json(raw)


async def scan_frames(session, zone: str, n: int, prompt_key: str):
    """Send each frame individually to see which ones trigger the signal."""
    print(f"\n--- Scanning {zone} frames 1-{n} with [{prompt_key}] ---")
    for i in range(1, n + 1):
        path = FRAMES_DIR / f"{zone}-{i:03d}.jpeg"
        b64 = load_b64(path)
        try:
            result = await ask_llm(session, [b64], PROMPT_CATALOG[prompt_key])
            c = result.get("confirmed", "?")
            cf = result.get("confidence", "?")
            desc = result.get("description", result.get("raw", ""))[:80]
            print(f"  frame-{i:03d}: confirmed={c}  conf={cf}  | {desc}")
        except Exception as e:
            print(f"  frame-{i:03d}: ERROR {e}")


async def main():
    timeout = aiohttp.ClientTimeout(total=120)
    async with aiohttp.ClientSession(timeout=timeout) as session:

        # 1. Scan all cabinet frames for both prompt keys
        await scan_frames(session, "cabinet", 8, "cabinet_interaction_context")
        await scan_frames(session, "cabinet", 8, "cabinet_item_taken_context")

        # 2. Multi-frame test with best cabinet frames + FP check with tables
        print("\n\n=== MULTI-FRAME GROUP TESTS ===")
        cabinet_frames = [load_b64(FRAMES_DIR / f"cabinet-{i:03d}.jpeg") for i in [3, 5, 7]]
        tables_frames  = [load_b64(FRAMES_DIR / f"tables-{i:03d}.jpeg")  for i in [3, 5, 7]]

        tests = [
            ("cabinet_interaction_context — cabinet [3,5,7] (expect TRUE)",  cabinet_frames, "cabinet_interaction_context"),
            ("cabinet_item_taken_context — cabinet [3,5,7] (expect TRUE)",   cabinet_frames, "cabinet_item_taken_context"),
            ("cabinet_interaction_context — tables [3,5,7] (FP, expect FALSE)", tables_frames, "cabinet_interaction_context"),
            ("cabinet_item_taken_context — tables [3,5,7] (FP, expect FALSE)",  tables_frames, "cabinet_item_taken_context"),
        ]

        for label, frames, key in tests:
            print(f"\n{'='*60}")
            print(f"TEST: {label}")
            try:
                result = await ask_llm(session, frames, PROMPT_CATALOG[key])
                confirmed = result.get("confirmed")
                confidence = result.get("confidence")
                description = result.get("description", result.get("raw", ""))
                ok = (confirmed and "expect TRUE" in label) or (not confirmed and "expect FALSE" in label)
                marker = "OK" if ok else "FAIL"
                print(f"  [{marker}] confirmed={confirmed}  confidence={confidence}")
                print(f"  {description}")
            except Exception as e:
                print(f"  ERROR: {e}")


if __name__ == "__main__":
    asyncio.run(main())
