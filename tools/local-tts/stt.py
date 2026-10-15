"""
Speech to text on this machine, for caption timing and voiceover checks. The
local voice server (local_tts.py) serves it next to the voices:

    POST /v1/transcribe  {"audio", "language"?: "en", "wordTimestamps"?: true}
         -> {"text", "words": [{"text", "start", "end", "probability"}],
             "language", "languageProbability", "duration", "model", "backend"}
         Whisper: what the audio says, with word times. It checks that a
         voice read its script, and times captions when there's no script.
         "language": null or "auto" detects the language.
    POST /v1/align       {"audio", "text"}
         -> {"words": [{"text", "start", "end"}], "duration", "model", "backend", "pieces"}
         A forced aligner: word times for a script we already know, which is
         more exact than Whisper but can't tell when a word was skipped. The
         words are the script's, split at spaces and dashes, punctuation kept
         ("year—but" is two words; a lone "—" is none).

"audio" is a base64 16-bit PCM WAV, best at 16 kHz mono. English only, like
the rest of ReelMakeEasy.

The models, per backend (hardware.json "asr" holds the memory each needs):

    mlx   mlx-audio Whisper large-v3-turbo (8-bit) and Qwen3-ForcedAligner-0.6B (8-bit)  2.15 GB
    cuda  faster-whisper large-v3-turbo (fp16) and wav2vec2-base-960h CTC alignment      2.0 GB
    cpu   faster-whisper small.en (int8) and the same wav2vec2 aligner                    0.9 GB

On NVIDIA, a GPU under 4 GB gets the CPU models, and when ctranslate2 can't
use the GPU (it needs CUDA 12 and cuDNN 9) Whisper runs on the CPU instead.
The Qwen3 aligner drifts on long audio, so audio over two minutes is aligned
in pieces cut at pauses, with Whisper telling which words fall in which piece.

LOCAL_ASR_MODEL and LOCAL_ALIGN_MODEL replace a model (a Hugging Face repo or
a folder). LOCAL_ASR=off turns both off.
"""

import os
import re
import subprocess
import sys
import types
import unicodedata

import numpy as np

SAMPLE_RATE = 16000

WHISPER_MODELS = {
    "mlx": "mlx-community/whisper-large-v3-turbo-asr-8bit",
    "cuda": "dropbox-dash/faster-whisper-large-v3-turbo",
    "cpu": "Systran/faster-whisper-small.en",
}
ALIGN_MODELS = {
    "mlx": "mlx-community/Qwen3-ForcedAligner-0.6B-8bit",
    "torch": "facebook/wav2vec2-base-960h",
}
# The files each library reads. The wav2vec2 repo also holds TensorFlow and Flax copies.
FASTER_WHISPER_FILES = [
    "config.json",
    "preprocessor_config.json",
    "model.bin",
    "tokenizer.json",
    "vocabulary.*",
]
WAV2VEC2_FILES = ["*.json", "model.safetensors"]

# Measured on the Qwen3 aligner: fine up to about two minutes, then it drifts
# (a 293 s file came back with its last 30 s off by 1.6 to 12 s).
ALIGN_MAX_SECONDS = float(os.environ.get("LOCAL_ALIGN_MAX_SECONDS", "120"))
# wav2vec2 attends over its whole input, so it hears longer audio in windows.
CTC_WINDOW_SECONDS = 30.0
# wav2vec2 gives one frame of letter probabilities per 20 ms (320 samples).
FRAME_SECONDS = 0.02
CTC_MIN_SAMPLES = 400
CPU_THREADS = max(1, min(8, os.cpu_count() or 4))


class NotEnabled(Exception):
    """The model isn't on this machine: not installed, turned off or too big for it."""


# ---------- which models ----------


