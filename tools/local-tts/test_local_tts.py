"""
Unit tests for local_tts.py: engine choice, downloads, the model cache and the
HTTP API, with fake models. The HTTP tests need fastapi and httpx (both in the
voice venv); without them they are skipped.
"""

import base64
import importlib.util
import os
import sys
import unittest
from unittest import mock

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import local_tts  # noqa: E402
import stt  # noqa: E402

HAS_HTTP = all(importlib.util.find_spec(m) for m in ("fastapi", "httpx"))


def wav_b64(seconds: float, rate: int = 16000, channels: int = 1) -> str:
    samples = (0.1 * np.sin(np.arange(int(seconds * rate)) / 5)).astype(np.float32)
    data = local_tts.wav_bytes(samples, rate)
    if channels == 2:
        import io
        import wave

        pcm = np.frombuffer(data[44:], dtype="<i2")
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(rate)
            w.writeframes(np.repeat(pcm, 2).tobytes())
        data = buf.getvalue()
    return base64.b64encode(data).decode()


class EngineChoiceTest(unittest.TestCase):
    def engines(self, backend="mlx", ram=48.0, **env):
        with (
            mock.patch.dict(os.environ, env, clear=True),
            mock.patch.object(local_tts, "total_ram_gb", return_value=ram),
            mock.patch.object(local_tts, "gpu_memory_gb", return_value=0.0),
        ):
            return local_tts.default_engines(backend)

    def test_every_engine_by_default(self):
        self.assertEqual(self.engines(), ["kokoro", "qwen3", "whisper", "align"])

    def test_configured_engines_win(self):
        self.assertEqual(
            self.engines(LOCAL_TTS_ENGINES="kokoro,whisper,align"), ["kokoro", "whisper", "align"]
        )

    def test_captions_only_install_runs_without_voices(self):
        # Setup with --local-tts=off and captions on starts the server with only these.
        self.assertEqual(self.engines(LOCAL_TTS_ENGINES="whisper,align"), ["whisper", "align"])
        self.assertEqual(
            self.engines("cpu", ram=16.0, LOCAL_TTS_ENGINES="whisper,align"), ["whisper", "align"]
        )

    def test_local_asr_off_drops_speech_to_text(self):
        self.assertEqual(self.engines(LOCAL_ASR="off"), ["kokoro", "qwen3"])

    def test_a_small_machine_drops_what_it_cannot_hold(self):
        self.assertEqual(self.engines(ram=16.0), ["kokoro", "whisper", "align"])
        self.assertEqual(self.engines(ram=6.0), ["kokoro"])

    def test_downloads_include_the_speech_to_text_models(self):
        with (
            mock.patch.dict(os.environ, {}, clear=True),
            mock.patch.object(local_tts, "total_ram_gb", return_value=48.0),
        ):
            self.assertEqual(
                local_tts.downloads_for("mlx", ["kokoro", "whisper", "align"]),
                [
                    ("mlx-community/Kokoro-82M-bf16", None),
                    ("mlx-community/whisper-large-v3-turbo-asr-8bit", None),
                    ("mlx-community/Qwen3-ForcedAligner-0.6B-8bit", None),
                ],
            )
            self.assertEqual(
                local_tts.models_for("mlx", ["whisper"]),
                ["mlx-community/whisper-large-v3-turbo-asr-8bit"],
            )

    def test_download_skips_local_folders(self):
        calls = []
        fake_hub = mock.MagicMock()
        fake_hub.snapshot_download.side_effect = lambda **kw: calls.append(kw)
        here = os.path.dirname(os.path.abspath(__file__))
        args = mock.Mock(engines="whisper,align", kokoro_voices="af_heart")
        with (
            mock.patch.dict(sys.modules, {"huggingface_hub": fake_hub}),
            mock.patch.dict(
                os.environ, {"LOCAL_TTS_DEVICE": "cpu", "LOCAL_ASR_MODEL": here}, clear=True
            ),
            mock.patch.object(local_tts, "total_ram_gb", return_value=16.0),
            mock.patch("builtins.print"),
        ):
            local_tts.cmd_download(args)
        self.assertEqual(
            calls,
            [{"repo_id": "facebook/wav2vec2-base-960h", "allow_patterns": stt.WAV2VEC2_FILES}],
        )

    def test_download_copies_instead_of_symlinking_on_windows(self):
        fake_hub = mock.MagicMock()
        fake_hub.file_download.are_symlinks_supported.return_value = True
        with mock.patch.dict(sys.modules, {"huggingface_hub": fake_hub}):
            local_tts.copy_instead_of_symlinks("posix")
            self.assertTrue(fake_hub.file_download.are_symlinks_supported("cache"))
            local_tts.copy_instead_of_symlinks("nt")
            self.assertFalse(fake_hub.file_download.are_symlinks_supported("cache"))
            self.assertFalse(fake_hub.file_download.are_symlinks_supported())


