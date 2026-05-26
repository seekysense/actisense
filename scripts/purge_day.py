"""
Purge all data for a given date: frame_debug, clips, LanceDB (events + stats).

Usage:
    python scripts/purge_day.py 2026-05-26
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

import lancedb

DATA_DIR = Path(__file__).parents[1] / "data"
LANCEDB_DIR = DATA_DIR / "lancedb"


def purge_frames(date_str: str) -> int:
    tag = date_str.replace("-", "")  # "20260526"
    removed = 0
    debug_dir = DATA_DIR / "frame_debug"
    if debug_dir.exists():
        for d in debug_dir.iterdir():
            if d.is_dir() and d.name.startswith(tag):
                shutil.rmtree(d)
                print(f"  [frames] removed {d.name}")
                removed += 1
    return removed


def purge_clips(date_str: str) -> int:
    removed = 0
    clips_dir = DATA_DIR / "clips"
    if clips_dir.exists():
        for area_dir in clips_dir.iterdir():
            day_dir = area_dir / date_str
            if day_dir.is_dir():
                count = sum(1 for _ in day_dir.glob("*.mp4"))
                shutil.rmtree(day_dir)
                print(f"  [clips]  removed {day_dir.relative_to(DATA_DIR)} ({count} files)")
                removed += count
    return removed


def purge_lancedb(date_str: str) -> dict[str, int]:
    counts = {"events": 0, "stats": 0}
    db = lancedb.connect(str(LANCEDB_DIR))

    # events table — filter by timestamp date
    try:
        tbl = db.open_table("events")
        before = tbl.count_rows()
        tbl.delete(f"date_trunc('day', timestamp) = TIMESTAMP '{date_str} 00:00:00+00'")
        after = tbl.count_rows()
        counts["events"] = before - after
        print(f"  [lancedb] events: removed {counts['events']} rows (was {before}, now {after})")
    except Exception as exc:
        print(f"  [lancedb] events: {exc}")

    # stats table — filter by date string field
    try:
        tbl = db.open_table("stats")
        before = tbl.count_rows()
        tbl.delete(f"date = '{date_str}'")
        after = tbl.count_rows()
        counts["stats"] = before - after
        print(f"  [lancedb] stats:  removed {counts['stats']} rows (was {before}, now {after})")
    except Exception as exc:
        print(f"  [lancedb] stats: {exc}")

    return counts


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: python scripts/purge_day.py YYYY-MM-DD")
        sys.exit(1)

    date_str = sys.argv[1]
    print(f"Purging data for {date_str} ...\n")

    n_frames = purge_frames(date_str)
    n_clips  = purge_clips(date_str)
    db_counts = purge_lancedb(date_str)

    print(f"\nDone.")
    print(f"  frame_debug dirs : {n_frames}")
    print(f"  clip files       : {n_clips}")
    print(f"  lancedb events   : {db_counts['events']}")
    print(f"  lancedb stats    : {db_counts['stats']}")


if __name__ == "__main__":
    main()
