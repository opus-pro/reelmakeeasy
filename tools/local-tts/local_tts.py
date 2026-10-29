"""
ReelMakeEasy local text to speech: Kokoro and Qwen3-TTS on this machine, free.
It also hears speech (Whisper and a forced aligner, see stt.py) to time
captions and check voiceovers.

    python local_tts.py detect                 # print the backend this machine gets
    python local_tts.py download [--engines kokoro,qwen3,whisper,align]
    python local_tts.py serve [--host 127.0.0.1] [--port 5019]
    python local_tts.py selftest               # unit tests (no models) and imports

The backend is picked automatically (override with LOCAL_TTS_DEVICE):

    mlx   Apple Silicon (Metal GPU) via mlx-audio, 8-bit Qwen weights
    cuda  NVIDIA GPU via PyTorch (qwen-tts, kokoro), bf16 weights
    mps   Apple GPU via PyTorch, only when forced (mlx is faster)
    cpu   anything else; Kokoro only, Qwen is too slow on CPU

Qwen3 also needs enough memory (hardware.json): 24 GB of RAM on Apple Silicon,
or 8 GB of GPU memory and 32 GB of RAM on NVIDIA. Below that only Kokoro runs
locally, and Qwen voices use fal. Memory is kept in check by streaming Qwen3's
audio decode, capping MLX's buffer cache, freeing memory after every request
and unloading models after a few idle minutes (see `Engines`).

Models come from public Hugging Face repos (Apache-2.0, not gated), so no
account or token is needed. `pnpm reelmakeeasy setup` points HF_HOME at
<data dir>/models/huggingface so every download lands in one place.

The HTTP API is small on purpose; the ReelMakeEasy API is its only client:

    GET  /health     -> {"backend", "engines": {"kokoro": bool, "qwen3": bool},
                         "stt": {"transcribe": bool, "align": bool, "models", ...}, ...}
    POST /v1/speech  -> audio/wav
         {"engine": "kokoro", "text", "voice": "af_heart", "speed"?}
         {"engine": "qwen3",  "text", "language"?, and one of:
              "voice": "Ryan" (+ "instruct"?)          preset speaker (CustomVoice)
              "instruct": "a calm narrator..."         designed voice (VoiceDesign)
              "refAudio": <base64 WAV>, "refText"?     cloned voice (Base)}
         "bestOf": n, "prefer": "rising"   make n takes, keep the one whose pitch
                                           rises most at the end (for questions)
    POST /v1/transcribe, POST /v1/align  speech to text, see stt.py
"""

import argparse
import base64
import io
import json
import os
import platform
import sys
import threading
import time
import wave
from collections import OrderedDict

import stt

VERSION = 2

TTS_ENGINES = ("kokoro", "qwen3")
# whisper and align are speech to text (stt.py).
ENGINES = (*TTS_ENGINES, "whisper", "align")

KOKORO_MODELS = {
    "mlx": "mlx-community/Kokoro-82M-bf16",
    "torch": "hexgrad/Kokoro-82M",
}

QWEN3_MODELS = {
    "mlx": {
        "custom": "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit",
        "design": "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit",
        "clone": "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit",
    },
    "torch": {
        "custom": "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
        "design": "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",
        "clone": "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
    },
}

# 12 codec frames per second: 4096 tokens is about 5.7 minutes, far above one chunk.
QWEN3_MAX_TOKENS = 4096
# Sampling temperature for a cloned voice (the models' default is 0.9). Lower keeps every line
# closer to the reference, so a voice cloned from one sample sounds the same from line to line
# and video to video, while takes still differ enough to retry a clipped word.
QWEN3_CLONE_TEMPERATURE = 0.7


# ---------- backend detection ----------


def _mlx_available() -> bool:
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        return False
    try:
        import mlx.core as mx

        return bool(mx.metal.is_available())
    except Exception:
        return False


def detect_backend() -> str:
    forced = os.environ.get("LOCAL_TTS_DEVICE", "auto").strip().lower()
    if forced and forced != "auto":
        return forced
    if _mlx_available():
        return "mlx"
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