def quiet(test: unittest.TestCase):
    """Hides the server's log lines for the rest of the test."""
    patcher = mock.patch("builtins.print")
    patcher.start()
    test.addCleanup(patcher.stop)


class EnginesCacheTest(unittest.TestCase):
    def setUp(self):
        quiet(self)
        patcher = mock.patch.object(local_tts, "IDLE_UNLOAD_SECONDS", 0)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_speech_to_text_has_its_own_slot_and_never_evicts_qwen3(self):
        engines = local_tts.Engines("cpu", ["qwen3", "whisper", "align"], max_models=1)
        engines._get("qwen3-custom", lambda: "qwen")
        engines.stt_model("whisper", lambda: "w")
        engines.stt_model("align", lambda: "a")
        self.assertEqual(list(engines.loaded), ["qwen3-custom"])
        self.assertEqual(list(engines.stt_loaded), ["whisper", "align"])
        engines.stt_model("whisper", lambda: self.fail("reloaded"))

    def test_idle_unload_drops_speech_to_text_models_too(self):
        engines = local_tts.Engines("cpu", ["whisper"], max_models=1)
        engines.stt_model("whisper", lambda: "w")
        engines.last_used -= 10_000
        with mock.patch.object(local_tts, "IDLE_UNLOAD_SECONDS", 300):
            self.assertTrue(engines.unload_if_idle())
        self.assertEqual(len(engines.stt_loaded), 0)
        self.assertFalse(engines.unload_if_idle())


class FakeStt:
    """Stands in for stt.SpeechToText. `during` runs inside each job (to look at the lock)."""

    def __init__(self, transcribe=True, align=True, during=None):
        self.ready = {"whisper": transcribe, "align": align}
        self.calls = []
        self.during = during or (lambda: None)

    def can(self, engine):
        return self.ready[engine]

    def health(self):
        return {
            "transcribe": self.ready["whisper"],
            "align": self.ready["align"],
            "device": "cpu",
            "models": {},
        }

    def transcribe(self, samples, language, word_timestamps):
        self.calls.append(("transcribe", len(samples), language, word_timestamps))
        self.during()
        return {"text": "hi", "words": [], "duration": len(samples) / 16000}

    def align(self, samples, text):
        self.calls.append(("align", len(samples), text))
        self.during()
        if not text.strip():
            raise ValueError("text has no words")
        return {"words": [{"text": "hi", "start": 0.0, "end": 0.3}], "pieces": 1}