def asr_profile(backend: str, hardware: dict, ram_gb: float, vram_gb=None, env=None) -> dict:
    """
    What runs speech to text on this machine: {"ok", "reason"?, "device",
    "computeType", "aligner", "whisper", "align"}. `hardware` is hardware.json.
    """
    env = os.environ if env is None else env
    if env.get("LOCAL_ASR", "").strip().lower() == "off":
        return {"ok": False, "reason": "LOCAL_ASR=off"}
    need = hardware.get("asr", {})
    slack = hardware.get("toleranceGB", 0.75)
    # mps is PyTorch on a Mac, and faster-whisper has no MPS build: the CPU models.
    device = backend if backend in ("mlx", "cuda") else "cpu"
    vram = vram_gb or 0.0
    if device == "cuda" and vram + slack < need.get("cuda", {}).get("minVramGB", 0):
        device = "cpu"
    min_ram = need.get(device, {}).get("minRamGB")
    if min_ram and ram_gb + slack < min_ram:
        return {
            "ok": False,
            "reason": f"speech to text needs {min_ram} GB of RAM; this machine has {ram_gb} GB",
        }
    if device == "cuda":
        # Turbo in fp16 takes about 3 GB of GPU memory; int8 weights halve that.
        compute = "float16" if vram + slack >= 6 else "int8_float16"
    else:
        compute = None if device == "mlx" else "int8"
    return {
        "ok": True,
        "device": device,
        "computeType": compute,
        "aligner": "qwen3" if device == "mlx" else "ctc",
        "whisper": env.get("LOCAL_ASR_MODEL") or WHISPER_MODELS[device],
        "align": env.get("LOCAL_ALIGN_MODEL")
        or ALIGN_MODELS["mlx" if device == "mlx" else "torch"],
    }


def model_downloads(profile: dict, engines: list[str]) -> list[tuple[str, list[str] | None]]:
    """(repo, files to fetch or None for all) for the speech-to-text engines in `engines`."""
    if not profile.get("ok"):
        return []
    torch = profile["device"] != "mlx"
    out = []
    if "whisper" in engines:
        out.append((profile["whisper"], FASTER_WHISPER_FILES if torch else None))
    if "align" in engines:
        out.append((profile["align"], WAV2VEC2_FILES if torch else None))
    return out


def model_on_disk(repo: str, patterns=None) -> bool:
    """A model folder, or a Hugging Face repo already in the local cache."""
    if os.path.isdir(os.path.expanduser(repo)):
        return True
    try:
        from huggingface_hub import snapshot_download

        snapshot_download(repo_id=repo, allow_patterns=patterns, local_files_only=True)
        return True
    except Exception:
        return False