HARDWARE = json.loads(
    open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "hardware.json")).read()
)


def total_ram_gb() -> float:
    """Installed RAM in GB (on Apple Silicon, the memory the GPU shares)."""
    try:
        if sys.platform == "win32":
            import ctypes

            class MemoryStatus(ctypes.Structure):
                _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong)] + [
                    (name, ctypes.c_ulonglong)
                    for name in (
                        "ullTotalPhys",
                        "ullAvailPhys",
                        "ullTotalPageFile",
                        "ullAvailPageFile",
                        "ullTotalVirtual",
                        "ullAvailVirtual",
                        "ullAvailExtendedVirtual",
                    )
                ]

            status = MemoryStatus()
            status.dwLength = ctypes.sizeof(status)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status))
            return status.ullTotalPhys / 2**30
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 2**30
    except Exception:
        return 0.0


def gpu_memory_gb() -> float:
    """Memory of the NVIDIA GPU the server uses (cuda:0), or 0."""
    try:
        import torch

        if torch.cuda.is_available():
            return torch.cuda.get_device_properties(0).total_memory / 2**30
    except Exception:
        pass
    return 0.0


def qwen3_hardware(backend: str) -> dict:
    """
    Whether this machine can run Qwen3 locally without starving everything
    else: {"ok", "reason", "ramGB", "vramGB"?, "recommended"}.
    """
    need = HARDWARE["qwen3"].get(backend)
    slack = HARDWARE.get("toleranceGB", 0.75)
    info = {"ramGB": round(total_ram_gb(), 1)}
    if backend == "cuda":
        info["vramGB"] = round(gpu_memory_gb(), 1)
    if not need:
        return {**info, "ok": False, "reason": f"Qwen3 needs a GPU; this machine runs on {backend}"}
    if "minVramGB" in need and info.get("vramGB", 0) + slack < need["minVramGB"]:
        return {
            **info,
            "ok": False,
            "reason": f"Qwen3 needs {need['minVramGB']} GB of GPU memory; this GPU has {info.get('vramGB', 0)} GB",
        }
    if info["ramGB"] + slack < need["minRamGB"]:
        return {
            **info,
            "ok": False,
            "reason": f"Qwen3 needs {need['minRamGB']} GB of RAM; this machine has {info['ramGB']} GB",
        }
    recommended = need.get("recommendedRamGB")
    return {**info, "ok": True, "recommended": not recommended or info["ramGB"] + slack >= recommended}


def asr_hardware(backend: str) -> dict:
    """The speech-to-text models this machine runs, or why none (stt.asr_profile)."""
    vram = gpu_memory_gb() if backend == "cuda" else None
    return stt.asr_profile(backend, HARDWARE, round(total_ram_gb(), 1), vram)


def default_engines(backend: str) -> list[str]:
    configured = os.environ.get("LOCAL_TTS_ENGINES", "").strip()
    engines = (
        [e.strip() for e in configured.split(",") if e.strip()] if configured else list(ENGINES)
    )
    # Never load Qwen3 on a machine that can't hold it, whatever was configured.
    if not qwen3_hardware(backend)["ok"]:
        engines = [e for e in engines if e != "qwen3"]
    # Nor speech to text, which LOCAL_ASR=off also turns off.
    if not asr_hardware(backend)["ok"]:
        engines = [e for e in engines if e not in ("whisper", "align")]
    return engines


def model_family(backend: str) -> str:
    return "mlx" if backend == "mlx" else "torch"


def downloads_for(backend: str, engines: list[str]) -> list[tuple[str, list[str] | None]]:
    """(repo, files to fetch or None for all) for each model the engines need."""
    family = model_family(backend)
    repos: list[tuple[str, list[str] | None]] = []
    if "kokoro" in engines:
        repos.append((KOKORO_MODELS[family], None))
    if "qwen3" in engines:
        repos.extend((repo, None) for repo in QWEN3_MODELS[family].values())
    repos.extend(stt.model_downloads(asr_hardware(backend), engines))
    return repos


