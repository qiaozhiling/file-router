"""Single-service address registry. Run with: python server.py --port 8000."""

import argparse
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from html import escape
import json
import logging
import os
from pathlib import Path
import tempfile
from threading import Lock
from typing import Optional
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel, Field, model_validator


def checked_address(value: str) -> str:
    if not 1 <= len(value) <= 2048:
        raise ValueError("address length must be between 1 and 2048 characters")
    if any(ord(char) < 33 or ord(char) == 127 or char == "\\" for char in value):
        raise ValueError("address must not contain whitespace, control characters or backslashes")
    parsed = urlsplit(value)
    if (parsed.scheme not in ("http", "https") or not parsed.hostname
            or parsed.username is not None or parsed.password is not None
            or parsed.port == 0):
        raise ValueError("address must be an HTTP(S) URL with a hostname and no credentials")
    return value


class Heartbeat(BaseModel):
    address: Optional[str] = Field(default=None, min_length=1, max_length=2048)
    addresses: Optional[list[str]] = Field(default=None, min_length=1, max_length=64)
    reportIntervalSeconds: int = Field(default=300, gt=0, le=2147483647, strict=True)

    @model_validator(mode="after")
    def normalize_addresses(self):
        values = self.addresses if self.addresses is not None else ([self.address] if self.address else [])
        if not values:
            raise ValueError("at least one service address is required")
        if self.address is not None:
            checked_address(self.address)
        self.addresses = list(dict.fromkeys(checked_address(value) for value in values))
        self.address = self.addresses[0]
        return self


class DeviceStore:
    def __init__(self, path: Path):
        self.path = path
        self.lock = Lock()
        self.state: Optional[dict] = None

    def load(self) -> None:
        if not self.path.exists():
            return
        # A corrupt file is reported at startup and preserved for inspection.
        with self.path.open(encoding="utf-8") as stream:
            record = json.load(stream)
        heartbeat = Heartbeat.model_validate(record)
        seen = datetime.fromisoformat(record["lastSeen"])
        if seen.tzinfo is None:
            raise ValueError("lastSeen in devices.json must include a timezone")
        self.state = {
            "address": heartbeat.address,
            "addresses": heartbeat.addresses,
            "reportIntervalSeconds": heartbeat.reportIntervalSeconds,
            "lastSeen": seen.astimezone(timezone.utc).isoformat(),
        }

    def update(self, heartbeat: Heartbeat) -> None:
        with self.lock:
            record = {
                "address": heartbeat.address,
                "addresses": list(heartbeat.addresses),
                "lastSeen": datetime.now(timezone.utc).isoformat(),
                "reportIntervalSeconds": heartbeat.reportIntervalSeconds,
            }
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.path.parent,
                                                 prefix=self.path.name + ".", suffix=".tmp",
                                                 delete=False) as stream:
                    temporary = Path(stream.name)
                    json.dump(record, stream, ensure_ascii=False, indent=2)
                    stream.write("\n")
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary, self.path)
                # Publish only after the new snapshot has been saved successfully.
                self.state = record
            finally:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)

    def snapshot(self) -> Optional[dict]:
        with self.lock:
            return dict(self.state, addresses=list(self.state["addresses"])) if self.state is not None else None


def render_page(record: Optional[dict]) -> str:
    if record is None:
        content = '<p class="status">尚未收到服务地址</p><p>请在 JAR 启动参数中配置发现服务 URL，然后刷新此页。</p>'
    else:
        seen = datetime.fromisoformat(record["lastSeen"])
        timeout = max(900, record["reportIntervalSeconds"] * 3)
        online = (datetime.now(timezone.utc) - seen).total_seconds() < timeout
        status = "最近有上报" if online else "可能离线"
        label = "打开文件服务" if online else "尝试打开文件服务"
        addresses = record.get("addresses") or [record["address"]]
        links = ""
        for index, value in enumerate(addresses, start=1):
            address = escape(value, quote=True)
            suffix = f" · 地址 {index}" if len(addresses) > 1 else ""
            links += f'''<section class="entry"><p class="address">{address}</p>
            <a class="button" href="{address}" rel="noreferrer">{label}{suffix}</a></section>'''
        updated = escape(seen.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"))
        content = f'''<p class="status">{status}</p>
        <p>最后上报：{updated}</p>{links}
        <p class="note">请选择当前网络能够访问的地址。打开后由手机直接连接文件服务。</p>'''
    return f'''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>文件服务入口</title><style>
*{{box-sizing:border-box}}body{{margin:0;padding:24px;background:#f3f5f8;color:#243047;
font:16px/1.7 system-ui,sans-serif}}main{{max-width:560px;margin:8vh auto;background:#fff;
padding:28px;border-radius:16px;box-shadow:0 8px 32px #18223812}}h1{{font-size:24px;margin-top:0}}
.status{{font-weight:600}}.entry{{border-top:1px solid #e6eaf0;padding-top:8px}}
.address{{overflow-wrap:anywhere}}.button{{display:block;text-align:center;
padding:12px;background:#245bdd;color:white;border-radius:8px;text-decoration:none;margin:24px 0}}
.note{{font-size:14px;color:#5e6a7d}}.refresh{{color:#245bdd}}</style></head>
<body><main><h1>文件服务入口</h1>{content}<a class="refresh" href="">刷新状态</a></main></body></html>'''


def create_app(data_file: Optional[Path] = None) -> FastAPI:
    store = DeviceStore(Path(data_file) if data_file is not None else Path(
        os.environ.get("DISCOVERY_DATA_FILE", str(Path(__file__).with_name("devices.json")))))

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        store.load()
        yield

    application = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @application.post("/api/heartbeat", status_code=204)
    def heartbeat(body: Heartbeat):
        try:
            store.update(body)
        except OSError as exception:
            logging.exception("Could not save devices.json")
            raise HTTPException(status_code=503, detail="Could not save service address") from exception
        return Response(status_code=204)

    @application.get("/", response_class=HTMLResponse)
    def index():
        return HTMLResponse(render_page(store.snapshot()), headers={
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
        })

    return application


app = create_app()


if __name__ == "__main__":
    import uvicorn

    parser = argparse.ArgumentParser(description="File Router public discovery service (no authentication)")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--data-file", type=Path, default=Path(__file__).with_name("devices.json"))
    options = parser.parse_args()
    uvicorn.run(create_app(options.data_file), host=options.host, port=options.port, workers=1,
                access_log=False)
