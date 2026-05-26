"""
Test LLM prompt for cabinet_item_taken signal using debug frames.
Iterates prompts until confirmed=True.

Usage:
    python scripts/test_cabinet_llm.py
"""
from __future__ import annotations

import asyncio
import base64
import os
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parents[1]))

from dotenv import load_dotenv
load_dotenv()

from engine.intelligence.llm_vision_client import LLMVisionClient
from engine.config.prompts import get_prompt, get_final_eval_prompt

FRAMES_DIR = Path(__file__).parents[1] / "data/frame_debug/20260526_130535_C328_B8A44FC6820B"
FRAME_FILES = sorted(FRAMES_DIR.glob("cabinet-*.jpeg"))


def load_frames() -> list[str]:
    frames = []
    for f in sorted(FRAME_FILES):
        raw = f.read_bytes()
        frames.append(base64.b64encode(raw).decode())
    print(f"Loaded {len(frames)} cabinet frames: {[f.name for f in sorted(FRAME_FILES)]}")
    return frames


def make_client() -> LLMVisionClient:
    return LLMVisionClient(
        base_url=os.environ["LLM_BASE_URL"],
        api_key=os.environ["LLM_API_KEY"],
        model=os.environ.get("FAST_MODEL", "Galene/LLM"),
        timeout=float(os.environ.get("LLM_TIMEOUT", "300")),
        send_frame_size=int(os.environ.get("LLM_FRAME_SIZE_SEND", "336")),
        send_jpeg_quality=int(os.environ.get("LLM_JPEG_QUALITY_SEND", "80")),
        enable_thinking=os.environ.get("LLM_THINKING", "false").lower() == "true",
        use_reasoning=os.environ.get("LLM_USEREASONING", "false").lower() == "true",
    )


async def run_test(prompt_key: str, frames: list[str], client: LLMVisionClient) -> None:
    prompt = get_prompt(prompt_key)
    print(f"\n{'='*70}")
    print(f"PROMPT KEY: {prompt_key}")
    print(f"PROMPT (first 300 chars):\n{prompt[:300]}...")
    print(f"{'='*70}")

    verdict = await client.analyze(frames, prompt_key)
    print(f"\nRESULT:")
    print(f"  confirmed  : {verdict.confirmed}")
    print(f"  confidence : {verdict.confidence:.3f}")
    print(f"  latency_ms : {verdict.latency_ms:.0f}")
    print(f"  description: {verdict.description}")

    # If multiple windows, also test final_eval
    if not verdict.confirmed:
        print(f"\n  [!] confirmed=False — testing multi-window + final_eval...")
        # Simulate 3 windows by splitting frames
        n = len(frames)
        w1 = frames[:n//3 + 1]
        w2 = frames[n//3:2*n//3 + 1]
        w3 = frames[2*n//3:]
        verdicts = []
        for i, win in enumerate([w1, w2, w3], 1):
            v = await client.analyze(win, prompt_key)
            print(f"    Window {i}: confirmed={v.confirmed} conf={v.confidence:.2f} — {v.description[:80]}")
            verdicts.append(v)

        if any(v.confirmed for v in verdicts):
            print(f"\n  -> At least one window confirmed — final_eval would fire (any-positive rule)")
            final = await client.analyze_final(verdicts, prompt_key)
            print(f"  FINAL EVAL: confirmed={final.confirmed} conf={final.confidence:.2f}")
            print(f"  FINAL DESC: {final.description}")
        else:
            print(f"\n  -> All windows false — prompt needs improvement")

    return verdict


async def main() -> None:
    frames = load_frames()
    client = make_client()

    print(f"\nLLM: {os.environ.get('FAST_MODEL')} @ {os.environ.get('LLM_BASE_URL')}")
    print(f"Frames: {len(frames)}, send_size={os.environ.get('LLM_FRAME_SIZE_SEND')}px")

    # Test current prompt (single pass + multi-window)
    await run_test("cabinet_item_taken_context", frames, client)

    # Force multi-window test to verify final_eval any-positive rule
    print(f"\n{'='*70}")
    print("MULTI-WINDOW TEST (simulating 3 windows, verifying final_eval)")
    print(f"{'='*70}")
    n = len(frames)
    windows = [frames[:3], frames[3:6], frames[6:]]
    verdicts = []
    for i, win in enumerate(windows, 1):
        v = await client.analyze(win, "cabinet_item_taken_context")
        print(f"  Window {i}: confirmed={v.confirmed} conf={v.confidence:.2f} — {v.description[:100]}")
        verdicts.append(v)

    print(f"\n  Any confirmed: {any(v.confirmed for v in verdicts)}")
    final = await client.analyze_final(verdicts, "cabinet_item_taken_context")
    print(f"  FINAL EVAL: confirmed={final.confirmed} conf={final.confidence:.2f}")
    print(f"  FINAL DESC: {final.description}")


if __name__ == "__main__":
    asyncio.run(main())