def models_for(backend: str, engines: list[str]) -> list[str]:
    return [repo for repo, _ in downloads_for(backend, engines)]


# ---------- audio ----------


def wav_bytes(samples, sample_rate: int) -> bytes:
    import numpy as np

    pcm = np.clip(np.asarray(samples, dtype=np.float32).reshape(-1), -1.0, 1.0)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(int(sample_rate))
        w.writeframes((pcm * 32767.0).astype("<i2").tobytes())
    return buf.getvalue()


def read_wav(data: bytes):
    """Decodes 16-bit PCM WAV (the API sends mono: 24 kHz for clones, 16 kHz to hear) to float32."""
    import numpy as np

    with wave.open(io.BytesIO(data), "rb") as w:
        if w.getsampwidth() != 2:
            raise ValueError("reference audio must be 16-bit PCM WAV")
        channels, rate = w.getnchannels(), w.getframerate()
        pcm = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32)
    if channels > 1:
        pcm = pcm.reshape(-1, channels).mean(axis=1)
    return pcm / 32768.0, rate


def resample(samples, from_rate: int, to_rate: int):
    import numpy as np

    if from_rate == to_rate:
        return samples
    n = int(round(len(samples) * to_rate / from_rate))
    return np.interp(
        np.linspace(0, len(samples) - 1, n), np.arange(len(samples)), samples
    ).astype(np.float32)


def decode_audio(data: str):
    """Base64 16-bit PCM WAV to 16 kHz mono float32 samples, what Whisper and the aligners take."""
    import binascii
    import struct

    import numpy as np

    try:
        samples, rate = read_wav(base64.b64decode(data, validate=True))
    except (binascii.Error, wave.Error, EOFError, struct.error, ValueError) as err:
        raise ValueError(f"audio must be a base64 16-bit PCM WAV ({err})") from err
    if len(samples) == 0:
        raise ValueError("audio is empty")
    return np.asarray(resample(samples, rate, stt.SAMPLE_RATE), dtype=np.float32)


def f0_track(samples, sr: int, fmin: float = 70.0, fmax: float = 450.0):
    """Per-10 ms pitch in Hz (NaN when unvoiced), by normalized autocorrelation."""
    import numpy as np

    n, hop = int(0.04 * sr), int(0.01 * sr)
    lo, hi = int(sr / fmax), int(sr / fmin)
    floor = 0.1 * float(np.sqrt(np.mean(samples**2)))
    out = []
    for start in range(0, len(samples) - n, hop):
        x = samples[start : start + n] - np.mean(samples[start : start + n])
        if float(np.sqrt(np.mean(x**2))) < floor:
            out.append(np.nan)
            continue
        ac = np.correlate(x, x, "full")[n - 1 :]
        ac = ac / (ac[0] + 1e-9)
        lag = lo + int(np.argmax(ac[lo:hi]))
        out.append(sr / lag if ac[lag] > 0.5 else np.nan)
    return np.array(out)


def rise_semitones(samples, sr: int) -> float:
    """
    How far the pitch rises at the end: the last 0.35 s of voicing against the
    second before it, in semitones. A question that sounds like one scores
    about +3 or more; a falling statement scores below zero.
    """
    import numpy as np

    f0 = f0_track(samples, sr)
    t = np.arange(len(f0)) * 0.01
    voiced = np.where(~np.isnan(f0))[0]
    if len(voiced) < 10:
        return float("-inf")
    end = t[voiced[-1]]
    tail = f0[voiced][t[voiced] > end - 0.35]
    body = f0[voiced][(t[voiced] > end - 1.35) & (t[voiced] <= end - 0.35)]
    if len(body) < 3:
        # A one-word take ("Right?"): compare its end with its start instead.
        k = int(len(voiced) * 0.6)
        tail, body = f0[voiced][k:], f0[voiced][:k]
    if len(tail) < 3 or len(body) < 3:
        return float("-inf")
    return float(12 * np.log2(np.median(tail) / np.median(body)))


# ---------- engines ----------


