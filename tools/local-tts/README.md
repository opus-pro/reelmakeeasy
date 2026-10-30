# Local voices

Kokoro and Qwen3-TTS running on your own machine, so those voices cost nothing. `pnpm reelmakeeasy setup` installs this and `pnpm reelmakeeasy start` (or `pnpm dev`) starts it (the `[tts]` lines). Without it, the same voices run on fal and are billed there. The same server can also time captions with Whisper and a forced aligner (see [Speech to text](#speech-to-text)).

## What runs where

Setup detects the hardware and picks a backend:

| Machine | Backend | Engines | Models | Download |
| --- | --- | --- | --- | --- |
| Apple Silicon Mac | `mlx` (Metal GPU, via [mlx-audio](https://github.com/Blaizzy/mlx-audio)) | Kokoro, Qwen3-TTS | `mlx-community/Kokoro-82M-bf16`, `mlx-community/Qwen3-TTS-12Hz-1.7B-{CustomVoice,VoiceDesign,Base}-8bit` | ~10 GB |
| NVIDIA GPU (Windows or Linux) | `cuda` (PyTorch, [qwen-tts](https://pypi.org/project/qwen-tts/) and [kokoro](https://pypi.org/project/kokoro/)) | Kokoro, Qwen3-TTS | `hexgrad/Kokoro-82M`, `Qwen/Qwen3-TTS-12Hz-1.7B-{CustomVoice,VoiceDesign,Base}` | ~14 GB |
| Anything else | `cpu` | Kokoro | `hexgrad/Kokoro-82M` | ~0.4 GB |

On a Mac, `LOCAL_TTS_QWEN3_PRECISION=bf16` in `.env` swaps the 8-bit Qwen3 models for the full-precision `-bf16` ones. They speak more clearly, with fewer wobbles and slurred words, and are bigger: about 4.2 GB each to download, instead of 2.9 GB. Run setup again after changing it to download them.

Qwen3 also needs enough memory, so setup and the server both check before using it (limits in [`hardware.json`](hardware.json)):

| Machine | Qwen3 minimum | Recommended |
| --- | --- | --- |
| Apple Silicon | 24 GB RAM | 36 GB RAM |
| NVIDIA (Windows, Linux) | 8 GB GPU memory and 32 GB RAM | — |

Below the minimum, setup installs Kokoro only (~0.4 GB), and the server never loads Qwen3 even if it was installed earlier, so Qwen voices use fal. Between the minimum and the recommended RAM, the server keeps one Qwen3 model loaded at a time. `pnpm reelmakeeasy doctor` shows the detected memory and the decision.

### Memory

A 60-second voiceover used to take the server to 36 GB on a Mac. Two things combined: Qwen3 turned all 60 seconds of speech into audio at once, and MLX kept every freed buffer in its cache, with no limit. The server now:

- decodes Qwen3's audio as it goes (MLX streaming, every 2 s), with the same speech and word accuracy;
- caps MLX's buffer cache at 1 GB (`LOCAL_TTS_MLX_CACHE_GB`);
- on NVIDIA, speaks long text in sentence groups of about 300 characters;
- returns freed memory after every request;
- unloads every model after 5 idle minutes (`LOCAL_TTS_IDLE_UNLOAD_SECONDS`).

Measured on the same 943-character script, peak memory fell from 36 GB to 5.4 GB. With a preset and a clone model both loaded it peaks at 8.7 GB, and after the idle timeout the server holds about 0.2 GB.

Apple Silicon uses MLX rather than PyTorch's MPS backend. Both run on the same GPU, but MLX is faster here and has 8-bit Qwen builds. To force a backend, set `LOCAL_TTS_DEVICE=mps|cuda|cpu`. For CUDA, `uv pip install torch --torch-backend=auto` reads the NVIDIA driver and installs the matching CUDA build of PyTorch. Qwen3-TTS on a CPU takes minutes per sentence, so it isn't installed there, and Qwen voices keep running on fal.

Measured on an M5 Pro, with the models loaded:

| Request | Audio | Time |
| --- | --- | --- |
| Kokoro | 5 s | 0.2 s |
| Qwen3 preset speaker | 6 s | 2.3 s |
| Qwen3 voice design | 6 s | 2.2–3.1 s |
| Qwen3 voice clone | 5 s | 2.3–3.9 s |

The first request for each model loads it, which takes 0.4 s from disk. The server keeps two models in memory (`LOCAL_TTS_MAX_MODELS`), which is about 3.5 GB of RAM per Qwen model on MLX.

## Speech to text

The same server also hears speech, so caption timing and voiceover checks can run here for free instead of on ElevenLabs Scribe, fal or Gemini. The code is in [`stt.py`](stt.py). It does two jobs:

- **Transcribe** (`POST /v1/transcribe`): Whisper writes down what a voiceover says, with a time for each word. The API uses it to check that a voice read its script, and to time captions when there's no script.
- **Align** (`POST /v1/align`): a forced aligner times each word of a script we already know. It's more exact than Whisper, but it can't tell when the voice skipped a word, so it never replaces the check.

| Machine | Transcribe | Align | Download |
| --- | --- | --- | --- |
| Apple Silicon Mac | `mlx-community/whisper-large-v3-turbo-asr-8bit` (mlx-audio) | `mlx-community/Qwen3-ForcedAligner-0.6B-8bit` (mlx-audio) | ~2.15 GB |
| NVIDIA GPU, 4 GB or more | `dropbox-dash/faster-whisper-large-v3-turbo` (fp16, faster-whisper) | `facebook/wav2vec2-base-960h` (CTC alignment) | ~2.0 GB |
| Anything else | `Systran/faster-whisper-small.en` (int8, faster-whisper) | `facebook/wav2vec2-base-960h` | ~0.9 GB |

The memory each needs is the `asr` entry of [`hardware.json`](hardware.json): 8 GB of RAM on a Mac, 4 GB of GPU memory on NVIDIA (a smaller GPU gets the CPU models), 4 GB of RAM otherwise. Below that, the server leaves speech to text off and the API times captions in the cloud. `GET /health` says what's ready in its `stt` field:

```json
"stt": { "transcribe": true, "align": true, "device": "mlx",
         "models": { "transcribe": "mlx-community/whisper-large-v3-turbo-asr-8bit",
                     "align": "mlx-community/Qwen3-ForcedAligner-0.6B-8bit" } }
```

When one is missing it's `false`, with a `reason`. `/v1/transcribe` and `/v1/align` answer 404 then, so the API falls back.

Measured on an M5 Pro against six stored voiceovers (Kokoro, Qwen3 and ElevenLabs, 33–64 s), with the stored Scribe words as the reference:

| | Speed | Word starts vs Scribe (median, 90th percentile) |
| --- | --- | --- |
| Qwen3 aligner (Mac) | 80–280x real time | 60 ms, 120 ms |
| Whisper turbo (Mac) | 11–44x | 120 ms, 280 ms |
| wav2vec2 aligner (CPU) | 60x | 15–20 ms, 30–60 ms |
| Whisper small.en (CPU, int8) | 10x | |

How it runs:

- Whisper runs at temperature 0 and doesn't carry text from one 30-second window to the next, which keeps it from looping. faster-whisper also skips silence (its VAD filter).
- The Qwen3 aligner drifts on long audio: on a 293 s file the last 30 s came back 1.6 to 12 s off. So audio over 2 minutes (`LOCAL_ALIGN_MAX_SECONDS`) is aligned in pieces cut at its longest pauses, and Whisper tells which script words fall in which piece. The same file then lands within 77 ms (median) at the end. Without Whisper, the Qwen3 aligner answers 400 for audio over that limit, so the caller sends shorter pieces or falls back.
- wav2vec2 knows only letters and apostrophes, so numbers are spelled out first ("2560" is read like a year, "twenty-five sixty"). It hears long audio in 30-second windows.
- Words come back as the script's words split at spaces and dashes, punctuation kept: "year—but" is two words, and a lone "—" is none.
- Whisper and the aligner have their own slot in the model cache (`LOCAL_TTS_MAX_STT_MODELS`, default 2), so they never push a voice out. They share the one-job-at-a-time GPU lock and unload with the voices after 5 idle minutes. On a Mac both together take about 2.2 GB, and up to 3.9 GB while working.
- On NVIDIA, faster-whisper's CTranslate2 needs CUDA 12 and cuDNN 9. With other versions it can crash the whole process instead of failing politely, so before its first use the server tries it in a separate process. If that fails, Whisper runs on the CPU (int8) and the aligner stays on the GPU.

`LOCAL_ASR=off` turns speech to text off. `LOCAL_ASR_MODEL` and `LOCAL_ALIGN_MODEL` replace a model with another Hugging Face repo or a folder of the same kind.

Licences: Whisper and its MLX and CTranslate2 conversions are MIT, the Qwen3 aligner and wav2vec2 are Apache-2.0, faster-whisper and CTranslate2 are MIT.

## Where the models come from

Every voice model is on Hugging Face under **Apache-2.0**, and the speech-to-text models under MIT or Apache-2.0. None is gated or private, so they download anonymously: **no Hugging Face account and no token**. Setup sets `HF_HOME=.reelmakeeasy/models/huggingface`, which puts every download in one place. `pnpm reelmakeeasy start` (or `pnpm dev`) then runs the server with `HF_HUB_OFFLINE=1`, so it never touches the network. Behind a firewall, point `HF_ENDPOINT` at a mirror.

Apache-2.0 would also allow ReelMakeEasy to re-host the weights, for example alongside the preset pack. That isn't needed, because Hugging Face serves them anonymously and faster than a release asset. The other pieces come from PyPI, plus spaCy's English model (MIT, from GitHub releases), which Kokoro uses for pronunciation.

## Voice cloning

Qwen3-TTS clones a voice from reference speech plus the text spoken in it. Upstream quotes 3 seconds, but ReelMakeEasy asks for **at least 10 seconds**, since that's where the likeness holds. It accepts up to 5 minutes and trims anything longer. The API transcribes the sample itself, so recording can stop at any point in the script. When no transcript is available, it clones from the audio alone, at lower quality.

ReelMakeEasy is English-only for now (see AGENTS.md), so clones and designed voices speak English. A sample recorded in another language still clones; the voice then speaks English with that speaker's timbre.

A saved Qwen voice is stored as `voice-clones/<user>/qwen3/<id>.wav` (24 kHz mono) plus its transcript. Local synthesis reads those directly. If a job ever falls back to fal, the API makes a fal speaker embedding from the same audio (`<id>.safetensors`) and keeps it.

## Running it by hand

```bash
.reelmakeeasy/local-tts/venv/bin/python tools/local-tts/local_tts.py detect
.reelmakeeasy/local-tts/venv/bin/python tools/local-tts/local_tts.py serve --port 5019
curl -s localhost:5019/health
curl -s localhost:5019/v1/speech -H 'content-type: application/json' \
  -d '{"engine":"kokoro","text":"Hello there","voice":"af_heart"}' -o hello.wav
ffmpeg -loglevel error -i hello.wav -ar 16000 -ac 1 hello16k.wav
curl -s localhost:5019/v1/align -H 'content-type: application/json' \
  -d "{\"audio\":\"$(base64 < hello16k.wav | tr -d '\n')\",\"text\":\"Hello there\"}"
```

`local_tts.py selftest` runs the unit tests (fake models, nothing loaded) and checks that this backend's speech-to-text libraries import. Outside the venv, `python -m unittest discover -s tools/local-tts` needs only numpy.

To use a server on another machine (say, a GPU box), set `LOCAL_TTS_URL` in `.env`. `pnpm reelmakeeasy start` (or `pnpm dev`) then uses it instead of starting one.
