# Piper + HLS — measured findings, and where to resume

Status: **Change 1 is built and working end to end.** Piper synthesises real
chapters through the real queue and worker, encodes to AAC, content-hashes and
stores exactly as before. It sits behind `TTS_DRIVER`, which still defaults to
`gemini`. What remains before flipping that default is a listening test, which
is a human judgement and has not been made. HLS (Change 2) is not started.

Everything below was measured on 2026-09-11 on the dev box (8 logical cores, no
GPU, Windows), against real Vietnamese chapters from the database — not
estimated.

## What was built

```
tools/piper/sidecar.py                    resident voice, HTTP, streams PCM
apps/api/src/tts/piper-tts.driver.ts      TtsDriver over that sidecar
```

Selected by `TTS_DRIVER=piper`; everything downstream of the driver is
unchanged. Proven end to end: a 920-word chapter enqueued in 167 ms, synthesised
and encoded by the worker, stored as a 1.72 MB `.m4a` under its content hash -
and the prefetch of the *next* chapter fired on its own, which is the existing
pipeline confirming it still works under a new driver.

## Setup that exists on this machine

```
.piper/venv/                                  piper-tts 1.8.0 (OHF-Voice/piper1-gpl)
.piper/models/vi_VN-vais1000-medium.onnx      63 MB + .onnx.json
```

`/.piper/` is gitignored. Both are reproducible: `pip install piper-tts`, and
the model from HuggingFace `rhasspy/piper-voices`. Note that the bundled
downloader (`python -m piper.download_voices`) fails on this machine with
`CERTIFICATE_VERIFY_FAILED`; `curl -L` against the HuggingFace `resolve/main`
URL works, and is what was used.

## Does it work for Vietnamese

Three voices exist. The spec proposed `vivos`, which is the weakest of them:

| voice | quality | speakers | size |
|---|---|---|---|
| `vi_VN-vais1000-medium` | medium, 22.05 kHz | 1 | 63 MB |
| `vi_VN-25hours_single-low` | low, 16 kHz | 1 | 63 MB |
| `vi_VN-vivos-x_low` | x_low, 16 kHz | 65 | 28 MB |

`vais1000-medium` was chosen for benchmarking: the highest quality tier, and
single-speaker, which is what a narrator should be. VIVOS is an ASR corpus — 65
speakers recorded for recognition rather than synthesis — so it is the least
likely of the three to sound like a narrator.

**Outstanding and blocking: nobody has listened to it yet.** A sample is at
`scratchpad/piper-sample.wav` (a real chapter, ~3.4 minutes). The stage's own
gate is that Vietnamese quality is acceptable, and that judgement is Phuc's. If
it fails, try `25hours_single-low` before abandoning Piper.

## Latency, measured on five real chapters

Subprocess per synthesis, which is how the spec proposed running it:

```
chapter          words   audio     wall   first-sound   RTF
Sợi tóc            920  201.1s    32.3s         5.7s   6.2x
Người ở trước      933  206.3s    37.8s         7.1s   5.5x
Mười hai bước      880  189.7s    35.0s         5.6s   5.4x
Hộp thiếc          927  201.0s    34.5s         6.3s   5.8x
Lối thứ ba        1064  229.8s    39.7s         6.6s   5.8x

17.1 min of audio in 179.4s wall  ->  5.7x realtime
```

Against Gemini this is already the win the stage was after, but the flat spread
matters more than the median. Gemini ran 29–195s on this kind of chapter, a
**6.7x** spread with no way to know in advance which you would get. Piper is
32.3–39.7s, a **1.23x** spread, on hardware we own. Predictable latency is what
makes pre-render scheduling and a progress bar honest.

## The finding that changes the design

Isolating where the 6.3s of first-sound actually goes:

| | cost |
|---|---|
| python interpreter + `import piper` | 0.5–0.8s |
| **loading the model** | **4.9–6.8s** |
| synthesising the first sentence | **0.11s** |

First-sound is ~98% model load and ~2% speech. **So subprocess-per-job is the
wrong deployment model.** The spec's "recommend subprocess first (simplest),
reconsider if latency of spawning per request is significant" resolves to: it is
significant, it is very nearly all of it, reconsider now.

With the model resident:

```
threads    wall    audio   throughput     RSS
      1    7.3s      73s       10.0x    292 MB
      3   14.5s     220s       15.1x    533 MB
      5   21.4s     365s       17.1x    837 MB
      8   34.0s     585s       17.2x   1102 MB
```

Three things fall out of that table:

- **Single-thread throughput goes 5.7x -> 10.0x realtime.** Reloading the model
  on every job was costing ~43% of capacity, quite apart from latency.
- **Throughput saturates at ~5 concurrent** (17.1x -> 17.2x going from 5 to 8).
  Eight threads buy nothing and cost 265 MB. `NARRATION_CONCURRENCY=4` is the
  setting, on 8 cores.
- **~141 MB resident for the model, ~150 MB per concurrent synthesis.** A 1 GB
  worker holds the voice and about five jobs in flight. That answers the spec's
  open question 5: the ceiling is RAM per concurrent job, not the model.

### What this means for the target

The stage aimed at 5–10s to first sound on a cold chapter. With a resident
model, synthesising the first sentence takes **0.11s**. Sub-second first-sound
is reachable — roughly an order of magnitude better than the stage's own success
criterion — but only via a sidecar, and not at all via subprocesses.


## Found while wiring it up

Four of these would each have cost a day, and none is visible in the design.

**Node's `fetch` refuses port 5060.** The sidecar first listened on 5060, and
`curl` talked to it happily while the API reported only `fetch failed`. undici
implements the Fetch spec's blocked-port list, 5060 is SIP, and the cause is the
bare string `bad port`. The sidecar now defaults to **5062**. The lesson is
larger than the number: a local service port has to be chosen from outside that
list, or the failure shows up only in the client you care about.

