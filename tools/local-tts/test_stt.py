"""
Unit tests for stt.py with fake models: nothing is downloaded or loaded.

    python -m unittest discover -s tools/local-tts       # any Python with numpy
    python tools/local-tts/local_tts.py selftest         # in the voice venv
"""

import importlib.util
import os
import sys
import types
import unittest
from unittest import mock

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import stt  # noqa: E402

HAS_NUM2WORDS = importlib.util.find_spec("num2words") is not None
SR = stt.SAMPLE_RATE

HARDWARE = {
    "asr": {"mlx": {"minRamGB": 8}, "cuda": {"minVramGB": 4}, "cpu": {"minRamGB": 4}},
    "toleranceGB": 0.75,
}


def speech(seconds: float, seed: int = 0):
    """Loud noise standing in for speech."""
    rng = np.random.default_rng(seed)
    return (0.3 * rng.standard_normal(int(seconds * SR))).astype(np.float32)


def silence(seconds: float):
    return np.zeros(int(seconds * SR), np.float32)


def talk(*parts):
    """("s", 8) is 8 s of speech, ("q", 0.5) half a second of quiet."""
    return np.concatenate(
        [speech(s, i) if kind == "s" else silence(s) for i, (kind, s) in enumerate(parts)]
    )


class CaptionWordsTest(unittest.TestCase):
    def test_splits_at_spaces_and_dashes_and_drops_bare_punctuation(self):
        self.assertEqual(
            stt.caption_words("It's 3,000 years old—but who knew? — Wow–really."),
            ["It's", "3,000", "years", "old", "but", "who", "knew?", "Wow", "really."],
        )

    def test_keeps_hyphenated_words_and_acronyms_whole(self):
        self.assertEqual(
            stt.caption_words("A well-known U.S. fact & more"),
            ["A", "well-known", "U.S.", "fact", "more"],
        )


class SpokenLettersTest(unittest.TestCase):
    def test_letters_apostrophes_and_accents(self):
        self.assertEqual(stt.spoken_letters("don’t"), ["DON'T"])
        self.assertEqual(stt.spoken_letters("Café,"), ["CAFE"])
        self.assertEqual(stt.spoken_letters("U.S."), ["US"])
        self.assertEqual(stt.spoken_letters("well-known"), ["WELL", "KNOWN"])
        self.assertEqual(stt.spoken_letters("☺"), [])

    @unittest.skipUnless(HAS_NUM2WORDS, "num2words is not installed")
    def test_numbers_are_spelled_out(self):
        self.assertEqual(stt.spoken_letters("3,000"), ["THREE", "THOUSAND"])
        self.assertEqual(stt.spoken_letters("2560"), ["TWENTY", "FIVE", "SIXTY"])
        self.assertEqual(stt.spoken_letters("1990s"), ["NINETEEN", "NINETIES"])
        self.assertEqual(stt.spoken_letters("21st"), ["TWENTY", "FIRST"])
        self.assertEqual(stt.spoken_letters("1.5"), ["ONE", "POINT", "FIVE"])
        self.assertEqual(stt.spoken_letters("50%"), ["FIFTY", "PERCENT"])
        self.assertEqual(stt.spoken_letters("$5"), ["FIVE", "DOLLARS"])

    def test_numbers_without_num2words_fall_back_to_digits(self):
        self.assertEqual(stt.spell_digits("305"), "three zero five")


