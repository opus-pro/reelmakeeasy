# Presets

Static assets ReelMakeEasy ships with, served by the API at `/api/presets/…`.

| Path                                        | What                                                                                                                                                                                                                                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `story-mode/styles.json`                    | Story Mode preset styles (`styles`) and song-to-video styles (`songStyles`). Asset paths are relative to the preset pack.                                                                                                                                                     |
| `story-mode/demos.json`                     | Demo projects for the home page gallery, served by `GET /api/demo-projects`. It ships empty, and the home page shows no gallery until it lists a demo (see [Changing the pack](#changing-the-pack)). Asset paths are relative to the preset pack.                             |
| `voice-over/previews/preview-<voiceId>.mp3` | Audition clips for the preset voices in `libs/shared/common/src/tts/preset-voices.ts`: the ElevenLabs sample for each ElevenLabs voice, and a short line spoken by each Kokoro and Qwen3-TTS voice (generated on fal).                                                        |
| `voice-over/previews/preview-gemini-*.mp3`  | Audition clips for the Gemini TTS voices (`libs/shared/common/src/tts/gemini-voices.ts`), one line each, made with `pnpm exec tsx --tsconfig tsconfig.base.json scripts/make-gemini-voice-previews.ts` (about one cent for all 30; existing files are kept unless `--force`). |
| `music/library.json`, `music/*.mp3`         | The built-in music library: our own instrumental tracks by mood, one minute each (see below).                                                                                                                                                                                 |
| `style-preview-base.png`                    | The image style previews are painted onto.                                                                                                                                                                                                                                    |
| `pack.json`                                 | Which preset pack to install, and its checksum.                                                                                                                                                                                                                               |

## Music library

`music/library.json` lists the built-in background-music tracks: two for calm videos and two for dynamic ones (`type`), each a 60 s lo-fi file under `music/` with its mood (`lo-fi`, `chill`, `groove`, `piano`). A video with no music picked gets its style's default, `DEFAULT_LIBRARY_TRACK` in `music-craft.ts` (Warm Lo-fi for calm, Groovy Lo-fi for dynamic); a Beat loop gets none unless asked. Nothing is generated unless the user describes the music they want. A video uses the file trimmed to its length with a fade; a video longer than a minute loops it. The API serves the manifest at `GET /api/music/library` and the files at `/api/presets/music/…`.

Every track was made for ReelMakeEasy with ElevenLabs Music v2.5 (through fal, instrumental only) and picked by ear; each entry's `credit` keeps the prompt, and `LICENSES/music.md` lists them. We do not bundle "free" music from elsewhere unless it is CC0 or CC BY: Pixabay, Mixkit, YouTube Audio Library, Bensound, Uppbeat and TikTok's library are free to use in a video but forbid redistributing their files inside another app.

To add a track: generate it instrumental, cut 60 s with a 0.5 s fade-in and a 3 s fade-out, level it to about -14 LUFS with peaks under 0 dBFS (mp3, 128 kbps, 44.1 kHz stereo, named `<id>-60s.mp3`), and add its entry with `type`, `mood` and `credit`.

## Preset pack

Style thumbnails, style preview videos, the camera samples (`camera-samples/`, see below), the video render's inputs (`render/`: fonts and the template snapshot) and the editor's preview engine with its fonts (`editor/`) are too heavy for git, so they ship as a release asset. `pnpm reelmakeeasy setup` (and `pnpm reelmakeeasy start` or `pnpm dev`, when it's missing) downloads the archive `pack.json` names, checks its sha256 and unpacks it to `.reelmakeeasy/presets/<version>/`. The API serves it at `/api/presets/<version>/…` with a one-year immutable cache, so a changed pack must get a new version.

To install from a local archive instead (offline, or before a release is published), set `PRESETS_PACK=/path/to/reelmakeeasy-presets-<version>.tar.gz`.

### Camera samples

`camera-samples/` holds one short clip per way a video can move, so a user can see the difference before picking: `dynamic.mp4` (bold moves, quick shots), `calm.mp4` (a slow, steady glide) and `beat-loop.mp4` (a loop short's hit, hit, freeze and cut), each with a JPEG poster of its first frame (`<id>.jpg`). The paths are `CAMERA_SAMPLES` in `libs/shared/common/src/storage/camera-samples.ts`, served like the rest of the pack (in the web app, under `NEXT_PUBLIC_PRESET_PACK_URL`), e.g. `/api/presets/<version>/camera-samples/calm.mp4`. Each is an 8-second cut from a finished video: a silent H.264 MP4, 540px wide and about 9:16, with the moov atom first (`-movflags +faststart`) so it starts playing at once, about 1 MB.

### Changing the pack

1. Put new or replacement files (any image or video format) under `.reelmakeeasy/presets-src/`, and point the entries in `story-mode/styles.json` or `story-mode/demos.json` at them, relative to that folder. Unchanged entries keep pointing at the current pack, which setup installed in `.reelmakeeasy/presets/<version>/`.
   To replace a `render/`, `editor/` or `camera-samples/` file, put it at the same path under `.reelmakeeasy/presets-src/` and pass `--src=.reelmakeeasy/presets-src,.reelmakeeasy/presets/<current version>` in step 2, so it wins over the current pack. The pack also ships `presets/LICENSES/` (the font licences) as `LICENSES/`: update it when you add a font.
2. Build the next version (three digits: `v001`, `v002`, …). It looks each file up in the current pack, then in `presets-src`, and standardizes it: style thumbnails and demo thumbnails become WebP at most 960px tall, style previews VP9 WebM at most 888px tall without audio, demo videos VP9 WebM at most 1280px tall with Opus audio. Files are named after their style or demo; `render/`, `editor/` and `camera-samples/` files are copied as-is (the list is `COPIED_FILES` in the script). When `pack.json` already names a version that isn't installed, pass the installed one as the first `--src`:
   ```bash
   node scripts/build-preset-pack.mjs --version=v002
   ```
   This rewrites the paths in `story-mode/styles.json` and `story-mode/demos.json`, updates `pack.json`, and writes the archive to `.reelmakeeasy/pack-build/`.
3. Publish the archive (the script prints the command), then commit `presets/`:
   ```bash
   gh release create presets-v002 .reelmakeeasy/pack-build/reelmakeeasy-presets-v002.tar.gz -R opus-pro/reelmakeeasy --title "Preset pack v002"
   ```
