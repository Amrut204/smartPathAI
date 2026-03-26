from __future__ import annotations

import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Tuple

import fitz
import numpy as np
from rapidocr_onnxruntime import RapidOCR


ROOT_DIR = Path(__file__).resolve().parents[2]
SUMMARY_DIR = ROOT_DIR / "analysis_output" / "pdf_summaries"
QUEUE_DIR = ROOT_DIR / "analysis_output" / "pdf_ocr_queue"
MANIFEST_PATH = SUMMARY_DIR / "manifest.jsonl"
QUEUE_MANIFEST_PATH = QUEUE_DIR / "ocr_needed_manifest.jsonl"
RUN_SUMMARY_PATH = QUEUE_DIR / "ocr_refresh_summary.json"

MAX_PAGES_TO_PROCESS = 16
TARGET_TEXT_CHARS = 12000
MIN_OK_TEXT_CHARS = 400

STOP_WORDS = {
    "the", "and", "for", "with", "this", "that", "from", "into", "your", "their",
    "have", "will", "also", "than", "there", "where", "when", "what", "which", "while",
    "page", "pages", "chapter", "section", "unit", "topic", "topics", "notes", "guide",
    "using", "used", "useful", "through", "based", "these", "those", "over", "under",
    "into", "about", "after", "before", "being", "between", "across", "placement",
    "preparation", "resource", "resources", "document", "documents", "questions",
    "answers", "company", "test", "tests", "paper", "papers",
}

BRANCH_RULES = {
    "CSE": [
        "algorithm", "data structure", "dbms", "database", "operating system", "os",
        "computer network", "networking", "compiler", "java", "python", "c++", "javascript",
        "machine learning", "software", "coding", "programming",
    ],
    "IT": [
        "database", "network", "cloud", "web", "software", "python", "java", "sql", "data",
    ],
    "ECE": [
        "electronics", "embedded", "signals", "communication", "microprocessor", "vlsi",
        "digital logic", "analog", "semiconductor", "control system",
    ],
    "EEE": [
        "electrical", "power system", "machine", "circuit", "transformer", "motor",
        "generation", "transmission", "distribution", "drives",
    ],
    "ME": [
        "mechanical", "thermodynamics", "manufacturing", "machine design", "fluid mechanics",
        "strength of materials", "production", "heat transfer", "engineering mechanics",
    ],
    "Civil": [
        "civil", "structural", "surveying", "concrete", "geotechnical", "transportation",
        "soil", "hydrology", "environmental engineering", "construction",
    ],
}

TRACK_RULES = {
    "aptitude": [
        "aptitude", "reasoning", "probability", "percentage", "profit and loss", "time and work",
        "number system", "permutation", "combination", "series", "puzzle",
    ],
    "verbal": [
        "verbal", "grammar", "sentence", "vocabulary", "reading comprehension", "synonym", "antonym",
    ],
    "HR interview": [
        "hr interview", "behavioral", "tell me about yourself", "strength", "weakness", "resume",
    ],
    "technical interview": [
        "technical interview", "coding interview", "interview question", "system design",
    ],
    "core subjects": [
        "thermodynamics", "signals", "power system", "dbms", "operating system", "surveying",
        "electrical", "mechanical", "civil", "electronics",
    ],
    "software placement crossover": [
        "coding", "algorithm", "data structure", "sql", "python", "java", "c++", "software",
    ],
    "analyst/data crossover": [
        "analytics", "statistics", "data analysis", "excel", "sql", "business analysis", "data science",
    ],
}