class AsrProfileTest(unittest.TestCase):
    def profile(self, backend, ram, vram=None, **env):
        return stt.asr_profile(backend, HARDWARE, ram, vram, env)

    def test_apple_silicon_gets_mlx_whisper_turbo_and_the_qwen3_aligner(self):
        p = self.profile("mlx", 48)
        self.assertTrue(p["ok"])
        self.assertEqual(p["device"], "mlx")
        self.assertEqual(p["aligner"], "qwen3")
        self.assertEqual(p["whisper"], "mlx-community/whisper-large-v3-turbo-asr-8bit")
        self.assertEqual(p["align"], "mlx-community/Qwen3-ForcedAligner-0.6B-8bit")

    def test_a_mac_below_the_minimum_runs_none(self):
        p = self.profile("mlx", 6)
        self.assertFalse(p["ok"])
        self.assertIn("8 GB", p["reason"])

    def test_nvidia_gets_faster_whisper_turbo_and_wav2vec2(self):
        p = self.profile("cuda", 32, 12)
        self.assertEqual((p["device"], p["computeType"], p["aligner"]), ("cuda", "float16", "ctc"))
        self.assertEqual(p["whisper"], "dropbox-dash/faster-whisper-large-v3-turbo")
        self.assertEqual(p["align"], "facebook/wav2vec2-base-960h")
        self.assertEqual(self.profile("cuda", 32, 5)["computeType"], "int8_float16")

    def test_a_small_gpu_uses_the_cpu_models(self):
        p = self.profile("cuda", 16, 2)
        self.assertEqual((p["device"], p["computeType"]), ("cpu", "int8"))
        self.assertEqual(p["whisper"], "Systran/faster-whisper-small.en")

    def test_cpu_and_forced_mps_get_small_en_int8(self):
        for backend in ("cpu", "mps"):
            p = self.profile(backend, 16)
            self.assertEqual((p["device"], p["computeType"]), ("cpu", "int8"), backend)
            self.assertEqual(p["whisper"], "Systran/faster-whisper-small.en")
        self.assertFalse(self.profile("cpu", 2)["ok"])

    def test_local_asr_off_turns_it_off(self):
        p = self.profile("mlx", 48, LOCAL_ASR="off")
        self.assertEqual((p["ok"], p["reason"]), (False, "LOCAL_ASR=off"))

    def test_models_can_be_replaced(self):
        p = self.profile(
            "mlx", 48, LOCAL_ASR_MODEL="/models/whisper", LOCAL_ALIGN_MODEL="org/aligner"
        )
        self.assertEqual((p["whisper"], p["align"]), ("/models/whisper", "org/aligner"))

    def test_downloads_fetch_only_the_files_each_library_reads(self):
        p = self.profile("cuda", 32, 12)
        self.assertEqual(
            stt.model_downloads(p, ["whisper", "align"]),
            [
                ("dropbox-dash/faster-whisper-large-v3-turbo", stt.FASTER_WHISPER_FILES),
                ("facebook/wav2vec2-base-960h", stt.WAV2VEC2_FILES),
            ],
        )
        self.assertEqual(
            stt.model_downloads(self.profile("mlx", 48), ["align"]),
            [("mlx-community/Qwen3-ForcedAligner-0.6B-8bit", None)],
        )
        self.assertEqual(stt.model_downloads(self.profile("mlx", 4), ["whisper", "align"]), [])


