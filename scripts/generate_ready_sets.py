#!/usr/bin/env python3
"""Generate the current batch of AMC quiz-ready sets."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

READY_SETS = [
    ("a", 2018),
    ("c", 2018),
    ("a", 2019),
    ("b", 2019),
    ("c", 2019),
    ("c", 2020),
    ("a", 2024),
    ("b", 2024),
    ("c", 2024),
    ("a", 2025),
    ("b", 2025),
    ("c", 2025),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate current AMC quiz-ready sets")
    parser.add_argument("--skip-build", action="store_true", help="Do not rebuild public/data/index.json")
    return parser.parse_args()


def run(cmd: list[str]) -> None:
    print("+", " ".join(cmd))
    subprocess.run(cmd, cwd=ROOT, check=True)


def main() -> None:
    args = parse_args()

    for level, year in READY_SETS:
        run(
            [
                sys.executable,
                "scripts/generate_amc_questions.py",
                "--level",
                level,
                "--year",
                str(year),
            ]
        )

    if not args.skip_build:
        run([sys.executable, "scripts/build_amc_library.py"])


if __name__ == "__main__":
    main()