# MLX keeps freed buffers for reuse with no limit by default, so a long Qwen3
# generation used to leave the process at 36 GB. Capped, it stays near 6 GB.
MLX_CACHE_LIMIT_GB = float(os.environ.get("LOCAL_TTS_MLX_CACHE_GB", "1"))
# Models are dropped after this long without a request (0 keeps them).
IDLE_UNLOAD_SECONDS = float(os.environ.get("LOCAL_TTS_IDLE_UNLOAD_SECONDS", "300"))
# The NVIDIA path has no streaming decode, so long text goes in sentence groups.
TORCH_CHUNK_CHARS = 300


class Engines:
    """
    Loads models on first use and keeps the most recent few in memory. Memory
    is released after every request, and all models after a few idle minutes.
    """

    def __init__(self, backend: str, engines: list[str], max_models: int):
        self.backend = backend
        self.engines = engines
        self.max_models = max(1, max_models)
        self.loaded: OrderedDict[str, object] = OrderedDict()
        # Whisper and the aligner (2.15 GB together on MLX) have a slot of their
        # own, so captions never push a voice out, nor the other way round.
        self.stt_loaded: OrderedDict[str, object] = OrderedDict()
        self.max_stt_models = max(1, int(os.environ.get("LOCAL_TTS_MAX_STT_MODELS", "2")))
        # One GPU, one job at a time; FastAPI runs sync handlers on a thread pool.
        self.lock = threading.Lock()
        self.last_used = time.time()
        if backend == "mlx":
            import mlx.core as mx

            mx.set_cache_limit(int(MLX_CACHE_LIMIT_GB * 2**30))
        if IDLE_UNLOAD_SECONDS > 0:
            threading.Thread(target=self._unload_when_idle, daemon=True).start()

    def done(self):
        """After each request: return freed GPU memory to the system."""
        self.last_used = time.time()
        self._free_memory()

    def _unload_when_idle(self):
        while True:
            time.sleep(min(30.0, IDLE_UNLOAD_SECONDS))
            self.unload_if_idle()

    def unload_if_idle(self) -> bool:
        """Drops every model when none was used for IDLE_UNLOAD_SECONDS and no job runs."""
        idle = time.time() - self.last_used
        if not (self.loaded or self.stt_loaded) or idle < IDLE_UNLOAD_SECONDS:
            return False
        if not self.lock.acquire(blocking=False):
            return False
        try:
            count = len(self.loaded) + len(self.stt_loaded)
            self.loaded.clear()
            self.stt_loaded.clear()
            self._free_memory()
            print(f"[local-tts] idle {int(idle)}s: unloaded {count} model(s)", flush=True)
            return True
        finally:
            self.lock.release()

    # --- model cache ---

    def _get(self, key: str, load, cache=None, limit=None):
        cache = self.loaded if cache is None else cache
        limit = self.max_models if limit is None else limit
        if key in cache:
            cache.move_to_end(key)
            return cache[key]
        while len(cache) >= limit:
            cache.popitem(last=False)
            self._free_memory()
        started = time.time()
        model = load()
        print(f"[local-tts] loaded {key} in {time.time() - started:.1f}s", flush=True)
        cache[key] = model
        return model

    def stt_model(self, key: str, load):
        """A speech-to-text model, from its own slot of the cache."""
        return self._get(key, load, self.stt_loaded, self.max_stt_models)

    def _free_memory(self):
        import gc

        gc.collect()
        if self.backend == "mlx":
            import mlx.core as mx

            mx.clear_cache()
        elif self.backend == "cuda":
            import torch

            torch.cuda.empty_cache()

    def _torch_device(self) -> str:
        return {"cuda": "cuda:0", "mps": "mps"}.get(self.backend, "cpu")

    # --- kokoro ---

    def kokoro(self, text: str, voice: str, speed: float) -> bytes:
        lang = "b" if voice[:1] == "b" else "a"
        if self.backend == "mlx":
            from mlx_audio.utils import load_model

            def load_mlx():
                model = load_model(KOKORO_MODELS["mlx"])
                # The voice packs ship in the same repo; mlx-audio otherwise
                # looks for them in a third-party one we never downloaded.
                model.repo_id = KOKORO_MODELS["mlx"]
                return model

            model = self._get("kokoro", load_mlx)
            return self._collect_mlx(
                model.generate(text, voice=voice, speed=speed, lang_code=lang)
            )

        def load_pipeline():
            from kokoro import KModel, KPipeline

            model = KModel(repo_id=KOKORO_MODELS["torch"]).to(self._torch_device()).eval()
            return {
                code: KPipeline(lang_code=code, repo_id=KOKORO_MODELS["torch"], model=model)
                for code in ("a", "b")
            }

        pipelines = self._get("kokoro", load_pipeline)
        import numpy as np

        chunks = [
            np.asarray(result.audio.cpu() if hasattr(result.audio, "cpu") else result.audio)
            for result in pipelines[lang](text, voice=voice, speed=speed)
            if result.audio is not None
        ]
        if not chunks:
            raise ValueError("Kokoro produced no audio")
        return wav_bytes(np.concatenate(chunks), 24000)

    # --- qwen3 ---

    def qwen3(
        self,
        text: str,
        language: str,
        voice: str | None,
        instruct: str | None,
        ref_audio: bytes | None,
        ref_text: str | None,
    ) -> bytes:
        mode = "clone" if ref_audio else "custom" if voice else "design"
        if mode == "design" and not instruct:
            raise ValueError("Qwen3 needs a voice, a voice description or reference audio")
        repo = QWEN3_MODELS[model_family(self.backend)][mode]

        if self.backend == "mlx":
            from mlx_audio.utils import load_model

            model = self._get(repo, lambda: load_model(repo))
            kwargs = {"lang_code": language, "max_tokens": QWEN3_MAX_TOKENS}
            if mode == "custom":
                kwargs.update(voice=voice, instruct=instruct or None)
            elif mode == "design":
                kwargs.update(instruct=instruct)
            else:
                import mlx.core as mx

                samples, rate = read_wav(ref_audio)
                kwargs.update(
                    ref_audio=mx.array(resample(samples, rate, model.sample_rate)),
                    ref_text=ref_text or None,
                    temperature=QWEN3_CLONE_TEMPERATURE,
                )
            # Streaming decodes the audio a couple of seconds at a time instead
            # of all at once: same speech, a fraction of the peak memory.
            return self._collect_mlx(
                model.generate(text, stream=True, streaming_interval=2.0, **kwargs)
            )

        def load_torch():
            import torch
            from qwen_tts import Qwen3TTSModel

            try:
                import flash_attn  # noqa: F401

                attn = "flash_attention_2"
            except Exception:
                attn = "sdpa"
            dtype = torch.bfloat16 if self.backend in ("cuda", "mps") else torch.float32
            return Qwen3TTSModel.from_pretrained(
                repo, device_map=self._torch_device(), dtype=dtype, attn_implementation=attn
            )

        model = self._get(repo, load_torch)
        gen = {"max_new_tokens": QWEN3_MAX_TOKENS}
        ref = read_wav(ref_audio) if mode == "clone" else None

        def speak(part: str):
            if mode == "custom":
                return model.generate_custom_voice(
                    text=part, language=language, speaker=voice, instruct=instruct or None, **gen
                )
            if mode == "design":
                return model.generate_voice_design(
                    text=part, language=language, instruct=instruct, **gen
                )
            return model.generate_voice_clone(
                text=part,
                language=language,
                ref_audio=ref,
                ref_text=ref_text or None,
                x_vector_only_mode=not ref_text,
                temperature=QWEN3_CLONE_TEMPERATURE,
                **gen,
            )

        import numpy as np

        pieces, rate = [], 24000
        for part in sentence_groups(text, TORCH_CHUNK_CHARS):
            wavs, rate = speak(part)
            pieces += [np.asarray(wavs[0], dtype=np.float32), np.zeros(int(0.15 * rate), np.float32)]
            self._free_memory()
        return wav_bytes(np.concatenate(pieces[:-1]), rate)

    def _collect_mlx(self, results) -> bytes:
        import numpy as np

        chunks, rate = [], None
        for result in results:
            chunks.append(np.asarray(result.audio, dtype=np.float32))
            rate = rate or result.sample_rate
        if not chunks:
            raise ValueError("no audio generated")
        return wav_bytes(np.concatenate(chunks), rate)