@unittest.skipUnless(HAS_HTTP, "fastapi and httpx are not installed")
class HttpTest(unittest.TestCase):
    def setUp(self):
        quiet(self)

    def client(self, stt_fake, engines=("kokoro",)):
        from fastapi.testclient import TestClient

        with mock.patch.object(local_tts, "IDLE_UNLOAD_SECONDS", 0):
            eng = local_tts.Engines("cpu", list(engines), max_models=1)
        app = local_tts.create_app(
            "cpu", {"ok": False, "ramGB": 16.0, "reason": "x"}, eng, stt_fake
        )
        return TestClient(app), eng

    def test_health_keeps_engines_and_adds_stt(self):
        client, _ = self.client(FakeStt(), engines=("kokoro", "whisper", "align"))
        body = client.get("/health").json()
        self.assertEqual(body["engines"], {"kokoro": True, "qwen3": False})
        self.assertEqual(body["stt"]["transcribe"], True)
        self.assertEqual(body["stt"]["align"], True)
        self.assertTrue(body["ok"])

    def test_health_without_stt(self):
        client, _ = self.client(FakeStt(False, False))
        stt_health = client.get("/health").json()["stt"]
        self.assertEqual((stt_health["transcribe"], stt_health["align"]), (False, False))

    def test_transcribe_decodes_resamples_and_answers(self):
        fake = FakeStt()
        client, engines = self.client(fake)
        res = client.post("/v1/transcribe", json={"audio": wav_b64(1.0, 24000, channels=2)})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()["text"], "hi")
        self.assertEqual(fake.calls, [("transcribe", 16000, "en", True)])
        self.assertFalse(engines.lock.locked())

    def test_transcribe_passes_language_and_word_timestamps(self):
        fake = FakeStt()
        client, _ = self.client(fake)
        client.post(
            "/v1/transcribe",
            json={"audio": wav_b64(0.5), "language": None, "wordTimestamps": False},
        )
        self.assertEqual(fake.calls, [("transcribe", 8000, None, False)])

    def test_transcribe_is_404_when_not_installed(self):
        client, _ = self.client(FakeStt(transcribe=False))
        self.assertEqual(
            client.post("/v1/transcribe", json={"audio": wav_b64(0.5)}).status_code, 404
        )

    def test_bad_audio_is_400(self):
        client, _ = self.client(FakeStt())
        for audio in ("not base64!", base64.b64encode(b"RIFF....nope").decode(), wav_b64(0.0)):
            res = client.post("/v1/transcribe", json={"audio": audio})
            self.assertEqual(res.status_code, 400, audio[:20])

    def test_align_answers_and_is_404_without_an_aligner(self):
        fake = FakeStt()
        client, _ = self.client(fake)
        res = client.post("/v1/align", json={"audio": wav_b64(1.0), "text": "hi"})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()["words"][0]["text"], "hi")
        self.assertEqual(fake.calls, [("align", 16000, "hi")])
        client, _ = self.client(FakeStt(align=False))
        self.assertEqual(
            client.post("/v1/align", json={"audio": wav_b64(1.0), "text": "hi"}).status_code, 404
        )

    def test_align_with_no_words_is_400(self):
        client, engines = self.client(FakeStt())
        self.assertEqual(
            client.post("/v1/align", json={"audio": wav_b64(1.0), "text": " "}).status_code, 400
        )
        self.assertFalse(engines.lock.locked())

    def test_speech_to_text_holds_the_gpu_lock_and_counts_as_use(self):
        held = []
        fake = FakeStt(during=lambda: held.append(engines.lock.locked()))
        client, engines = self.client(fake)
        for route, body in (
            ("/v1/transcribe", {"audio": wav_b64(0.5)}),
            ("/v1/align", {"audio": wav_b64(0.5), "text": "hi"}),
        ):
            engines.last_used = 0.0
            self.assertEqual(client.post(route, json=body).status_code, 200, route)
            # The idle unload counts from here, so a model just used stays loaded.
            self.assertGreater(engines.last_used, 0.0, route)
        self.assertEqual(held, [True, True])
        self.assertFalse(engines.lock.locked())

    def test_speech_refuses_speech_to_text_engines(self):
        client, _ = self.client(FakeStt(), engines=("kokoro", "whisper"))
        res = client.post("/v1/speech", json={"engine": "whisper", "text": "hi"})
        self.assertEqual(res.status_code, 404)


class DecodeAudioTest(unittest.TestCase):
    def test_returns_16khz_mono_float32(self):
        samples = local_tts.decode_audio(wav_b64(0.5, 24000, channels=2))
        self.assertEqual((samples.dtype, len(samples)), (np.float32, 8000))


if __name__ == "__main__":
    unittest.main()