**The default voice was a Gemini constant.** `DEFAULT_VOICE` - `'Kore'` - was
imported from `gemini-tts.driver` and used as the default argument in the
controller and three service methods, so switching drivers produced
`Unknown voice "Kore"` on every request. The default now comes from
`this.driver.defaultVoice`. A driver-specific constant used as a global default
is exactly the kind of thing a driver interface is supposed to prevent, and it
survived because there had only ever been one driver.

**Piper reads Vietnamese nearly twice as fast as the cloud voice.** Same
chapter, same counting: Gemini 157 words/min, Piper 276. Audiobooks sit at
150-160. Left alone, a listening test would have failed on pace and been read as
a verdict on the voice. `length_scale` fixes it, and its response is sub-linear
because stretching phonemes does not stretch the silences between them:

```
scale   1.0    1.3    1.5    1.7    1.9    2.2    2.5    2.8
wpm     276    246    220    201    186    166    148    136
```

**2.3** is the default, which lands on the pace this project has been shipping.

**Pace is part of the fingerprint.** It changes the audio, so it belongs in the
content hash beside the model digest - otherwise re-tuning it would serve every
listener the old pace forever, out of a cache with nothing to invalidate it.

**The sidecar and the API race at boot.** The sidecar spends five to seven
seconds loading the model before it binds; an API starting alongside it loses
that race about half the time, and a single health check at boot left narration
dead until someone restarted the API. The driver now retries every 15 seconds
until it connects, which also covers a sidecar redeployed under a running API.

### One thing deliberately left alone

`enqueueOne` looks up `audioClip` by `(contributionId, voice)` **before** it
computes a content hash, so an existing clip is served whatever produced it.
That is right for a driver switch - the voice ids differ (`Kore` versus
`vi_VN-vais1000-medium`), so Piper does not serve Gemini's audio, and nothing
re-renders a catalogue because a provider changed. But it also means **re-tuning
the pace does not re-render chapters that already have audio**: the row-level
cache never reaches the hash that knows about pace.

Making the row cache compare its stored `contentHash` against the expected one
would fix it in a line, at the cost of re-rendering everything whenever the
model or pace changes. That is cheap on Piper and expensive on a metered
provider, so it is a decision rather than a patch, and it is Phuc's to make.

## Decisions this settles

1. **Sidecar, not subprocess.** A long-lived process holds the voice; the Node
   worker talks to it over HTTP with chunked transfer, rather than a framed
   stdio protocol. Streaming PCM out is the whole point of Mode B, and stdio
   would need hand-rolled framing to separate audio from control messages. HTTP
   also gives a health check and lets the sidecar restart independently of the
   worker. onnxruntime releases the GIL during inference, so a threaded server
   gets the concurrency in the table above from one resident model.
2. **`vi_VN-vais1000-medium`**, pending the listening test.
3. **UTF-8 must be forced across the process boundary.** Vietnamese piped to
   Python on Windows is decoded with the locale codec and arrives as surrogates:
   `UnicodeEncodeError: 'utf-8' codec can't encode character '\udc9d'`. Set
   `PYTHONIOENCODING=utf-8` and `PYTHONUTF8=1` on the child and write stdin as an
   explicit UTF-8 Buffer. This is not a test artefact — it would have hit every
   chapter in production, and it is the kind of bug that presents as a bad voice
   rather than as a bad pipe.
4. **`NARRATION_CONCURRENCY=4`.**

## Two corrections to the spec

**Pre-render is no longer bounded by the paywall.** The spec says to leave it
"bounded by the paywall (unchanged)". That was the bug fixed in `70ab2fc`:
`unlockPrice` defaults to 0, an ungated story is readable to the last chapter,
and publishing walked all of it. It is now `PRERENDER_CHAPTERS=3`, flat. The
spec's actual intent — *do not make pre-render unbounded just because Piper is
free* — is unchanged and is now enforced by a constant rather than by a paywall
most stories do not have. Keep it a separate conversation, as the spec says.

**`StorageDriver` needs no change at all.** The spec allows extending it
"minimally" to take a directory. The interface is `put(key, body, contentType)`,
so an HLS asset is N calls to `put` under a shared `{hash}/` prefix. Several
files is not a different shape of write, just more of them. Write the manifest
**last** — it is what makes the asset visible, so publishing it before its chunks
exist is the one ordering that can be observed as broken.

## What is left

1. **Listen.** `scratchpad/pace-*.wav` is the same chapter at eight speeds;
   `pace-2.3` is the configured default and `pace-1.0` is the model's own. Judge
   the voice at a pace that is not wrong, then decide between `vais1000-medium`
   and `25hours_single-low`.
2. Flip `TTS_DRIVER=piper` by default once the voice is accepted. Keep Gemini.
3. Decide the cache question above, if pace ends up needing another pass.
4. Only then HLS Mode A, then Mode B.

### Open, and deliberately not answered yet

- **Mode B's failure policy.** Chunks are written under the content hash as they
  are produced, so a synthesis that dies after chunk 3 leaves a partial asset at
  the canonical location. The `audio_clips` row is only written on completion, so
  a retry re-synthesises and overwrites — but a player may be mid-stream on the
  partial. Decide before Mode B, not during.
- **R2 read-after-write visibility** for a manifest rewritten once per chunk.
  Untested; test before Mode B.

## Env vars this will add

```
TTS_DRIVER=gemini            # gemini | piper. Default preserves today's behaviour.
PIPER_URL=http://127.0.0.1:5060
PIPER_VOICE=vi_VN-vais1000-medium
HLS_ENABLED=false
HLS_CHUNK_SECONDS=6
```