RESOURCE_TYPE_RULES = {
    "formula_sheet": ["formula", "cheat sheet", "shortcut", "revision sheet"],
    "interview_prep": ["interview", "hr", "behavioral", "resume"],
    "aptitude_prep": ["aptitude", "reasoning", "quant", "verbal"],
    "technical_prep": ["coding", "algorithm", "dbms", "operating system", "network", "electronics"],
    "textbook": ["textbook", "edition", "publisher", "chapter", "preface"],
    "notes": ["notes", "lecture", "module", "unit", "handwritten"],
    "general_reference": ["guide", "handbook", "manual", "reference"],
}


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def load_jsonl(path: Path) -> List[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf8").splitlines() if line.strip()]


def write_jsonl(path: Path, rows: List[dict]) -> None:
    path.write_text("\n".join(json.dumps(row, ensure_ascii=True) for row in rows) + ("\n" if rows else ""), encoding="utf8")


def build_summary_file_path(relative_path: str) -> Path:
    stem = re.sub(r"[^A-Za-z0-9]+", "_", relative_path).strip("_")
    if not stem:
        stem = "ocr_summary"
    return SUMMARY_DIR / f"{stem}.json"


def load_existing_summary_files() -> Dict[str, Tuple[Path, dict]]:
    mapping: Dict[str, Tuple[Path, dict]] = {}
    for file_path in SUMMARY_DIR.glob("*.json"):
        if file_path.name == "manifest.jsonl":
            continue
        try:
            payload = json.loads(file_path.read_text(encoding="utf8"))
        except Exception:
            continue
        relative_path = str(payload.get("relative_path", "")).replace("\\", "/").strip()
        if relative_path:
            mapping[relative_path.lower()] = (file_path, payload)
    return mapping


def extract_page_text(doc: fitz.Document, page_index: int, engine: RapidOCR) -> Tuple[str, bool]:
    page = doc.load_page(page_index)
    embedded = normalize_text(page.get_text("text"))
    if len(embedded) >= 120:
        return embedded, False

    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    image = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
    result, _ = engine(image)
    if not result:
        return embedded, True

    ocr_text = normalize_text(" ".join(line[1] for line in result if len(line) > 1))
    merged = normalize_text(" ".join(part for part in [embedded, ocr_text] if part))
    return merged, True


def collect_text(pdf_path: Path, engine: RapidOCR) -> Tuple[str, int, int, int]:
    doc = fitz.open(pdf_path)
    page_count = doc.page_count
    parts: List[str] = []
    ocr_pages = 0
    processed = 0

    for index in range(page_count):
        if processed >= MAX_PAGES_TO_PROCESS:
            break
        page_text, used_ocr = extract_page_text(doc, index, engine)
        processed += 1
        if used_ocr:
            ocr_pages += 1
        if page_text:
            parts.append(page_text)
        if sum(len(part) for part in parts) >= TARGET_TEXT_CHARS:
            break

    doc.close()
    return normalize_text(" ".join(parts)), page_count, processed, ocr_pages


def score_matches(text: str, rules: Dict[str, List[str]]) -> List[str]:
    lowered = text.lower()
    scored: List[Tuple[str, int]] = []
    for label, keywords in rules.items():
        score = sum(1 for keyword in keywords if keyword in lowered)
        if score:
            scored.append((label, score))
    scored.sort(key=lambda item: (-item[1], item[0]))
    return [label for label, _ in scored]


def infer_branch_relevance(text: str) -> List[str]:
    matches = score_matches(text, BRANCH_RULES)
    return matches[:3] if matches else ["all"]


def infer_career_tracks(text: str) -> List[str]:
    matches = score_matches(text, TRACK_RULES)
    if not matches:
        return ["core subjects"]
    return matches[:3]


def infer_resource_type(text: str) -> str:
    matches = score_matches(text, RESOURCE_TYPE_RULES)
    return matches[0] if matches else "general_reference"


def infer_difficulty(text: str) -> str:
    lowered = text.lower()
    if any(keyword in lowered for keyword in ["advanced", "research", "design", "analysis", "graduate level"]):
        return "hard"
    if any(keyword in lowered for keyword in ["introduction", "fundamentals", "basics", "beginner", "objective"]):
        return "easy"
    return "medium"


def infer_topics(title: str, text: str) -> List[str]:
    tokens = re.findall(r"[A-Za-z][A-Za-z+\-]{2,}", f"{title} {text}".lower())
    counts = Counter(token for token in tokens if token not in STOP_WORDS)
    ordered = [token.replace("-", " ") for token, _ in counts.most_common(8)]
    seen = set()
    topics: List[str] = []
    for token in ordered:
        normalized = token.title()
        if normalized not in seen:
            topics.append(normalized)
            seen.add(normalized)
    return topics[:5]


def build_summary(row: dict, full_text: str, page_count: int, processed_pages: int, ocr_pages: int) -> dict:
    relative_path = str(row["relative_path"]).replace("\\", "/")
    file_name = Path(relative_path).name
    title = normalize_text(str(row.get("title") or Path(file_name).stem))
    combined = normalize_text(f"{title} {relative_path} {full_text}")

    branch_relevance = infer_branch_relevance(combined)
    career_tracks = infer_career_tracks(combined)
    resource_type = infer_resource_type(combined)
    difficulty = infer_difficulty(combined)
    key_topics = infer_topics(title, full_text)
    keywords = key_topics[:]

    if len(full_text) < MIN_OK_TEXT_CHARS:
        status = "low_text"
        summary_short = f"{title} was OCR processed, but only limited text could be extracted."
        summary_detailed = "OCR recovered only partial text. The document may still need a higher quality scan or a dedicated OCR pass."
    else:
        status = "ok"
        topic_text = ", ".join(key_topics[:3]) if key_topics else "placement preparation topics"
        track_text = ", ".join(career_tracks[:2]) if career_tracks else "general preparation"
        summary_short = f"{title} covers {topic_text} and is useful for {track_text}."
        summary_detailed = (
            f"{title} is a {resource_type.replace('_', ' ')} resource. OCR recovered text across "
            f"{processed_pages} pages, highlighting {topic_text}. It is most relevant for {track_text} "
            f"with a {difficulty} difficulty level."
        )

    important_points = []
    for segment in re.split(r"(?<=[.!?])\s+", full_text):
        cleaned = normalize_text(segment)
        if 40 <= len(cleaned) <= 220:
            important_points.append(cleaned)
        if len(important_points) == 5:
            break

    if not important_points and full_text:
        important_points = [normalize_text(full_text[:220])]

    search_text = normalize_text(
        f"{title}. Topics: {', '.join(key_topics)}. Tracks: {', '.join(career_tracks)}. "
        f"Keywords: {', '.join(keywords)}. OCR text excerpt: {full_text[:3000]}"
    )

    recommended_for = []
    if "aptitude" in career_tracks:
        recommended_for.append("Placement aptitude preparation")
    if "technical interview" in career_tracks or "software placement crossover" in career_tracks:
        recommended_for.append("Technical interview revision")
    if "core subjects" in career_tracks:
        recommended_for.append("Branch core subject revision")
    if not recommended_for:
        recommended_for.append("General preparation")

    return {
        "pdf_path": str((ROOT_DIR / "material" / relative_path).as_posix()),
        "relative_path": relative_path,
        "file_name": file_name,
        "title": title,
        "page_count": page_count,
        "status": status,
        "summary_short": summary_short,
        "summary_detailed": summary_detailed,
        "key_topics": key_topics,
        "keywords": keywords,
        "branch_relevance": branch_relevance,
        "career_tracks": career_tracks,
        "difficulty": difficulty,
        "resource_type": resource_type,
        "search_text": search_text,
        "important_points": important_points,
        "prerequisites": [],
        "recommended_for": recommended_for,
        "source_mode": "local_pdf",
        "ocr_refresh": {
            "refreshed_at": datetime.now(timezone.utc).isoformat(),
            "processed_pages": processed_pages,
            "ocr_pages": ocr_pages,
            "text_chars": len(full_text),
        },
    }


def build_markdown(summary: dict) -> str:
    return "\n".join([
        f"# {summary['title']}",
        "",
        f"- File path: `{summary['relative_path']}`",
        f"- Status: `{summary['status']}`",
        f"- Page count: `{summary['page_count']}`",
        f"- Resource type: `{summary['resource_type']}`",
        f"- Difficulty: `{summary['difficulty']}`",
        "",
        "## Short Summary",
        summary["summary_short"],
        "",
        "## Detailed Summary",
        summary["summary_detailed"],
        "",
        "## Key Topics",
        *(f"- {item}" for item in summary["key_topics"]),
        "",
        "## Important Points",
        *(f"- {item}" for item in summary["important_points"]),
        "",
        "## Branch Relevance",
        *(f"- {item}" for item in summary["branch_relevance"]),
        "",
        "## Career Tracks",
        *(f"- {item}" for item in summary["career_tracks"]),
        "",
        "## Recommended For",
        *(f"- {item}" for item in summary["recommended_for"]),
        "",
    ])


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    if not MANIFEST_PATH.exists():
        raise FileNotFoundError(f"Manifest not found: {MANIFEST_PATH}")
    if not QUEUE_MANIFEST_PATH.exists():
        raise FileNotFoundError(f"OCR queue not found: {QUEUE_MANIFEST_PATH}")

    manifest_rows = load_jsonl(MANIFEST_PATH)
    queue_rows = load_jsonl(QUEUE_MANIFEST_PATH)
    summary_files = load_existing_summary_files()
    manifest_by_path = {str(row.get("relative_path", "")).replace("\\", "/").lower(): row for row in manifest_rows}

    engine = RapidOCR()

    refreshed = 0
    failed = 0
    low_text = 0
    failures = []
    attempted = 0

    for queue_row in queue_rows:
        relative_path = str(queue_row["relative_path"]).replace("\\", "/")
        absolute_path = Path(queue_row["absolute_path"])
        manifest_key = relative_path.lower()

        existing_row = manifest_by_path.get(manifest_key)
        summary_file_entry = summary_files.get(manifest_key)
        summary_json_path = summary_file_entry[0] if summary_file_entry else None
        summary_payload = summary_file_entry[1] if summary_file_entry else None

        if existing_row and existing_row.get("ocr_refresh") and str(existing_row.get("status")) != "ocr_needed":
            continue
        if summary_payload and summary_payload.get("ocr_refresh") and str(summary_payload.get("status")) != "ocr_needed":
            manifest_by_path[manifest_key] = summary_payload
            continue
        if args.limit and attempted >= args.limit:
            break

        if not absolute_path.exists():
            failed += 1
            failures.append({"relative_path": relative_path, "error": "file_missing"})
            continue

        try:
            attempted += 1
            full_text, page_count, processed_pages, ocr_pages = collect_text(absolute_path, engine)
            summary = build_summary(queue_row, full_text, page_count, processed_pages, ocr_pages)

            manifest_by_path[manifest_key] = summary

            if summary_json_path is None:
                summary_json_path = build_summary_file_path(relative_path)

            summary_md_path = summary_json_path.with_suffix(".md")
            summary_json_path.write_text(json.dumps(summary, indent=2, ensure_ascii=True), encoding="utf8")
            summary_md_path.write_text(build_markdown(summary), encoding="utf8")
            updated_rows = [manifest_by_path.get(str(row.get("relative_path", "")).replace("\\", "/").lower(), row) for row in manifest_rows]
            write_jsonl(MANIFEST_PATH, updated_rows)

            refreshed += 1
            if summary["status"] == "low_text":
                low_text += 1
        except Exception as exc:  # noqa: BLE001
            failed += 1
            failures.append({"relative_path": relative_path, "error": str(exc)})

    updated_rows = [manifest_by_path.get(str(row.get("relative_path", "")).replace("\\", "/").lower(), row) for row in manifest_rows]
    write_jsonl(MANIFEST_PATH, updated_rows)

    RUN_SUMMARY_PATH.write_text(
        json.dumps(
            {
                "total_queue_rows": len(queue_rows),
                "attempted_this_run": attempted,
                "refreshed": refreshed,
                "low_text": low_text,
                "failed": failed,
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "failures": failures,
            },
            indent=2,
        ),
        encoding="utf8",
    )

    print("OCR summary refresh complete")
    print(f"Queue rows: {len(queue_rows)}")
    print(f"Refreshed: {refreshed}")
    print(f"Low text: {low_text}")
    print(f"Failed: {failed}")
    print(f"Run summary: {RUN_SUMMARY_PATH}")


if __name__ == "__main__":
    main()
