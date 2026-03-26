# services/annotation_store.py
from __future__ import annotations
import json, time, hashlib
from pathlib import Path
from typing import Any

BASE = Path("data/annotations")
BASE.mkdir(parents=True, exist_ok=True)

def _doc_id(manifest_url: str) -> str:
    return hashlib.sha1(manifest_url.encode("utf-8", errors="ignore")).hexdigest()[:16]

def _path(manifest_url: str) -> Path:
    return BASE / f"{_doc_id(manifest_url)}.json"

def load_doc(manifest_url: str) -> dict[str, Any]:
    p = _path(manifest_url)
    if not p.exists():
        return {"manifest_url": manifest_url, "created_at": int(time.time()), "annotations": []}
    return json.loads(p.read_text(encoding="utf-8"))

def save_doc(manifest_url: str, doc: dict[str, Any]) -> None:
    p = _path(manifest_url)
    p.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")

def add_annotation(manifest_url: str, ann: dict[str, Any]) -> dict[str, Any]:
    doc = load_doc(manifest_url)
    doc["annotations"].append(ann)
    doc["updated_at"] = int(time.time())
    save_doc(manifest_url, doc)
    return ann

def list_annotations(manifest_url: str) -> list[dict[str, Any]]:
    return load_doc(manifest_url).get("annotations", [])