def sentence_groups(text: str, max_chars: int) -> list[str]:
    """Consecutive sentences joined into pieces of at most `max_chars` (one sentence may exceed it)."""
    import re

    sentences = [s.strip() for s in re.findall(r"[^.!?]+(?:[.!?]+|$)", text) if s.strip()]
    groups: list[str] = []
    for sentence in sentences or [text]:
        if groups and len(groups[-1]) + 1 + len(sentence) <= max_chars:
            groups[-1] = f"{groups[-1]} {sentence}"
        else:
            groups.append(sentence)
    return groups


# ---------- commands ----------


def cmd_detect(_args) -> None:
    backend = detect_backend()
    engines = default_engines(backend)
    print(
        json.dumps(
            {
                "backend": backend,
                "engines": engines,
                "hardware": qwen3_hardware(backend),
                "asr": asr_hardware(backend),
                "models": models_for(backend, engines),
            }
        )
    )


def copy_instead_of_symlinks(os_name: str = os.name) -> None:
    """
    On Windows, has huggingface_hub copy files into its cache instead of
    symlinking them. Windows refuses symlinks without admin rights or Developer
    Mode, and huggingface_hub before 1.0 marks a cache folder "symlinks work"
    before testing it, so snapshot_download's parallel threads try os.symlink
    meanwhile and fail with WinError 1314.
    """
    if os_name != "nt":
        return
    from huggingface_hub import file_download

    file_download.are_symlinks_supported = lambda cache_dir=None: False


