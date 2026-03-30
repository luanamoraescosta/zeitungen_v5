import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles

from api import manifest, ocr, annotations
from api import crops  # <-- added
from core import http_client

app = FastAPI(title="Digitale Zeitungen — Tesseract OCR", version="0.6.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")

app.include_router(manifest.router, prefix="/api")
app.include_router(ocr.router, prefix="/api")
app.include_router(annotations.router, prefix="/api")
app.include_router(crops.router, prefix="/api")  # <-- added

@app.on_event("shutdown")
async def shutdown():
    await http_client.close()

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return FileResponse("static/favicon.ico")

@app.get("/", response_class=HTMLResponse)
async def root():
    return Path("templates/index.html").read_text(encoding="utf-8")