def cuda_whisper_works(repo: str, compute_type: str) -> bool:
    """
    Whether faster-whisper runs on this GPU. ctranslate2 needs CUDA 12 and
    cuDNN 9, and with other versions it can abort the whole process instead
    of raising, so a child process transcribes a second of silence first.
    """
    try:
        done = subprocess.run(
            [sys.executable, os.path.abspath(__file__), "probe-cuda", repo, compute_type],
            capture_output=True,
            text=True,
            timeout=300,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    if done.returncode != 0:
        last = (done.stderr or "").strip().splitlines()[-1:] or [f"exit {done.returncode}"]
        print(f"[local-tts] whisper on the GPU failed: {last[0][:300]}", flush=True)
    return done.returncode == 0


# ---------- words ----------


def _kept(ch: str) -> bool:
    """Letters and digits: what the Qwen3 aligner keeps of a word (with apostrophes)."""
    return unicodedata.category(ch)[0] in "LN"


def caption_words(text: str) -> list[str]:
    """
    A script's words as the aligners take them: split at spaces and dashes,
    kept when they have a letter or digit, punctuation left on.
    """
    return [w for w in re.sub(r"[—–]", " ", text).split() if any(_kept(ch) for ch in w)]


_DIGITS = "zero one two three four five six seven eight nine".split()
_CURRENCY = {"$": "dollars", "€": "euros", "£": "pounds"}
_SYMBOLS = {"&": " and ", "%": " percent ", "+": " plus ", "@": " at "}
_NUMBER = re.compile(r"([$€£]?)(\d+(?:,\d{3})*(?:\.\d+)?)(st|nd|rd|th|s)?", re.IGNORECASE)


def spell_digits(digits: str) -> str:
    return " ".join(_DIGITS[int(d)] for d in digits if d.isdigit())


def _number_words(number: str, suffix: str) -> str:
    """'3,000' -> 'three thousand', '2560' -> 'twenty-five sixty' (read like a year), 21st, 1990s."""
    plain = number.replace(",", "")
    try:
        from num2words import num2words
    except ImportError:
        return spell_digits(plain)
    try:
        if suffix in ("st", "nd", "rd", "th"):
            return num2words(int(float(plain)), to="ordinal")
        if "." in plain:
            from decimal import Decimal

            words = num2words(Decimal(plain))
        elif len(plain) == 4 and "," not in number:
            words = num2words(int(plain), to="year")
        else:
            words = num2words(int(plain))
    except (ArithmeticError, ValueError, NotImplementedError):
        return spell_digits(plain)
    if suffix == "s":  # decades: 1990s, 90s
        words = words[:-1] + "ies" if words.endswith("y") else words + "s"
    return words


def spoken_letters(word: str) -> list[str]:
    """
    How wav2vec2, which knows only letters and apostrophes, hears a script
    word: numbers spelled out, symbols named, accents dropped. "3,000" ->
    ["THREE", "THOUSAND"], "U.S." -> ["US"], "well-known" -> ["WELL", "KNOWN"].
    """

    def number(m: re.Match) -> str:
        spoken = _number_words(m.group(2), (m.group(3) or "").lower())
        return f" {spoken} {_CURRENCY[m.group(1)]} " if m.group(1) else f" {spoken} "

    text = re.sub(r"[’‘ʼ]", "'", word)
    text = _NUMBER.sub(number, text)
    for symbol, spoken in _SYMBOLS.items():
        text = text.replace(symbol, spoken)
    text = "".join(
        ch for ch in unicodedata.normalize("NFKD", text) if not unicodedata.combining(ch)
    )
    text = re.sub(r"[-/]", " ", text)
    text = re.sub(r"[^A-Za-z'\s]", "", text)
    return [part.strip("'").upper() for part in text.split() if part.strip("'")]


def _match_key(word: str) -> str:
    return re.sub(r"[^\w']|_", "", word.lower().replace("’", "'"))


# ---------- pauses ----------

_FRAME, _HOP = 0.02, 0.01


def frame_levels(samples, sr: int):
    """Loudness in dBFS of 20 ms frames, one every 10 ms."""
    frame, hop = int(_FRAME * sr), int(_HOP * sr)
    if len(samples) < frame:
        return np.zeros(0)
    count = 1 + (len(samples) - frame) // hop
    squares = np.concatenate([[0.0], np.cumsum(np.asarray(samples, np.float64) ** 2)])
    starts = np.arange(count) * hop
    power = (squares[starts + frame] - squares[starts]) / frame
    return 10 * np.log10(power + 1e-12)


def find_silences(levels, min_seconds: float = 0.12, floor_db: float = -35.0):
    """
    (start, end) seconds of pauses: at least `min_seconds` under -35 dBFS (or
    20 dB under the speech, for quiet recordings), like the caption fallback.
    """
    if len(levels) == 0:
        return []
    threshold = min(floor_db, float(np.percentile(levels, 95)) - 20.0)
    quiet = np.concatenate([[0], (levels < threshold).astype(np.int8), [0]])
    edges = np.flatnonzero(np.diff(quiet))
    centre = _FRAME / 2
    return [
        (a * _HOP + centre, (b - 1) * _HOP + centre)
        for a, b in zip(edges[::2], edges[1::2])
        if (b - a) * _HOP >= min_seconds
    ]


def cut_points(samples, sr: int, max_seconds: float) -> list[float]:
    """
    Where to cut audio longer than `max_seconds` so that no piece is longer:
    in the middle of the longest pause in the second half of each stretch,
    or at its quietest moment when it has no pause.
    """
    duration = len(samples) / sr
    if duration <= max_seconds:
        return []
    levels = frame_levels(samples, sr)
    centres = np.arange(len(levels)) * _HOP + _FRAME / 2
    smooth = np.convolve(levels, np.ones(5) / 5, mode="same")
    silences = find_silences(levels)
    cuts, start = [], 0.0
    while duration - start > max_seconds:
        lo, hi = start + max_seconds / 2, start + max_seconds
        inside = [s for s in silences if lo <= (s[0] + s[1]) / 2 <= hi]
        if inside:
            a, b = max(inside, key=lambda s: s[1] - s[0])
            cut = (a + b) / 2
        else:
            window = np.flatnonzero((centres >= lo) & (centres <= hi))
            cut = float(centres[window[np.argmin(smooth[window])]]) if len(window) else hi
        cuts.append(float(cut))
        start = cut
    return cuts


def split_words_at(
    words: list[str], heard: list[dict], cuts: list[float], duration: float
) -> list[int]:
    """
    Which script words fall in which piece: bounds [0, b1, ..., len(words)],
    so piece k gets words[bounds[k]:bounds[k + 1]]. A word's time comes from the Whisper word
    it matches, or from between its matched neighbours, and the word goes to
    the piece its middle falls in. Cuts sit in pauses, far from any middle.
    """
    import difflib

    count = len(words)
    xs, ys = [-1.0], [0.0]
    matcher = difflib.SequenceMatcher(
        a=[_match_key(w) for w in words], b=[_match_key(h["text"]) for h in heard], autojunk=False
    )
    for block in matcher.get_matching_blocks():
        for k in range(block.size):
            h = heard[block.b + k]
            xs.append(float(block.a + k))
            ys.append((h["start"] + h["end"]) / 2)
    xs.append(float(count))
    ys.append(duration)
    middles = np.maximum.accumulate(np.interp(np.arange(count), xs, ys))
    return [0, *(int(np.searchsorted(middles, c)) for c in cuts), count]


def align_in_pieces(
    samples, sr: int, words, align_piece, heard_words, max_seconds=ALIGN_MAX_SECONDS
):
    """
    Aligns `words` with `align_piece(samples, words) -> [{"text", "start",
    "end"}]` in pieces of at most `max_seconds`, cut at pauses.
    `heard_words(samples)` returns Whisper's words, which tell where to split
    the script; without it, long audio goes in one piece.
    """
    cuts = cut_points(samples, sr, max_seconds) if heard_words else []
    if not cuts:
        return list(align_piece(samples, words))
    duration = len(samples) / sr
    bounds = split_words_at(words, heard_words(samples), cuts, duration)
    edges = [0.0, *cuts, duration]
    out = []
    for k in range(len(edges) - 1):
        piece_words = words[bounds[k] : bounds[k + 1]]
        if not piece_words:
            continue
        a, b = int(round(edges[k] * sr)), int(round(edges[k + 1] * sr))
        offset = a / sr
        for w in align_piece(samples[a:b], piece_words):
            out.append({**w, "start": w["start"] + offset, "end": w["end"] + offset})
    return out


# ---------- CTC alignment (wav2vec2) ----------


def ctc_viterbi(log_probs, targets: list[int], blank: int):
    """
    The most likely CTC path that spells `targets`, as torchaudio's
    forced_align finds it: for each frame, its state in [blank, t0, blank,
    t1, ..., blank], where odd states are targets. Raises ValueError when
    there are too few frames to spell them.
    """
    frames = len(log_probs)
    ext = np.full(2 * len(targets) + 1, blank, dtype=np.int64)
    ext[1::2] = targets
    states = len(ext)
    # A state may be skipped into from two back only past a blank between different letters.
    jumpable = np.zeros(states, dtype=bool)
    jumpable[3::2] = ext[3::2] != ext[1:-2:2]
    if frames == 0:
        raise ValueError("the audio is too short for this text")
    alpha = np.full(states, -np.inf)
    alpha[:2] = log_probs[0, ext[:2]]
    back = np.zeros((frames, states), dtype=np.int8)
    for t in range(1, frames):
        step = np.concatenate(([-np.inf], alpha[:-1]))
        jump = np.where(jumpable, np.concatenate(([-np.inf, -np.inf], alpha[:-2])), -np.inf)
        best = np.maximum(alpha, step)
        choice = (step > alpha).astype(np.int8)
        better = jump > best
        best[better] = jump[better]
        choice[better] = 2
        back[t] = choice
        alpha = best + log_probs[t, ext]
    end = max(range(max(0, states - 2), states), key=lambda s: alpha[s])
    if not np.isfinite(alpha[end]):
        raise ValueError("the audio is too short for this text")
    path = np.empty(frames, dtype=np.int64)
    for t in range(frames - 1, -1, -1):
        path[t] = end
        end -= int(back[t, end])  # int: an int8 here would make `end` int8 too
    return path


def ctc_align_words(
    log_probs, frame_times, words: list[str], vocab: dict, blank: int
) -> list[dict]:
    """
    Word times from wav2vec2's letter probabilities: a word spans the frames
    of its first to its last letter. A word with no letter wav2vec2 knows
    gets the gap between its neighbours.
    """
    separator = vocab.get("|")
    targets: list[int] = []
    spans: list[tuple[int, int] | None] = []
    for word in words:
        parts = [[vocab[c] for c in part if c in vocab] for part in spoken_letters(word)]
        parts = [p for p in parts if p]
        if not parts:
            spans.append(None)
            continue
        if targets and separator is not None:
            targets.append(separator)
        first = len(targets)
        for k, part in enumerate(parts):
            if k and separator is not None:
                targets.append(separator)
            targets.extend(part)
        spans.append((first, len(targets) - 1))
    if not targets:
        raise ValueError("the text has no letters to align")
    path = ctc_viterbi(log_probs, targets, blank)
    on_target = np.flatnonzero(path % 2 == 1)
    index = path[on_target] // 2
    first_frame = np.full(len(targets), len(path))
    last_frame = np.full(len(targets), -1)
    np.minimum.at(first_frame, index, on_target)
    np.maximum.at(last_frame, index, on_target)
    out = []
    for word, span in zip(words, spans):
        if span is None:
            out.append({"text": word, "start": None, "end": None})
            continue
        out.append(
            {
                "text": word,
                "start": float(frame_times[first_frame[span[0]]]),
                "end": float(frame_times[last_frame[span[1]]] + FRAME_SECONDS),
            }
        )
    for i, w in enumerate(out):
        if w["start"] is None:
            before = next(
                (out[j]["end"] for j in range(i - 1, -1, -1) if out[j]["end"] is not None), 0.0
            )
            after = next((x["start"] for x in out[i + 1 :] if x["start"] is not None), before)
            w["start"], w["end"] = before, max(before, after)
    return out


# ---------- the engine ----------


class SpeechToText:
    """
    Whisper and the aligner. They load on first use into their own slot of
    the server's model cache (so they never push a voice out), run under its
    one-job-at-a-time GPU lock, and unload with the voices after a few idle
    minutes. Callers hold `engines.lock` around transcribe() and align().
    """

    def __init__(self, engines, profile: dict, enabled: list[str], on_disk=None, probe_cuda=None):
        self.engines = engines
        self.profile = profile
        self.enabled = (
            [e for e in ("whisper", "align") if e in enabled] if profile.get("ok") else []
        )
        self.on_disk = on_disk or model_on_disk
        self.probe_cuda = probe_cuda or cuda_whisper_works
        self.whisper_device = profile.get("device")
        self.whisper_compute = profile.get("computeType")
        self._present: dict[str, bool] = {}
        self._cuda_checked = False

    def _model(self, engine: str) -> tuple[str, list[str] | None]:
        """(repo, files) of an enabled engine."""
        (found,) = model_downloads(self.profile, [engine])
        return found

    def can(self, engine: str) -> bool:
        """Enabled here and downloaded."""
        if engine not in self.enabled:
            return False
        repo, patterns = self._model(engine)
        if not self._present.get(repo):
            self._present[repo] = self.on_disk(repo, patterns)
        return self._present[repo]

    def health(self) -> dict:
        ready = {e: self.can(e) for e in ("whisper", "align")}
        repo = lambda e: self._model(e)[0] if e in self.enabled else None  # noqa: E731
        out = {
            "transcribe": ready["whisper"],
            "align": ready["align"],
            "device": self.whisper_device if self.enabled else None,
            "models": {"transcribe": repo("whisper"), "align": repo("align")},
        }
        missing = [repo(e) for e in self.enabled if not ready[e]]
        if not self.profile.get("ok"):
            out["reason"] = self.profile["reason"]
        elif not self.enabled:
            out["reason"] = "not installed: run `pnpm reelmakeeasy setup`"
        elif missing:
            out["reason"] = f"{', '.join(missing)} not downloaded: run `pnpm reelmakeeasy setup`"
        return out

    # --- transcribe ---

    def transcribe(self, samples, language="en", word_timestamps=True) -> dict:
        if not self.can("whisper"):
            raise NotEnabled("speech to text is not installed on this machine")
        language = None if not language or language.lower() == "auto" else language
        model = self._whisper()
        run = self._mlx_transcribe if self.whisper_device == "mlx" else self._faster_transcribe
        result = run(model, np.asarray(samples, np.float32), language, word_timestamps)
        result["words"] = [
            {
                "text": w["text"].strip(),
                "start": round(float(w["start"]), 3),
                "end": round(float(w["end"]), 3),
                "probability": round(float(w["probability"]), 3),
            }
            for w in result["words"]
            if w["text"].strip()
        ]
        return {
            **result,
            "duration": round(len(samples) / SAMPLE_RATE, 3),
            "model": self.profile["whisper"],
            "backend": self.whisper_device,
        }

    def _whisper(self):
        repo = self.profile["whisper"]
        if self.whisper_device == "cuda" and not self._cuda_checked:
            self._cuda_checked = True
            if not self.probe_cuda(repo, self.whisper_compute):
                print(
                    "[local-tts] Whisper can't use this GPU (ctranslate2 needs CUDA 12 and cuDNN 9); "
                    "it runs on the CPU",
                    flush=True,
                )
                self.whisper_device, self.whisper_compute = "cpu", "int8"
        return self.engines.stt_model(
            f"whisper:{repo}",
            lambda: self._load_whisper(repo, self.whisper_device, self.whisper_compute),
        )

    def _load_whisper(self, repo: str, device: str, compute_type: str | None):
        if device == "mlx":
            from mlx_audio.stt import load

            return load(repo)
        if device == "cuda":
            import torch  # noqa: F401  Its CUDA libraries are the ones ctranslate2 then finds.
        from faster_whisper import WhisperModel

        return WhisperModel(repo, device=device, compute_type=compute_type, cpu_threads=CPU_THREADS)

    @staticmethod
    def _mlx_transcribe(model, samples, language, word_timestamps) -> dict:
        out = model.generate(
            samples,
            language=language,
            word_timestamps=word_timestamps,
            temperature=0.0,
            condition_on_previous_text=False,
            verbose=None,
        )
        return {
            "text": (out.text or "").strip(),
            "language": out.language or language,
            "languageProbability": None,
            "words": [
                {
                    "text": w["word"],
                    "start": w["start"],
                    "end": w["end"],
                    "probability": w.get("probability", 0.0),
                }
                for segment in out.segments or []
                for w in segment.get("words") or []
            ],
        }

    @staticmethod
    def _faster_transcribe(model, samples, language, word_timestamps) -> dict:
        segments, info = model.transcribe(
            samples,
            language=language,
            word_timestamps=word_timestamps,
            temperature=0.0,
            condition_on_previous_text=False,
            vad_filter=True,
        )
        segments = list(segments)  # lazy: this is where it runs
        return {
            "text": "".join(s.text for s in segments).strip(),
            "language": info.language,
            "languageProbability": round(float(info.language_probability), 3),
            "words": [
                {"text": w.word, "start": w.start, "end": w.end, "probability": w.probability}
                for s in segments
                for w in s.words or []
            ],
        }

    # --- align ---

    def align(self, samples, text: str) -> dict:
        if not self.can("align"):
            raise NotEnabled("no forced aligner on this machine")
        words = caption_words(text)
        if not words:
            raise ValueError("text has no words to align")
        samples = np.asarray(samples, np.float32)
        seconds = len(samples) / SAMPLE_RATE
        too_long = seconds > ALIGN_MAX_SECONDS and not self.can("whisper")
        if self.profile["aligner"] == "qwen3" and too_long:
            # In one call it drifts by seconds on long audio; Whisper tells where to cut it.
            raise ValueError(
                f"{seconds:.0f} s of audio is longer than the aligner's {ALIGN_MAX_SECONDS:.0f} s "
                "without Whisper to split it: send pieces of at most that"
            )
        model = self._aligner()
        pieces = 0

        def align_piece(piece, piece_words):
            nonlocal pieces
            pieces += 1
            if self.profile["aligner"] == "qwen3":
                return self._qwen3_piece(model, piece, piece_words)
            return self._ctc_piece(model, piece, piece_words)

        heard = (lambda s: self.transcribe(s, "en", True)["words"]) if self.can("whisper") else None
        aligned = align_in_pieces(samples, SAMPLE_RATE, words, align_piece, heard)
        duration = len(samples) / SAMPLE_RATE
        out = []
        for w in aligned:
            start = min(max(0.0, float(w["start"])), duration)
            out.append(
                {
                    "text": w["text"],
                    "start": round(start, 3),
                    "end": round(min(max(start, float(w["end"])), duration), 3),
                }
            )
        return {
            "words": out,
            "duration": round(duration, 3),
            "model": self.profile["align"],
            "backend": self.profile["device"],
            "pieces": pieces,
        }

    def _aligner(self):
        repo = self.profile["align"]
        return self.engines.stt_model(f"align:{repo}", lambda: self._load_aligner(repo))

    def _load_aligner(self, repo: str):
        if self.profile["aligner"] == "qwen3":
            from mlx_audio.stt import load

            return load(repo)
        import torch
        from transformers import Wav2Vec2CTCTokenizer, Wav2Vec2ForCTC

        device = (
            "cuda:0" if self.profile["device"] == "cuda" and torch.cuda.is_available() else "cpu"
        )
        tokenizer = Wav2Vec2CTCTokenizer.from_pretrained(repo)
        return types.SimpleNamespace(
            model=Wav2Vec2ForCTC.from_pretrained(repo).to(device).eval(),
            vocab=tokenizer.get_vocab(),
            blank=tokenizer.pad_token_id,
            device=device,
        )

    @staticmethod
    def _qwen3_piece(model, samples, words: list[str]) -> list[dict]:
        result = model.generate(samples, text=" ".join(words), language="English")
        items = list(result.items)
        if len(items) != len(words):
            raise RuntimeError(f"the aligner returned {len(items)} words for {len(words)}")
        return [
            {"text": w, "start": float(it.start_time), "end": float(it.end_time)}
            for w, it in zip(words, items)
        ]

    def _ctc_piece(self, model, samples, words: list[str]) -> list[dict]:
        edges = [
            0.0,
            *cut_points(samples, SAMPLE_RATE, CTC_WINDOW_SECONDS),
            len(samples) / SAMPLE_RATE,
        ]
        log_probs, times = [], []
        for a, b in zip(edges, edges[1:]):
            i, j = int(round(a * SAMPLE_RATE)), int(round(b * SAMPLE_RATE))
            lp = self._ctc_log_probs(model, samples[i:j])
            log_probs.append(lp)
            times.append(i / SAMPLE_RATE + np.arange(len(lp)) * FRAME_SECONDS)
        return ctc_align_words(
            np.concatenate(log_probs), np.concatenate(times), words, model.vocab, model.blank
        )

    @staticmethod
    def _ctc_log_probs(model, samples):
        import torch

        x = np.asarray(samples, np.float32)
        if len(x) < CTC_MIN_SAMPLES:
            x = np.pad(x, (0, CTC_MIN_SAMPLES - len(x)))
        x = (x - x.mean()) / np.sqrt(x.var() + 1e-7)  # what its feature extractor does
        with torch.inference_mode():
            logits = model.model(torch.from_numpy(x)[None].to(model.device)).logits[0]
            return torch.log_softmax(logits.float(), dim=-1).cpu().numpy()


def _probe_cuda(repo: str, compute_type: str) -> None:
    import torch  # noqa: F401  As in the server: torch first, so ctranslate2 finds its CUDA libraries.
    from faster_whisper import WhisperModel

    model = WhisperModel(repo, device="cuda", compute_type=compute_type)
    segments, _ = model.transcribe(np.zeros(SAMPLE_RATE, np.float32), language="en")
    list(segments)


if __name__ == "__main__":
    if sys.argv[1:2] == ["probe-cuda"] and len(sys.argv) == 4:
        _probe_cuda(sys.argv[2], sys.argv[3])
    else:
        sys.exit("usage: stt.py probe-cuda <whisper repo> <compute type>")
