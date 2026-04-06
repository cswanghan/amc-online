#!/usr/bin/env python3
"""Generate question crops and question JSON for one AMC level/year set.

Current target:
- Works for modern AMC PDFs that contain searchable text and a matching answer/solution PDF.
- Handles multi-page questions by outputting multiple cropped images for the same question.
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path

import fitz


ROOT = Path(__file__).resolve().parents[1]
LIBRARY_ROOT = ROOT / "public" / "library"
GENERATED_IMAGES_ROOT = ROOT / "public" / "generated"
GENERATED_DATA_ROOT = ROOT / "public" / "data" / "generated"

QUESTION_TOP_PADDING = 10
QUESTION_BOTTOM_PADDING = 10
TOP_MARGIN = 52
BOTTOM_MARGIN = 42
RENDER_SCALE = 2.0


@dataclass(frozen=True)
class Marker:
    number: int
    page_index: int
    y: float


ANSWER_LIST_EXPLANATION = "Official answer list only. Detailed explanation is not yet available."


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate AMC question crops and JSON")
    parser.add_argument("--level", required=True, choices=["a", "b", "c"])
    parser.add_argument("--year", required=True, type=int)
    return parser.parse_args()


def score_for_question(number: int) -> int:
    if number <= 10:
        return 3
    if number <= 20:
        return 4
    if number <= 25:
        return 5
    return number - 20


def question_type(number: int) -> str:
    return "choice" if number <= 25 else "integer"


def list_markers(doc: fitz.Document) -> list[Marker]:
    markers: list[Marker] = []
    seen: set[tuple[int, int]] = set()

    for page_index in range(doc.page_count):
        page = doc[page_index]
        text_dict = page.get_text("dict")
        page_markers: list[Marker] = []
        for block in text_dict["blocks"]:
            if "lines" not in block:
                continue
            for line in block["lines"]:
                line_text = "".join(span["text"] for span in line["spans"]).strip()
                match = re.match(r"^(\d{1,2})\.", line_text)
                if not match:
                    continue
                number = int(match.group(1))
                x0, y0, _, _ = line["bbox"]
                if x0 >= 120:
                    continue
                key = (number, page_index)
                if key in seen:
                    continue
                seen.add(key)
                page_markers.append(Marker(number=number, page_index=page_index, y=float(y0)))
        markers.extend(sorted(page_markers, key=lambda item: item.y))

    markers.sort(key=lambda item: (item.page_index, item.y, item.number))
    return markers


def render_clip(page: fitz.Page, rect: fitz.Rect, output: Path) -> None:
    if rect.height <= 6 or rect.width <= 6:
        raise ValueError(f"Invalid crop rect: {rect}")
    matrix = fitz.Matrix(RENDER_SCALE, RENDER_SCALE)
    pix = page.get_pixmap(matrix=matrix, clip=rect, alpha=False)
    output.parent.mkdir(parents=True, exist_ok=True)
    pix.save(output)


def question_segments(doc: fitz.Document, markers: list[Marker], index: int) -> list[tuple[int, fitz.Rect]]:
    marker = markers[index]
    next_marker = markers[index + 1] if index + 1 < len(markers) else None
    segments: list[tuple[int, fitz.Rect]] = []

    last_page_index = next_marker.page_index if next_marker else doc.page_count - 1
    for page_index in range(marker.page_index, last_page_index + 1):
        page = doc[page_index]
        rect = page.rect
        top = marker.y - QUESTION_TOP_PADDING if page_index == marker.page_index else TOP_MARGIN
        bottom = rect.height - BOTTOM_MARGIN
        if next_marker and page_index == next_marker.page_index:
            bottom = next_marker.y - QUESTION_BOTTOM_PADDING
        crop = fitz.Rect(34, max(TOP_MARGIN, top), rect.width - 28, min(rect.height - 16, bottom))
        if crop.height > 8:
            segments.append((page_index, crop))

    return segments


def extract_segment_text(doc: fitz.Document, markers: list[Marker], index: int) -> str:
    parts: list[str] = []
    for page_index, rect in question_segments(doc, markers, index):
        page = doc[page_index]
        text = page.get_text("text", clip=rect).strip()
        if text:
            parts.append(text)
    return "\n".join(parts).strip()


def extract_answer(text: str, number: int) -> str:
    normalized = re.sub(r"\s+", " ", text)
    matches = re.findall(r"hence\s*\(([^)]+)\)", normalized, flags=re.IGNORECASE)
    if matches:
        candidate = matches[-1].strip()
        if number <= 25:
            letter = re.search(r"[A-E]", candidate)
            if letter:
                return letter.group(0)
        else:
            digits = re.search(r"\d{1,3}", candidate)
            if digits:
                return digits.group(0)

    if number <= 25:
        letter = re.findall(r"\(([A-E])\)", normalized)
        if letter:
            return letter[-1]
    else:
        digits = re.findall(r"\((\d{1,3})\)", normalized)
        if digits:
            return digits[-1]

    raise ValueError(f"Could not extract answer for question {number}")


def document_text(doc: fitz.Document) -> str:
    return "\n".join(page.get_text("text") for page in doc)


def is_answer_list_document(doc: fitz.Document) -> bool:
    first_pages = "\n".join(page.get_text("text") for page in doc[: min(doc.page_count, 2)])
    return "Answer List" in first_pages


def parse_answer_list(answer_doc: fitz.Document, level: str) -> dict[int, str]:
    text = document_text(answer_doc)
    normalized_level = level.upper()
    pattern = re.compile(
        rf"Level\s+{normalized_level}\s*(.*?)(?=Level\s+[A-Z]|$)",
        flags=re.DOTALL,
    )
    match = pattern.search(text)
    if not match:
        raise ValueError(f"Could not find Level {normalized_level} in answer list")

    answers: dict[int, str] = {}
    for number_text, answer_text in re.findall(r"(\d{1,2})\s*:\s*([A-E]|\d{1,3})", match.group(1)):
        answers[int(number_text)] = answer_text.strip()

    missing = [number for number in range(1, 31) if number not in answers]
    if missing:
        raise ValueError(f"Answer list for level {normalized_level} is missing questions: {missing}")

    return answers


def build_question_set(level: str, year: int) -> dict:
    asset_dir = LIBRARY_ROOT / level / str(year)
    paper_path = asset_dir / "paper.pdf"
    answer_path = None
    for candidate in [asset_dir / "answer.pdf", asset_dir / "answer.png"]:
        if candidate.exists():
            answer_path = candidate
            break

    if not paper_path.exists():
        raise FileNotFoundError(f"Missing paper: {paper_path}")
    if answer_path is None or answer_path.suffix.lower() != ".pdf":
        raise FileNotFoundError(
            f"Missing PDF answer file for {level}/{year}. Current generator requires answer.pdf."
        )

    paper_doc = fitz.open(paper_path)
    answer_doc = fitz.open(answer_path)
    paper_markers = list_markers(paper_doc)
    answer_list_mode = is_answer_list_document(answer_doc)
    answer_markers = [] if answer_list_mode else list_markers(answer_doc)
    answer_list_answers = parse_answer_list(answer_doc, level) if answer_list_mode else {}

    if len(paper_markers) != 30:
        raise ValueError(f"Expected 30 question starts in paper, got {len(paper_markers)}")
    if not answer_list_mode and len(answer_markers) != 30:
        raise ValueError(f"Expected 30 question starts in answer PDF, got {len(answer_markers)}")

    image_dir = GENERATED_IMAGES_ROOT / level / str(year)
    image_dir.mkdir(parents=True, exist_ok=True)

    questions = []
    for index, marker in enumerate(paper_markers):
        number = marker.number
        segments = question_segments(paper_doc, paper_markers, index)
        image_urls = []
        for segment_index, (page_index, rect) in enumerate(segments, start=1):
            filename = f"q{number:02d}-{segment_index}.png"
            output = image_dir / filename
            render_clip(paper_doc[page_index], rect, output)
            image_urls.append(f"/generated/{level}/{year}/{filename}")

        if answer_list_mode:
            explanation = ANSWER_LIST_EXPLANATION
            answer = answer_list_answers[number]
        else:
            explanation = extract_segment_text(answer_doc, answer_markers, index)
            answer = extract_answer(explanation, number)

        questions.append(
            {
                "number": number,
                "type": question_type(number),
                "points": score_for_question(number),
                "answer": answer,
                "images": image_urls,
                "explanation": explanation,
            }
        )

    total_score = sum(question["points"] for question in questions)
    return {
        "competition": "Australian Mathematics Competition",
        "level": level,
        "year": year,
        "durationMinutes": 60,
        "totalQuestions": len(questions),
        "totalScore": total_score,
        "questions": questions,
    }


def main() -> None:
    args = parse_args()
    output = build_question_set(args.level, args.year)
    target = GENERATED_DATA_ROOT / args.level / f"{args.year}.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote question set: {target}")
    print(f"Questions: {output['totalQuestions']} score={output['totalScore']}")


if __name__ == "__main__":
    main()