def cmd_download(args) -> None:
    from huggingface_hub import snapshot_download

    copy_instead_of_symlinks()
    backend = detect_backend()
    engines = args.engines.split(",") if args.engines else default_engines(backend)
    for repo, files in downloads_for(backend, engines):
        if os.path.isdir(os.path.expanduser(repo)):
            continue  # a model folder named in LOCAL_ASR_MODEL or LOCAL_ALIGN_MODEL
        print(f"[local-tts] downloading {repo}", flush=True)
        # Public, ungated repos: no token needed, and none is sent unless the user has one.
        snapshot_download(repo_id=repo, **({"allow_patterns": files} if files else {}))
    if "kokoro" in engines and model_family(backend) == "torch":
        # Kokoro's torch pipeline fetches voice packs lazily; fetch the ones we ship.
        from huggingface_hub import hf_hub_download

        for voice in args.kokoro_voices.split(","):
            hf_hub_download(KOKORO_MODELS["torch"], f"voices/{voice}.pt")
    print(json.dumps({"backend": backend, "engines": engines, "ok": True}), flush=True)


# Qwen3 speaks about 14 characters a second. A take far longer than that has
# picked up extra sounds or words, which very short lines ("Take a breath.") are
# prone to: "Uh, take a breath.", "Pss... take a breath.".
CHARS_PER_SECOND = 14.0
MAX_LENGTH_RATIO = 1.8
MIN_LENGTH_LIMIT_S = 1.6
EXTRA_TRIES = 2


def best_qwen3_take(generate, text: str, takes: int, rising: bool):
    """
    Makes up to `takes` usable takes (plus retries for overlong ones) and returns
    the best: the one whose pitch rises most when `rising`, else the first usable
    one. Returns (wav bytes, response headers describing the choice).
    """
    limit = max(MIN_LENGTH_LIMIT_S, MAX_LENGTH_RATIO * len(text) / CHARS_PER_SECOND)
    usable, overlong = [], []
    for _ in range(takes + EXTRA_TRIES):
        take = generate()
        samples, sr = read_wav(take)
        seconds = len(samples) / sr
        if seconds > limit:
            overlong.append((seconds, take))
            continue
        score = rise_semitones(samples, sr) if rising else 0.0
        usable.append((score, take))
        if len(usable) >= takes or (rising and score >= 4.0):
            break  # Enough takes, or one clearly rising.
    headers = {"X-Retries": str(len(overlong))} if overlong else {}
    if not usable:
        # Every take ran long; the shortest is the least likely to carry extras.
        headers["X-Overlong"] = "1"
        return min(overlong, key=lambda t: t[0])[1], headers
    score, take = max(usable, key=lambda t: t[0]) if rising else usable[0]
    if rising:
        headers["X-Rise-Semitones"] = f"{score:.1f}"
    return take, headers


