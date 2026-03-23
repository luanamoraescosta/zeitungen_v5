"""core/iiif.py — minimal IIIF manifest parser (v2 + v3)."""
from __future__ import annotations
import re
from typing import Any


def label(v: Any) -> str:
    if v is None: return ""
    if isinstance(v, str): return v
    if isinstance(v, list): return label(v[0]) if v else ""
    if isinstance(v, dict):
        if "@value" in v: return str(v["@value"])
        for lang in ("de", "en", "none"):
            if lang in v:
                x = v[lang]
                return label(x[0] if isinstance(x, list) and x else x)
        for x in v.values():
            return label(x[0] if isinstance(x, list) and x else x)
    return str(v)


def metadata_dict(manifest: dict) -> dict:
    out = {}
    for item in manifest.get("metadata", []):
        k = re.sub(r"<[^>]+>", "", str(label(item.get("label", "")))).strip()
        v = re.sub(r"<[^>]+>", "", str(label(item.get("value", "")))).strip()
        if k:
            out[k] = v
    return out


def parse_manifest(manifest: dict, url: str) -> dict:
    """Return enriched manifest with page list."""
    # canvases
    cvs = (
        manifest.get("sequences", [{}])[0].get("canvases", [])
        or manifest.get("items", [])
    )

    pages = []
    for i, c in enumerate(cvs, 1):
        img = _image_url(c)
        pages.append({
            "index": i,
            "label": label(c.get("label", f"Page {i}")),
            "image": img,
            "thumb": img.replace("/full/max/", "/full/200,/").replace("/full/full/", "/full/200,/") if img else "",
        })

    raw = metadata_dict(manifest)
    data = {
        "title":        label(manifest.get("label", "")),
        "manifest_url": url,
        "navDate":      manifest.get("navDate", ""),
        "attribution":  label(manifest.get("attribution", "")),
        "metadata":     raw,
        "total_pages":  len(pages),
        "pages":        pages,
    }
    for k, v in raw.items():
        kl = k.lower()
        if not data.get("date")      and any(x in kl for x in ("date","datum")):     data["date"] = v
        if not data.get("language")  and any(x in kl for x in ("lang","sprach")):    data["language"] = v
        if not data.get("publisher") and any(x in kl for x in ("verlag","publisher")): data["publisher"] = v
    return data


def _image_url(canvas: dict) -> str:
    # v2
    for img in canvas.get("images", []):
        res = img.get("resource", {})
        svc = res.get("service", {})
        if isinstance(svc, list): svc = svc[0]
        base = svc.get("@id", "") if isinstance(svc, dict) else ""
        if base: return f"{base}/full/max/0/default.jpg"
        return res.get("@id", "")
    # v3
    for ap in canvas.get("items", []):
        for ann in ap.get("items", []):
            body = ann.get("body", {})
            if isinstance(body, list): body = body[0]
            svc = body.get("service", [{}])
            if isinstance(svc, dict): svc = [svc]
            if svc:
                base = svc[0].get("@id") or svc[0].get("id", "")
                if base: return f"{base}/full/max/0/default.jpg"
            return body.get("id", "")
    return ""
