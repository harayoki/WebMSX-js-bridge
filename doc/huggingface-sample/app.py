from pathlib import Path
from typing import Dict

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

APP_DIR = Path(__file__).resolve().parent
SAMPLES_DIR = APP_DIR / "samples"

# ここでは最低限のサンプルHTMLをまとめています。必要に応じて追加してください。
SAMPLES: Dict[str, Dict[str, str]] = {
    "bridge": {"label": "シリアルブリッジのデモ", "filename": "bridge-sample.html"},
    "fullscreen": {"label": "フルスクリーンUIのデモ", "filename": "fullscreen-panel.html"},
}

app = FastAPI(title="WebMSX JS Bridge Examples")

# Static files (CSS や JS を追加したい場合に利用)
app.mount("/static", StaticFiles(directory=APP_DIR / "static"), name="static")

# Jinja2 テンプレートの設定
templates = Jinja2Templates(directory=APP_DIR / "templates")


@app.get("/", response_class=HTMLResponse)
async def index(request: Request) -> HTMLResponse:
    """HuggingFace のトップページ: ドロップダウンでサンプルを選択。"""
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "samples": SAMPLES,
        },
    )


@app.get("/play", response_class=HTMLResponse)
async def play(request: Request, sample_id: str) -> HTMLResponse:
    sample = SAMPLES.get(sample_id)
    if not sample:
        raise HTTPException(status_code=404, detail="Sample not found")

    sample_url = request.url_for("serve_sample", sample_id=sample_id)
    return templates.TemplateResponse(
        "player.html",
        {
            "request": request,
            "sample": sample,
            "sample_url": sample_url,
        },
    )


@app.get("/sample/{sample_id}")
async def serve_sample(sample_id: str) -> FileResponse:
    sample = SAMPLES.get(sample_id)
    if not sample:
        raise HTTPException(status_code=404, detail="Sample not found")

    file_path = SAMPLES_DIR / sample["filename"]
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Sample file missing")

    return FileResponse(path=file_path, media_type="text/html")
