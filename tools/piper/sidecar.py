"""
Piper text-to-speech as a long-lived process, so the model is loaded once.

Why this exists rather than a subprocess per job
------------------------------------------------
Measured on the dev box: loading vi_VN-vais1000-medium costs 4.9-6.8 seconds,
and synthesising the first sentence of a chapter costs 0.11 seconds. A process
per job therefore spends ~98% of its time-to-first-sound loading a file it is
about to throw away, and single-thread throughput drops from 10.0x realtime to
5.7x for the same reason.

Keeping the voice resident is the whole point. Everything else here is in
service of that: HTTP so the audio can stream out chunk by chunk (which is what
the later HLS work needs), threads because onnxruntime releases the GIL during
inference, and a hard concurrency cap because throughput saturates at five
concurrent syntheses on eight cores and the RAM does not.

Endpoints
---------
  GET  /healthz          what is loaded, what is available, how busy
  POST /speak?voice=...  UTF-8 text in, raw signed 16-bit little-endian PCM out

The response is PCM rather than WAV because the caller concatenates, re-encodes
and eventually segments it; a RIFF header in the middle of a stream is just
something to strip. Sample rate comes back in X-Sample-Rate.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import sys
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from piper import PiperVoice, SynthesisConfig

log = logging.getLogger("piper-sidecar")

# Vietnamese piped through a pipe on Windows is decoded with the locale codec
# and arrives as lone surrogates, which then fail to re-encode inside espeak:
#   UnicodeEncodeError: 'utf-8' codec can't encode character '\udc9d'
# Belt and braces - the caller sets these on the child too, but a sidecar
# started by hand should not behave differently from one started by the worker.
os.environ.setdefault("PYTHONUTF8", "1")


class VoiceRegistry:
    """Loads voices on first use and keeps them. Loading is the expensive part."""

    def __init__(self, model_dir: Path) -> None:
        self.model_dir = model_dir
        self._voices: dict[str, PiperVoice] = {}
        self._fingerprints: dict[str, str] = {}
        self._lock = threading.Lock()

    def available(self) -> list[str]:
        return sorted(p.stem for p in self.model_dir.glob("*.onnx"))

    def loaded(self) -> list[str]:
        return sorted(self._voices)

    def fingerprint(self, name: str) -> str:
        """
        Identifies the weights, not the filename.

        This ends up inside the content hash, so it has to change when the audio
        would change and not otherwise. A version string in a filename is a
        promise nobody keeps; the digest of the weights is the thing itself, and
        it is identical on every machine that has the same model.
        """
        if name not in self._fingerprints:
            digest = hashlib.sha256()
            with (self.model_dir / f"{name}.onnx").open("rb") as fh:
                for block in iter(lambda: fh.read(1 << 20), b""):
                    digest.update(block)
            self._fingerprints[name] = digest.hexdigest()[:12]
        return self._fingerprints[name]

    def get(self, name: str) -> PiperVoice:
        # Fast path without the lock: dict reads are atomic under the GIL, and
        # the worst case is two threads loading the same voice once each.
        voice = self._voices.get(name)
        if voice is not None:
            return voice

        path = self.model_dir / f"{name}.onnx"
        if not path.exists():
            raise KeyError(name)

        with self._lock:
            if name not in self._voices:
                log.info("loading %s (this takes a few seconds)", name)
                self._voices[name] = PiperVoice.load(str(path))
                self.fingerprint(name)
                log.info("loaded %s", name)
        return self._voices[name]


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    registry: VoiceRegistry
    default_voice: str
    slots: threading.Semaphore
    max_concurrency: int
    length_scale: float
    in_flight = 0
    _counter_lock = threading.Lock()

    def log_message(self, fmt: str, *args) -> None:  # noqa: A003
        log.debug(fmt, *args)

    # -- helpers ----------------------------------------------------------

    def _json(self, status: HTTPStatus, payload: dict, headers: dict | None = None) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    # -- routes -----------------------------------------------------------

    def do_GET(self) -> None:  # noqa: N802
        if urlparse(self.path).path != "/healthz":
            self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        self._json(
            HTTPStatus.OK,
            {
                "ok": True,
                "available": self.registry.available(),
                "loaded": self.registry.loaded(),
                "default": self.default_voice,
                "fingerprints": {
                    n: self.registry.fingerprint(n) for n in self.registry.available()
                },
                "speakers": {
                    n: self.registry.get(n).config.num_speakers
                    for n in self.registry.loaded()
                },
                "inFlight": Handler.in_flight,
                "maxConcurrency": self.max_concurrency,
                "lengthScale": self.length_scale,
            },
        )

    def do_POST(self) -> None:  # noqa: N802
        url = urlparse(self.path)
        if url.path != "/speak":
            self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return

        query = parse_qs(url.query)
        name = (query.get("voice") or [self.default_voice])[0]
        try:
            length_scale = float((query.get("length") or [self.length_scale])[0])
            speaker = int((query.get("speaker") or ["0"])[0])
        except ValueError:
            # The body has not been read yet, so this connection cannot be
            # reused - the next request would be parsed out of the unread text.
            self.close_connection = True
            self._json(
                HTTPStatus.BAD_REQUEST, {"error": "length and speaker must be numbers"}
            )
            return
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length)
        try:
            text = raw.decode("utf-8").strip()
        except UnicodeDecodeError as err:
            # Strict on purpose. Vietnamese that arrives as anything but UTF-8
            # has already been corrupted upstream, and decoding it leniently
            # would turn a caller's encoding bug into a voice that mispronounces
            # words for reasons nobody can trace. Say so instead.
            self._json(
                HTTPStatus.BAD_REQUEST,
                {"error": f"body is not valid UTF-8: {err}"},
            )
            return
        if not text:
            self._json(HTTPStatus.BAD_REQUEST, {"error": "empty text"})
            return

        # Saturation is a "not yet", not a failure. 503 with Retry-After is the
        # shape the worker already understands from the cloud provider: it pauses
        # the pool and requeues without spending an attempt, so a busy sidecar
        # costs a wait rather than a retry budget.
        if not self.slots.acquire(blocking=False):
            self._json(
                HTTPStatus.SERVICE_UNAVAILABLE,
                {"error": "at capacity", "inFlight": Handler.in_flight},
                {"Retry-After": "5"},
            )
            return

        with Handler._counter_lock:
            Handler.in_flight += 1
        try:
            self._stream(name, text, length_scale, speaker)
        finally:
            with Handler._counter_lock:
                Handler.in_flight -= 1
            self.slots.release()

    def _stream(self, name: str, text: str, length_scale: float, speaker: int) -> None:
        try:
            voice = self.registry.get(name)
        except KeyError:
            self._json(
                HTTPStatus.NOT_FOUND,
                {"error": f"no such voice: {name}", "available": self.registry.available()},
            )
            return

        # length_scale stretches phoneme durations, which is how pace is set. At
        # the model's default of 1.0 this voice reads the same chapter at 276
        # words per minute against the cloud voice's 157 - it is not a subtly
        # different reading, it is nearly twice as fast, and it would fail a
        # listening test for a reason that has nothing to do with the voice.
        #
        # The response is sub-linear, because stretching phonemes does not
        # stretch the silences between them: 1.0 -> 276 wpm, 1.9 -> 186,
        # 2.2 -> 166, 2.5 -> 148. 2.3 lands on the cloud voice's pace, which is
        # the pace this project has been shipping and the one worth matching
        # while the voice itself is being judged.
        # Multi-speaker models (VIVOS has 65) pick a voice by index; single-speaker
        # models reject anything but None, so 0 is sent as "not specified".
        chunks = voice.synthesize(
            text,
            SynthesisConfig(
                length_scale=length_scale,
                speaker_id=speaker if voice.config.num_speakers > 1 else None,
            ),
        )

        # Pull the first chunk before committing to 200. Everything that tends to
        # go wrong - a bad phoneme, a mangled encoding, a missing espeak table -
        # goes wrong on the first one, and once the status line is on the wire
        # the only way left to report a failure is to hang up mid-audio.
        try:
            first = next(chunks, None)
        except Exception as err:  # noqa: BLE001
            log.exception("synthesis failed before first chunk")
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(err)})
            return

        if first is None:
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "no audio produced"})
            return

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "audio/l16")
        self.send_header("Transfer-Encoding", "chunked")
        self.send_header("X-Sample-Rate", str(first.sample_rate))
        self.send_header("X-Channels", str(first.sample_channels))
        self.send_header("X-Voice", name)
        self.send_header("X-Fingerprint", self.registry.fingerprint(name))
        self.end_headers()

        total = 0
        try:
            for chunk in (first, *chunks):
                audio = chunk.audio_int16_bytes
                total += len(audio)
                self.wfile.write(f"{len(audio):X}\r\n".encode("ascii"))
                self.wfile.write(audio)
                self.wfile.write(b"\r\n")
                self.wfile.flush()
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
        except BrokenPipeError:
            log.info("client hung up after %d bytes", total)
        except Exception:  # noqa: BLE001
            # The status line already said 200. Dropping the connection without
            # the terminating chunk is the only honest signal left, and it is one
            # the client can actually detect.
            log.exception("synthesis failed after %d bytes", total)
            self.close_connection = True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model-dir", default=os.environ.get("PIPER_MODEL_DIR", ".piper/models"))
    ap.add_argument("--voice", default=os.environ.get("PIPER_VOICE", "vi_VN-vais1000-medium"))
    ap.add_argument("--host", default=os.environ.get("PIPER_HOST", "127.0.0.1"))
    # Not 5060. That is SIP, and it sits on the Fetch spec's blocked-port list, so
    # undici - Node's fetch - refuses to connect with a bare "fetch failed" whose
    # cause is the string "bad port". curl connects happily, which makes it look
    # like the sidecar is broken only when the app talks to it.
    ap.add_argument("--port", type=int, default=int(os.environ.get("PIPER_PORT", "5062")))
    # Five is where throughput saturated on eight cores (17.1x -> 17.2x from five
    # to eight) while memory kept climbing at ~150 MB per concurrent synthesis.
    ap.add_argument(
        "--concurrency", type=int, default=int(os.environ.get("PIPER_CONCURRENCY", "5"))
    )
    ap.add_argument(
        "--length-scale",
        type=float,
        default=float(os.environ.get("PIPER_LENGTH_SCALE", "2.3")),
        help="phoneme duration multiplier; >1 is slower. 2.3 lands near 160 wpm.",
    )
    args = ap.parse_args()

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)-5s %(name)s %(message)s"
    )

    model_dir = Path(args.model_dir).resolve()
    if not model_dir.is_dir():
        log.error("model dir does not exist: %s", model_dir)
        return 1

    registry = VoiceRegistry(model_dir)
    available = registry.available()
    if not available:
        log.error("no .onnx voices in %s", model_dir)
        return 1
    log.info("voices available: %s", ", ".join(available))

    Handler.registry = registry
    Handler.default_voice = args.voice
    Handler.max_concurrency = args.concurrency
    Handler.length_scale = args.length_scale
    Handler.slots = threading.Semaphore(args.concurrency)

    if args.voice not in available:
        log.error("default voice %r not in %s", args.voice, model_dir)
        return 1

    # Load every voice before binding the port. Several are offered side by side,
    # and whichever one a listener picks first should not pay the five seconds
    # this process exists to avoid. ~140 MB each, which is cheap next to that.
    for name in available:
        registry.get(name)

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.daemon_threads = True
    log.info(
        "listening on http://%s:%d | default=%s | concurrency=%d | length=%.2f",
        args.host,
        args.port,
        args.voice,
        args.concurrency,
        args.length_scale,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("shutting down")
    return 0


if __name__ == "__main__":
    sys.exit(main())