def create_app(backend: str, hardware: dict, engines: Engines, speech_to_text):
    """The HTTP API. `speech_to_text` is a stt.SpeechToText sharing `engines`' lock and cache."""
    from fastapi import FastAPI, HTTPException
    from fastapi.responses import Response
    from pydantic import BaseModel

    app = FastAPI(title="ReelMakeEasy local TTS", version=str(VERSION))

    class SpeechRequest(BaseModel):
        engine: str
        text: str
        voice: str | None = None
        speed: float = 1.0
        language: str = "auto"
        instruct: str | None = None
        refAudio: str | None = None
        refText: str | None = None
        bestOf: int = 1
        prefer: str | None = None

    class TranscribeRequest(BaseModel):
        audio: str
        # null or "auto" detects the language.
        language: str | None = "en"
        wordTimestamps: bool = True

    class AlignRequest(BaseModel):
        audio: str
        text: str

    @app.get("/health")
    def health():
        return {
            "backend": backend,
            "engines": {name: name in engines.engines for name in TTS_ENGINES},
            "hardware": hardware,
            "loaded": [*engines.loaded.keys(), *engines.stt_loaded.keys()],
            "ok": True,
            "stt": speech_to_text.health(),
            "version": VERSION,
        }

    @app.post("/v1/speech")
    def speech(req: SpeechRequest):
        if req.engine not in TTS_ENGINES or req.engine not in engines.engines:
            raise HTTPException(404, f"{req.engine} is not enabled on this machine ({backend})")
        if not req.text.strip():
            raise HTTPException(400, "text is empty")
        started = time.time()
        # Kokoro is deterministic, so extra takes would all be the same.
        takes = max(1, min(req.bestOf, 5)) if req.engine == "qwen3" and req.prefer == "rising" else 1
        headers = {}
        try:
            with engines.lock:
                if req.engine == "kokoro":
                    audio = engines.kokoro(req.text, req.voice or "af_heart", req.speed)
                else:
                    ref = base64.b64decode(req.refAudio) if req.refAudio else None
                    audio, note = best_qwen3_take(
                        lambda: engines.qwen3(
                            req.text, req.language or "auto", req.voice, req.instruct, ref, req.refText
                        ),
                        req.text,
                        takes,
                        rising=req.prefer == "rising",
                    )
                    headers.update(note)
                engines.done()
        except ValueError as err:
            raise HTTPException(400, str(err)) from err
        print(
            f"[local-tts] {req.engine} {len(req.text)} chars in {time.time() - started:.1f}s"
            + "".join(f" {k[2:].lower()}={v}" for k, v in headers.items()),
            flush=True,
        )
        return Response(content=audio, media_type="audio/wav", headers=headers)

    def hear(engine: str, name: str, audio: str, run):
        """One speech-to-text job on the GPU lock: 404 when it isn't here, 400 for bad input."""
        if not speech_to_text.can(engine):
            raise HTTPException(404, f"{name} is not installed on this machine ({backend})")
        try:
            samples = decode_audio(audio)
        except ValueError as err:
            raise HTTPException(400, str(err)) from err
        started = time.time()
        with engines.lock:
            try:
                result = run(samples)
            except stt.NotEnabled as err:
                raise HTTPException(404, str(err)) from err
            except ValueError as err:
                raise HTTPException(400, str(err)) from err
            except Exception as err:
                print(f"[local-tts] {engine} failed: {type(err).__name__}: {err}", flush=True)
                raise HTTPException(500, f"{engine} failed: {err}") from err
            finally:
                engines.done()
        seconds, elapsed = len(samples) / stt.SAMPLE_RATE, time.time() - started
        print(
            f"[local-tts] {engine} {seconds:.1f}s of audio in {elapsed:.1f}s "
            f"({seconds / max(elapsed, 1e-3):.0f}x) words={len(result.get('words') or [])}"
            + (f" pieces={result['pieces']}" if result.get("pieces", 1) > 1 else ""),
            flush=True,
        )
        return result

    @app.post("/v1/transcribe")
    def transcribe(req: TranscribeRequest):
        return hear(
            "whisper",
            "Speech to text",
            req.audio,
            lambda samples: speech_to_text.transcribe(samples, req.language, req.wordTimestamps),
        )

    @app.post("/v1/align")
    def align(req: AlignRequest):
        return hear(
            "align",
            "The forced aligner",
            req.audio,
            lambda samples: speech_to_text.align(samples, req.text),
        )

    return app


