"""
VieNeu-TTS v3 Turbo as a long-lived process, so the model is loaded once.

Why VieNeu
----------
Edge has one Vietnamese woman's voice. VieNeu ships Northern women's voices
recorded with their speakers' consent, under Apache 2.0 (commercial use
allowed), and runs on a CPU with no GPU: measured on the dev laptop (i5-10310U,
4 cores) at about 1.3x realtime - slower than Edge's ~3.7x, so a long chapter
takes minutes to make, which the player's read-ahead hides.

Why a sidecar
-------------
Loading the model takes about a minute. A process per job would spend most of
its time loading a file it is about to throw away.

Endpoints
---------
  GET  /healthz            {ok, voices, fingerprint, sampleRate, queued}
  POST /jobs?voice=...     UTF-8 text in; 202 {id} at once
  GET  /jobs/<id>          202 {state} while waiting or speaking;
                           200 raw signed 16-bit little-endian mono PCM when done
                           (sample rate in X-Sample-Rate); 500 {error} if it
                           failed; 404 if unknown
  DELETE /jobs/<id>        the caller has the audio; forget it

A finished result is kept until the caller says it has it, not dropped on the
first read: on the dev machine large responses were sometimes cut off part way
(the client saw "other side closed"), and a result already forgotten could only
be made again from scratch. Results nobody collects expire after 30 minutes.

Submit-then-poll rather than one request held open while the voice is made,
so a long chapter never ties up a connection (or a proxy in front of it) for
minutes. Served by uvicorn: the standard library's http.server was tried
first, and Node's fetch kept losing responses from it part way (ECONNRESET,
"terminated", "other side closed"), even tiny JSON ones.

One synthesis at a time, first come first served: it is CPU-bound and already
uses every core, so a second one in parallel only makes both slower.

Run:
  python -m venv .venv && .venv/Scripts/pip install -r requirements.txt
  .venv/Scripts/python sidecar.py --port 5063
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import queue
import threading
import time
import uuid

os.environ.setdefault("PYTHONUTF8", "1")

try:
    # Trust the operating system's certificates for the first model download
    # (an antivirus that re-signs HTTPS breaks Python's own bundle).
    import truststore

    truststore.inject_into_ssl()
except ImportError:
    pass

import numpy as np
import soxr
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from importlib.metadata import version
from vieneu import Vieneu

log = logging.getLogger("vieneu-sidecar")

# 24 kHz is plenty for a voice and halves what crosses the socket; the API
# re-encodes to AAC anyway.
OUT_RATE = 24_000


class Engine:
    def __init__(self) -> None:
        started = time.time()
        self.tts = Vieneu(mode="v3turbo")
        self.voices = [name for _, name in self.tts.list_preset_voices()]
        self.fingerprint = f"vieneu:v3turbo:{version('vieneu')}"
        self.jobs: dict[str, dict] = {}
        self.todo: queue.Queue[str] = queue.Queue()
        self.guard = threading.Lock()
        threading.Thread(target=self._work, daemon=True).start()
        log.info("loaded in %.1fs, %d voices", time.time() - started, len(self.voices))

    def submit(self, text: str, voice: str) -> str:
        if voice not in self.voices:
            raise KeyError(voice)
        job_id = uuid.uuid4().hex
        with self.guard:
            self._forget_stale()
            self.jobs[job_id] = {"state": "queued", "text": text, "voice": voice, "at": time.time()}
        self.todo.put(job_id)
        return job_id

    def get(self, job_id: str) -> dict | None:
        with self.guard:
            return self.jobs.get(job_id)

    def forget(self, job_id: str) -> None:
        with self.guard:
            self.jobs.pop(job_id, None)

    def _forget_stale(self) -> None:
        # Results nobody came back for (the API restarted) would pile up in RAM.
        cutoff = time.time() - 30 * 60
        for k in [k for k, j in self.jobs.items() if j["at"] < cutoff and j["state"] != "speaking"]:
            del self.jobs[k]

    def _work(self) -> None:
        while True:
            job_id = self.todo.get()
            with self.guard:
                job = self.jobs.get(job_id)
                if not job:
                    continue
                job["state"] = "speaking"
            try:
                job["pcm"] = self._speak(job["text"], job["voice"])
                job["state"] = "done"
            except Exception as e:  # noqa: BLE001 - reported to the caller on its next poll
                log.exception("synthesis failed")
                job["error"] = str(e)[:300]
                job["state"] = "failed"
            job["at"] = time.time()

    def _speak(self, text: str, voice: str) -> bytes:
        started = time.time()
        wav = self.tts.infer(text, voice=voice)
        rate = self.tts.sample_rate
        if rate != OUT_RATE:
            wav = soxr.resample(wav, rate, OUT_RATE)
        pcm = (np.clip(wav, -1.0, 1.0) * 32767).astype("<i2").tobytes()
        log.info(
            "spoke %d chars -> %.1fs (%s) in %.1fs",
            len(text), len(pcm) / 2 / OUT_RATE, voice, time.time() - started,
        )
        return pcm


def app_for(engine: Engine) -> FastAPI:
    app = FastAPI()

    @app.get("/healthz")
    def healthz() -> dict:
        return {
            "ok": True,
            "voices": engine.voices,
            "fingerprint": engine.fingerprint,
            "sampleRate": OUT_RATE,
            "queued": engine.todo.qsize(),
        }

    @app.post("/jobs", status_code=202)
    async def submit(request: Request, voice: str = "") -> JSONResponse:
        text = (await request.body()).decode("utf-8").strip()
        if not text:
            return JSONResponse({"error": "no text"}, status_code=400)
        try:
            return JSONResponse({"id": engine.submit(text, voice)}, status_code=202)
        except KeyError:
            return JSONResponse({"error": f"unknown voice {voice}"}, status_code=400)

    @app.get("/jobs/{job_id}")
    def result(job_id: str) -> Response:
        job = engine.get(job_id)
        if job is None:
            return JSONResponse({"error": "unknown job"}, status_code=404)
        if job["state"] == "failed":
            return JSONResponse({"error": job.get("error", "failed")}, status_code=500)
        if job["state"] != "done":
            return JSONResponse({"state": job["state"]}, status_code=202)
        return Response(
            content=job["pcm"],
            media_type="application/octet-stream",
            headers={"X-Sample-Rate": str(OUT_RATE)},
        )

    @app.delete("/jobs/{job_id}")
    def forget(job_id: str) -> dict:
        engine.forget(job_id)
        return {"ok": True}

    return app


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=5063)
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    engine = Engine()
    log.info("listening on http://%s:%d", args.host, args.port)
    uvicorn.run(app_for(engine), host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