class CutPointsTest(unittest.TestCase):
    def test_short_audio_is_not_cut(self):
        self.assertEqual(stt.cut_points(talk(("s", 5), ("q", 0.3), ("s", 5)), SR, 120), [])

    def test_long_audio_is_cut_in_its_longest_pauses(self):
        # 10 s sentences; every pause is 0.3 s except two long ones at ~95 s and ~200 s.
        parts, t, long_pauses = [], 0.0, []
        for i in range(28):
            parts.append(("s", 10))
            t += 10
            pause = 0.9 if i in (8, 18) else 0.3
            if pause > 0.5:
                long_pauses.append((t, t + pause))
            parts.append(("q", pause))
            t += pause
        audio = talk(*parts)
        cuts = stt.cut_points(audio, SR, 120)
        self.assertEqual(len(cuts), 2)
        for cut, (lo, hi) in zip(cuts, long_pauses):
            self.assertGreater(cut, lo)
            self.assertLess(cut, hi)
        edges = [0.0, *cuts, len(audio) / SR]
        self.assertTrue(all(b - a <= 120 for a, b in zip(edges, edges[1:])))

    def test_without_pauses_it_cuts_at_the_quietest_moment(self):
        audio = speech(200)
        dip = int(90 * SR)
        audio[dip : dip + SR // 10] *= 0.01
        (cut,) = stt.cut_points(audio, SR, 120)
        self.assertAlmostEqual(cut, 90.05, delta=0.1)


class SplitWordsTest(unittest.TestCase):
    def test_words_go_to_the_piece_whisper_heard_them_in(self):
        words = ["One", "two", "three.", "Four", "five", "six"]
        heard = [
            {"text": "One", "start": 0.0, "end": 0.4},
            {"text": "two", "start": 0.5, "end": 0.9},
            {"text": "3.", "start": 1.0, "end": 1.4},  # no match: placed between its neighbours
            {"text": "four", "start": 2.6, "end": 3.0},
            {"text": "five", "start": 3.1, "end": 3.5},
            {"text": "six", "start": 3.6, "end": 4.0},
        ]
        self.assertEqual(stt.split_words_at(words, heard, [2.0], 4.2), [0, 3, 6])

    def test_unheard_words_are_spread_and_bounds_never_go_back(self):
        words = ["a", "b", "c", "d"]
        self.assertEqual(stt.split_words_at(words, [], [1.0, 3.0], 4.0), [0, 1, 3, 4])


class AlignInPiecesTest(unittest.TestCase):
    def test_long_audio_is_aligned_piece_by_piece_with_offsets(self):
        audio = talk(("s", 70), ("q", 1.0), ("s", 70), ("q", 1.0), ("s", 30))
        words = [f"w{i}" for i in range(9)]
        heard = [
            {"text": f"w{i}", "start": t, "end": t + 0.5}
            for i, t in enumerate([1, 30, 60, 75, 100, 130, 145, 160, 170])
        ]
        calls = []

        def align_piece(samples, piece_words):
            calls.append((len(samples) / SR, list(piece_words)))
            return [
                {"text": w, "start": 0.1 * k, "end": 0.1 * k + 0.05}
                for k, w in enumerate(piece_words)
            ]

        out = stt.align_in_pieces(audio, SR, words, align_piece, lambda _: heard, max_seconds=80)
        self.assertEqual([w["text"] for w in out], words)
        self.assertEqual([c[1] for c in calls], [words[:3], words[3:6], words[6:]])
        self.assertTrue(all(seconds <= 80 for seconds, _ in calls))
        self.assertAlmostEqual(out[3]["start"], 70.5, delta=0.1)
        starts = [w["start"] for w in out]
        self.assertEqual(starts, sorted(starts))

    def test_without_whisper_it_aligns_in_one_call(self):
        audio = talk(("s", 130))
        calls = []
        out = stt.align_in_pieces(
            audio,
            SR,
            ["a", "b"],
            lambda s, w: calls.append(len(w)) or [{"text": x, "start": 0, "end": 1} for x in w],
            None,
            max_seconds=120,
        )
        self.assertEqual((calls, len(out)), ([2], 2))


VOCAB = {"<pad>": 0, "|": 1, "A": 2, "B": 3, "C": 4, "'": 5}


def emissions(frames: str):
    """One frame per character: '-' is blank, ' ' is the word separator."""
    lp = np.full((len(frames), len(VOCAB)), np.log(0.01), np.float32)
    for t, ch in enumerate(frames):
        lp[t, {"-": 0, " ": 1}.get(ch, VOCAB.get(ch, 0))] = np.log(0.95)
    return lp


class CtcTest(unittest.TestCase):
    def test_words_get_the_frames_of_their_letters(self):
        lp = emissions("-----AAABB---- CCC-----")
        times = np.arange(len(lp)) * stt.FRAME_SECONDS
        out = stt.ctc_align_words(lp, times, ["ab,", "C."], VOCAB, blank=0)
        self.assertEqual([w["text"] for w in out], ["ab,", "C."])
        self.assertAlmostEqual(out[0]["start"], 0.10)
        self.assertAlmostEqual(out[0]["end"], 0.20)
        self.assertAlmostEqual(out[1]["start"], 0.30)
        self.assertAlmostEqual(out[1]["end"], 0.36)

    def test_repeated_letters_need_a_blank_between_them(self):
        path = stt.ctc_viterbi(emissions("-AA-A--"), [2, 2], blank=0)
        self.assertEqual(list(path), [0, 1, 1, 2, 3, 4, 4])

    def test_long_texts_backtrack_past_127_states(self):
        frames = "-" + "-".join("ABC"[k % 3] for k in range(150)) + "-"
        path = stt.ctc_viterbi(emissions(frames), [2 + k % 3 for k in range(150)], blank=0)
        self.assertEqual(int(path[-1]), 300)
        self.assertEqual(int(path[1]), 1)

    def test_too_few_frames_is_an_error(self):
        with self.assertRaises(ValueError):
            stt.ctc_viterbi(emissions("AB"), [2, 2, 3], blank=0)

    def test_a_word_with_no_letters_sits_between_its_neighbours(self):
        lp = emissions("--AA----BB--")
        times = np.arange(len(lp)) * stt.FRAME_SECONDS
        out = stt.ctc_align_words(lp, times, ["a", "☺", "b"], VOCAB, blank=0)
        self.assertAlmostEqual(out[1]["start"], out[0]["end"])
        self.assertAlmostEqual(out[1]["end"], out[2]["start"])

    def test_frame_times_follow_the_windows(self):
        lp = emissions("-A--B-")
        times = np.array([0.0, 0.02, 0.04, 30.0, 30.02, 30.04])
        out = stt.ctc_align_words(lp, times, ["a", "b"], VOCAB, blank=0)
        self.assertAlmostEqual(out[1]["start"], 30.02)


class CudaProbeTest(unittest.TestCase):
    def test_a_child_process_tries_whisper_on_the_gpu(self):
        ok = types.SimpleNamespace(returncode=0, stderr="")
        with mock.patch.object(stt.subprocess, "run", return_value=ok) as run:
            self.assertTrue(stt.cuda_whisper_works("org/whisper", "float16"))
        self.assertEqual(run.call_args.args[0][-3:], ["probe-cuda", "org/whisper", "float16"])

    def test_a_crash_or_a_timeout_means_no(self):
        crashed = types.SimpleNamespace(
            returncode=-6, stderr="Could not load library libcudnn_ops.so.9\n"
        )
        with (
            mock.patch.object(stt.subprocess, "run", return_value=crashed),
            mock.patch("builtins.print"),
        ):
            self.assertFalse(stt.cuda_whisper_works("org/whisper", "float16"))
        timeout = stt.subprocess.TimeoutExpired("probe", 300)
        with mock.patch.object(stt.subprocess, "run", side_effect=timeout):
            self.assertFalse(stt.cuda_whisper_works("org/whisper", "float16"))


# ---------- SpeechToText with fake models ----------


class FakeEngines:
    def __init__(self):
        self.stt_loaded = {}

    def stt_model(self, key, load):
        if key not in self.stt_loaded:
            self.stt_loaded[key] = load()
        return self.stt_loaded[key]


class FakeMlxWhisper:
    """mlx-audio Whisper's result shape."""

    def __init__(self, words):
        self.words = words
        self.calls = []

    def generate(self, audio, **kwargs):
        self.calls.append((len(audio), kwargs))
        return types.SimpleNamespace(
            text=" " + " ".join(w for w, _, _ in self.words),
            segments=[
                {
                    "words": [
                        {"word": f" {w}", "start": s, "end": e, "probability": 0.9}
                        for w, s, e in self.words
                    ]
                },
                {"words": [{"word": " ", "start": 9.0, "end": 9.0, "probability": 0.1}]},
            ],
            language="en",
        )


class FakeFasterWhisper:
    """faster-whisper's result shape: lazy segments and an info object."""

    def __init__(self, words):
        self.words = words
        self.calls = []

    def transcribe(self, audio, **kwargs):
        self.calls.append((len(audio), kwargs))
        word = lambda w, s, e: types.SimpleNamespace(word=f" {w}", start=s, end=e, probability=0.8)  # noqa: E731
        segments = iter(
            [
                types.SimpleNamespace(
                    text=" " + " ".join(w for w, _, _ in self.words),
                    words=[word(*w) for w in self.words],
                )
            ]
        )
        return segments, types.SimpleNamespace(language="en", language_probability=0.99)


class FakeQwen3Aligner:
    """mlx-audio's Qwen3 forced aligner: one item per cleaned word, 80 ms steps."""

    def __init__(self, drop=0):
        self.calls = []
        self.drop = drop

    def generate(self, audio, text, language):
        self.calls.append((len(audio) / SR, text, language))
        words = text.split()[: len(text.split()) - self.drop]
        return types.SimpleNamespace(
            items=[
                types.SimpleNamespace(text=w, start_time=0.08 * 2 * k, end_time=0.08 * (2 * k + 1))
                for k, w in enumerate(words)
            ]
        )


class FakeStt(stt.SpeechToText):
    def __init__(self, profile, engines=("whisper", "align"), on_disk=True, probe=True, **models):
        self.models = models
        self.loads = []
        super().__init__(
            FakeEngines(),
            profile,
            list(engines),
            on_disk=lambda repo, patterns: on_disk,
            probe_cuda=lambda repo, compute: probe,
        )

    def _load_whisper(self, repo, device, compute_type):
        self.loads.append(("whisper", repo, device, compute_type))
        return self.models["whisper"]

    def _load_aligner(self, repo):
        self.loads.append(("align", repo))
        return self.models["align"]


MLX = stt.asr_profile("mlx", HARDWARE, 48, None, {})
CUDA = stt.asr_profile("cuda", HARDWARE, 32, 12, {})


class SpeechToTextTest(unittest.TestCase):
    def test_health_reports_what_is_enabled_and_downloaded(self):
        s = FakeStt(MLX)
        self.assertEqual(
            s.health(),
            {
                "transcribe": True,
                "align": True,
                "device": "mlx",
                "models": {
                    "transcribe": "mlx-community/whisper-large-v3-turbo-asr-8bit",
                    "align": "mlx-community/Qwen3-ForcedAligner-0.6B-8bit",
                },
            },
        )
        missing = FakeStt(MLX, on_disk=False).health()
        self.assertEqual((missing["transcribe"], missing["align"]), (False, False))
        self.assertIn("not downloaded", missing["reason"])
        only_whisper = FakeStt(MLX, engines=["whisper"]).health()
        self.assertEqual((only_whisper["align"], only_whisper["models"]["align"]), (False, None))

    def test_health_says_why_it_is_off(self):
        off = FakeStt(stt.asr_profile("mlx", HARDWARE, 48, None, {"LOCAL_ASR": "off"})).health()
        self.assertEqual(
            off,
            {
                "transcribe": False,
                "align": False,
                "device": None,
                "models": {"transcribe": None, "align": None},
                "reason": "LOCAL_ASR=off",
            },
        )

    def test_mlx_transcribe_returns_trimmed_words_in_english(self):
        whisper = FakeMlxWhisper([("Hello", 0.1, 0.4), ("world.", 0.5, 0.9)])
        out = FakeStt(MLX, whisper=whisper).transcribe(speech(2), "en", True)
        self.assertEqual(out["text"], "Hello world.")
        self.assertEqual(
            out["words"],
            [
                {"text": "Hello", "start": 0.1, "end": 0.4, "probability": 0.9},
                {"text": "world.", "start": 0.5, "end": 0.9, "probability": 0.9},
            ],
        )
        self.assertEqual(
            (out["language"], out["model"], out["backend"]), ("en", MLX["whisper"], "mlx")
        )
        self.assertAlmostEqual(out["duration"], 2.0)
        kwargs = whisper.calls[0][1]
        self.assertEqual(kwargs["temperature"], 0.0)
        self.assertFalse(kwargs["condition_on_previous_text"])
        self.assertTrue(kwargs["word_timestamps"])
        self.assertEqual(kwargs["language"], "en")

    def test_auto_language_lets_whisper_detect_it(self):
        whisper = FakeMlxWhisper([("Hola", 0.1, 0.4)])
        FakeStt(MLX, whisper=whisper).transcribe(speech(1), "auto", True)
        self.assertIsNone(whisper.calls[0][1]["language"])

    def test_faster_whisper_runs_at_temperature_zero_with_vad_on_the_gpu(self):
        whisper = FakeFasterWhisper([("Hi", 0.2, 0.5)])
        s = FakeStt(CUDA, whisper=whisper)
        out = s.transcribe(speech(1), "en", True)
        self.assertEqual(
            out["words"], [{"text": "Hi", "start": 0.2, "end": 0.5, "probability": 0.8}]
        )
        self.assertEqual(
            (out["language"], out["languageProbability"], out["backend"]), ("en", 0.99, "cuda")
        )
        kwargs = whisper.calls[0][1]
        self.assertTrue(kwargs["vad_filter"])
        self.assertEqual(kwargs["temperature"], 0.0)
        self.assertFalse(kwargs["condition_on_previous_text"])
        self.assertEqual(s.loads, [("whisper", CUDA["whisper"], "cuda", "float16")])

    def test_cuda_without_working_ctranslate2_runs_whisper_on_the_cpu(self):
        s = FakeStt(CUDA, probe=False, whisper=FakeFasterWhisper([("Hi", 0.2, 0.5)]))
        with mock.patch("builtins.print"):
            out = s.transcribe(speech(1), "en", True)
        self.assertEqual(s.loads, [("whisper", CUDA["whisper"], "cpu", "int8")])
        self.assertEqual(out["backend"], "cpu")
        self.assertEqual(s.health()["device"], "cpu")

    def test_transcribe_when_off_raises_not_enabled(self):
        with self.assertRaises(stt.NotEnabled):
            FakeStt(MLX, engines=["align"]).transcribe(speech(1), "en", True)

    def test_mlx_align_returns_one_entry_per_script_word(self):
        aligner = FakeQwen3Aligner()
        out = FakeStt(MLX, align=aligner).align(speech(3), "Hello, world — it's 3,000!")
        self.assertEqual([w["text"] for w in out["words"]], ["Hello,", "world", "it's", "3,000!"])
        self.assertEqual(aligner.calls, [(3.0, "Hello, world it's 3,000!", "English")])
        self.assertEqual((out["model"], out["backend"], out["pieces"]), (MLX["align"], "mlx", 1))
        self.assertAlmostEqual(out["words"][1]["start"], 0.16)

    def test_long_audio_is_split_with_whisper_before_the_aligner(self):
        audio = talk(("s", 100), ("q", 1.0), ("s", 99))
        heard = [
            ("first", 1.0, 1.5),
            ("second", 50.0, 50.5),
            ("third", 120.0, 120.5),
            ("fourth", 190.0, 190.4),
        ]
        aligner, whisper = FakeQwen3Aligner(), FakeMlxWhisper(heard)
        out = FakeStt(MLX, align=aligner, whisper=whisper).align(audio, "first second third fourth")
        self.assertEqual(len(whisper.calls), 1)
        self.assertEqual([c[1] for c in aligner.calls], ["first second", "third fourth"])
        self.assertTrue(all(c[0] <= stt.ALIGN_MAX_SECONDS for c in aligner.calls))
        self.assertEqual(out["pieces"], 2)
        self.assertAlmostEqual(out["words"][2]["start"], 100.5, delta=0.1)

    def test_qwen3_refuses_long_audio_it_cannot_split_without_whisper(self):
        # In one call the Qwen3 aligner drifts by seconds past about 200 s, so audio over the
        # limit needs Whisper to find where to cut it; without Whisper it is sent back.
        aligner = FakeQwen3Aligner()
        s = FakeStt(MLX, engines=["align"], align=aligner)
        with self.assertRaises(ValueError) as caught:
            s.align(talk(("s", stt.ALIGN_MAX_SECONDS + 10)), "one two three")
        self.assertIn(f"{stt.ALIGN_MAX_SECONDS:.0f} s", str(caught.exception))
        self.assertEqual(aligner.calls, [])
        # Short audio still aligns in one call.
        self.assertEqual(len(s.align(speech(2), "one two three")["words"]), 3)

    def test_an_aligner_that_loses_words_is_an_error(self):
        with self.assertRaises(RuntimeError):
            FakeStt(MLX, align=FakeQwen3Aligner(drop=1)).align(speech(2), "one two three")

    def test_align_needs_words(self):
        with self.assertRaises(ValueError):
            FakeStt(MLX, align=FakeQwen3Aligner()).align(speech(2), " — ... ")

    def test_ctc_align_on_nvidia(self):
        class Ctc(FakeStt):
            def _ctc_log_probs(self, model, samples):
                return emissions("-----AAABB---- CCC-----")

        model = types.SimpleNamespace(vocab=VOCAB, blank=0)
        out = Ctc(CUDA, align=model).align(speech(0.5), "ab C")
        self.assertEqual([w["text"] for w in out["words"]], ["ab", "C"])
        self.assertAlmostEqual(out["words"][1]["start"], 0.30)
        self.assertEqual(out["backend"], "cuda")


if __name__ == "__main__":
    unittest.main()
