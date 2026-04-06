#!/usr/bin/env python3
"""Build a normalized AMC asset library and manifest."""

from __future__ import annotations

import argparse
import json
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = ROOT / "extracted" / "澳大利亚AMC"
PUBLIC_ROOT = ROOT / "public"
LIBRARY_ROOT = PUBLIC_ROOT / "library"
DATA_ROOT = PUBLIC_ROOT / "data"
GENERATED_ROOT = DATA_ROOT / "generated"


@dataclass(frozen=True)
class LevelConfig:
    level_id: str
    folder_name: str
    label: str
    grade: str


LEVELS = [
    LevelConfig("a", "AMC-A：3-4年级", "AMC A", "3-4年级"),
    LevelConfig("b", "AMC-B：5-6年级", "AMC B", "5-6年级"),
    LevelConfig("c", "AMC-C：7-8年级", "AMC C", "7-8年级"),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build AMC public library and manifest")
    parser.add_argument("--no-copy", action="store_true", help="Do not copy assets into public/library")
    return parser.parse_args()


def year_from_name(name: str) -> int | None:
    digits = "".join(ch for ch in name if ch.isdigit())
    if len(digits) < 4:
        return None
    year = int(digits[:4])
    if 2000 <= year <= 2099:
        return year
    return None


def classify_asset(name: str) -> str | None:
    if "试卷" in name:
        return "paper"
    if "答案" in name or "解析" in name:
        return "answer"
    return None


def copy_asset(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


def generated_question_data(level_id: str, year: int) -> tuple[bool, str | None]:
    candidate = GENERATED_ROOT / level_id / f"{year}.json"
    if candidate.exists():
        return True, f"/data/generated/{level_id}/{year}.json"
    return False, None


def build_level_manifest(config: LevelConfig, copy_files: bool) -> dict:
    folder = SOURCE_ROOT / config.folder_name
    if not folder.exists():
        raise FileNotFoundError(f"Missing source folder: {folder}")

    per_year: dict[int, dict] = {}
    for source in sorted(folder.iterdir()):
        if not source.is_file() or source.name.startswith("."):
            continue
        kind = classify_asset(source.name)
        year = year_from_name(source.name)
        if not kind or year is None:
            continue

        entry = per_year.setdefault(
            year,
            {"year": year, "paper": None, "answer": None, "sourceFiles": []},
        )
        entry["sourceFiles"].append(source.name)

        level_library_dir = LIBRARY_ROOT / config.level_id / str(year)
        filename = f"{kind}{source.suffix.lower()}"
        public_path = level_library_dir / filename
        public_url = f"/library/{config.level_id}/{year}/{filename}"

        entry[kind] = {
            "url": public_url,
            "source": source.name,
            "path": str(public_path.relative_to(ROOT)),
        }

        if copy_files:
            copy_asset(source, public_path)

    years = []
    for year in sorted(per_year.keys(), reverse=True):
        entry = per_year[year]
        quiz_ready, question_data_url = generated_question_data(config.level_id, year)
        entry["quizReady"] = quiz_ready
        entry["questionDataUrl"] = question_data_url
        entry["note"] = (
            "已生成题目 JSON，可接入正式练习流程。"
            if quiz_ready
            else "当前仅提供试卷与答案索引，题图切割后可接入在线练习。"
        )
        years.append(entry)

    return {
        "id": config.level_id,
        "label": config.label,
        "grade": config.grade,
        "years": years,
    }


def main() -> None:
    args = parse_args()
    copy_files = not args.no_copy

    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    if copy_files:
        LIBRARY_ROOT.mkdir(parents=True, exist_ok=True)

    levels = [build_level_manifest(config, copy_files=copy_files) for config in LEVELS]
    stats = {
        "levels": len(levels),
        "papers": sum(1 for level in levels for year in level["years"] if year["paper"]),
        "answers": sum(1 for level in levels for year in level["years"] if year["answer"]),
        "quizReady": sum(1 for level in levels for year in level["years"] if year["quizReady"]),
    }

    manifest = {
        "competition": "Australian Mathematics Competition",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceRoot": str(SOURCE_ROOT.relative_to(ROOT)),
        "stats": stats,
        "levels": levels,
    }

    output = DATA_ROOT / "index.json"
    output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote manifest: {output}")
    print(json.dumps(stats, ensure_ascii=False))


if __name__ == "__main__":
    main()