def cmd_serve(args) -> None:
    import uvicorn

    backend = detect_backend()
    hardware = qwen3_hardware(backend)
    # Below the recommended RAM, keep one Qwen3 model loaded at a time.
    max_models = int(os.environ.get("LOCAL_TTS_MAX_MODELS", "2" if hardware.get("recommended") else "1"))
    enabled = default_engines(backend)
    engines = Engines(backend, enabled, max_models)
    speech_to_text = stt.SpeechToText(engines, asr_hardware(backend), enabled)
    app = create_app(backend, hardware, engines, speech_to_text)
    # Also finds the speech-to-text models on disk before the first /health.
    heard = speech_to_text.health()
    print(
        f"[local-tts] backend={backend} engines={','.join(engines.engines)} "
        f"ram={hardware['ramGB']}GB"
        + (f" vram={hardware['vramGB']}GB" if "vramGB" in hardware else "")
        + (f" (qwen3 off: {hardware['reason']})" if not hardware["ok"] else f" max_models={max_models}")
        + (
            f" stt={heard['device']}"
            if heard["transcribe"] or heard["align"]
            else f" (stt off: {heard.get('reason', 'not enabled')})"
        ),
        flush=True,
    )
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


def cmd_selftest(_args) -> int:
    """
    Checks this install without loading a model: the unit tests (fake models
    only) and the speech-to-text libraries this backend needs.
    """
    import importlib
    import unittest

    here = os.path.dirname(os.path.abspath(__file__))
    suite = unittest.defaultTestLoader.discover(here, pattern="test_*.py", top_level_dir=here)
    result = unittest.TextTestRunner(stream=sys.stderr, verbosity=1).run(suite)
    backend = detect_backend()
    modules = (
        ["mlx_audio.stt.models.whisper", "mlx_audio.stt.models.qwen3_forced_aligner"]
        if backend == "mlx"
        else ["faster_whisper", "transformers", "num2words"]
    )
    imports: dict[str, object] = {}
    for name in modules:
        try:
            importlib.import_module(name)
            imports[name] = True
        except Exception as err:
            imports[name] = f"{type(err).__name__}: {err}"
    ok = result.wasSuccessful() and all(v is True for v in imports.values())
    print(
        json.dumps(
            {
                "backend": backend,
                "ok": ok,
                "tests": result.testsRun,
                "failed": len(result.failures) + len(result.errors),
                "skipped": len(result.skipped),
                "imports": imports,
            }
        )
    )
    return 0 if ok else 1


def main() -> int | None:
    parser = argparse.ArgumentParser(description="ReelMakeEasy local text to speech")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("detect")
    download = sub.add_parser("download")
    download.add_argument("--engines", default="")
    download.add_argument("--kokoro-voices", default="af_heart")
    serve = sub.add_parser("serve")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=int(os.environ.get("LOCAL_TTS_PORT", "5019")))
    sub.add_parser("selftest")
    args = parser.parse_args()
    commands = {
        "detect": cmd_detect,
        "download": cmd_download,
        "serve": cmd_serve,
        "selftest": cmd_selftest,
    }
    return commands[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
