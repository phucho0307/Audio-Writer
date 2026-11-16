"""
Speak text with Microsoft Edge's read-aloud voices, for EdgeTtsDriver.

    python edge_speak.py <voice> <rate>   < text (UTF-8)   > mp3
    python edge_speak.py --check                              (exit 0 if usable)

The text comes in on stdin rather than as an argument: a chapter is several
thousand characters and Windows caps a command line well short of that. Long
text is cut at paragraphs and sentences, the pieces are spoken a few at a time
in parallel, and they come back joined as one MP3 stream.

`truststore` makes Python trust the operating system's certificates, the way
browsers do. Without it, a machine whose antivirus re-signs HTTPS traffic
(Avast does) rejects Microsoft's certificate and every request fails.
"""

import asyncio
import sys

try:
    import truststore

    truststore.inject_into_ssl()
except ImportError:
    pass

import edge_tts


# Small enough that four run side by side; large enough that a sentence is
# never cut and the voice keeps its intonation across a paragraph.
PIECE_CHARS = 700
PARALLEL = 4


def pieces(text: str) -> list[str]:
    """Paragraphs, packed up to PIECE_CHARS; a longer paragraph by sentence."""
    import re

    units: list[str] = []
    for para in re.split(r"\n\s*\n|\n", text):
        para = para.strip()
        if not para:
            continue
        if len(para) <= PIECE_CHARS:
            units.append(para)
        else:
            units.extend(s for s in re.split(r"(?<=[.!?…])\s+", para) if s)
    out: list[str] = []
    for u in units:
        if out and len(out[-1]) + 1 + len(u) <= PIECE_CHARS:
            out[-1] += "\n" + u
        else:
            out.append(u)
    return out


async def one(text: str, voice: str, rate: str, gate: asyncio.Semaphore) -> bytes:
    async with gate:
        for attempt in range(3):
            try:
                buf = bytearray()
                async for chunk in edge_tts.Communicate(text, voice, rate=rate).stream():
                    if chunk["type"] == "audio" and chunk.get("data"):
                        buf += chunk["data"]
                if buf:
                    return bytes(buf)
            except Exception:
                if attempt == 2:
                    raise
            await asyncio.sleep(1 + attempt)
        raise SystemExit("no audio returned")


async def speak(voice: str, rate: str) -> None:
    text = sys.stdin.buffer.read().decode("utf-8").strip()
    if not text:
        raise SystemExit("no text on stdin")
    # Pieces are spoken at the same time and written back in order. MP3 is a
    # run of independent frames, so the joined stream decodes as one file.
    gate = asyncio.Semaphore(PARALLEL)
    parts = await asyncio.gather(*(one(p, voice, rate, gate) for p in pieces(text)))
    sys.stdout.buffer.write(b"".join(parts))
    sys.stdout.buffer.flush()


def main() -> None:
    if sys.argv[1:] == ["--check"]:
        print(edge_tts.__version__ if hasattr(edge_tts, "__version__") else "ok")
        return
    if len(sys.argv) != 3:
        raise SystemExit("usage: edge_speak.py <voice> <rate>")
    asyncio.run(speak(sys.argv[1], sys.argv[2]))


if __name__ == "__main__":
    main()
