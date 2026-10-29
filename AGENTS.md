# Deploying ReelMakeEasy with an AI agent

This file is for AI coding agents (Claude Code, Codex, Cursor and similar) asked to install and run ReelMakeEasy for a user. Follow it top to bottom. Every command is non-interactive, and every check has a machine-readable form.

## When the user says "install this" or "set this up for me"

Walk them through it in the chat, one short step at a time. Use your harness's question or choice UI when it has one (for example Claude Code's question picker); otherwise ask in plain text and wait for the answer. Keep every message short: say what you're doing, not why it matters.

1. **Check the computer yourself, without asking.** Node 22 or later, FFmpeg (`ffmpeg -version`), pnpm (`corepack enable`; on Windows, `npm i -g pnpm` when that fails with EPERM), and whether Codex or Claude Code is installed and signed in (`codex login status`, `claude auth status`). If something is missing, say what and offer to install it.
2. **Ask which video keys they have:** fal, Gemini, or both. They need at least one. **Recommend fal.ai** when they have none yet: with their Codex or Claude Code it makes a 30-second video for about $0.70, against about $3 on Gemini; they register at https://fal.ai/dashboard/keys. If neither Codex nor Claude Code is signed in, a fal key alone isn't enough, because fal can't write or plan: they need a Gemini key (it does both) or to sign in to Codex or Claude Code. Then ask only for the key or keys they picked, with the link to get one if they don't have it yet (see the table below).
3. **Ask "[optional] ElevenLabs key?"** and say it can be skipped. Without it, ElevenLabs voices run through fal, and so does caption timing when it isn't done on this computer.
4. **Ask about local voices:** both (free voices, about a 10 GB download), Kokoro only (0.4 GB), Qwen3 only (about 10 GB), or skip (those voices then run on fal). Qwen3 needs the memory listed in Step 3. Then ask "Time captions on this computer? Free, about 2 GB": yes, or skip (captions are then timed online).
5. **Install and configure** with the commands in Steps 2 and 3 below, passing the keys as flags so nothing prompts. Add `--llm=claude` or `--llm=codex` when one is signed in, `--local-tts=all`, `kokoro`, `qwen` or `off` to match their answer, and `--local-captions=off` if they skipped captions.
6. **Check:** run `pnpm reelmakeeasy doctor --json` and fix every blocking failure, one line each on what you fixed.
7. **Start it** with `pnpm reelmakeeasy start` (Step 5) and check it's healthy (Step 6). If it has to build the app first, say it takes a few minutes. Then give them the link, http://localhost:3000. If both fal and Gemini are set, tell them to pick who makes the videos on the **Get set up** card.
8. **End with one line:** "To make your first video, open Agent mode and choose Easy."

Never repeat a key back in the chat, and write keys only to `.env`.

## What you need from the user

Ask for these, and nothing else, before starting. Never invent keys or copy them from other projects.

- **A video key: `FAL_KEY` or `GEMINI_API_KEY`**, `FAL_KEY` recommended. One is enough; with both, the user picks who makes the videos on the Setup page. fal is about four times cheaper per video (about $0.70 against $3 for 30 seconds).
- **An AI to write and plan:** Codex or Claude Code installed and signed in on this computer (recommended, with `FAL_KEY`), or a `GEMINI_API_KEY` (which can do the writing too).

**The recommended setup is the user's Codex or Claude Code plus a fal.ai key.** Gemini alone works (it writes, plans and makes the video) but costs more per video; suggest it only when the user has neither Codex nor Claude Code, or already has a Gemini key and doesn't want a fal account.
- Optional: `ELEVENLABS_API_KEY`, for ElevenLabs voices, the voice checks (speaker labels and sounds) and cloning on the user's own key, and for caption timing when it isn't done on this computer (local caption timing, on by default, comes first). Without it, ElevenLabs voices and that caption timing run through fal when fal makes the videos, and Gemini makes its own voices and captions when Gemini makes them; ElevenLabs cloning always needs the key.

| Env var | What it's for | Where the user gets it |
| --- | --- | --- |
| `FAL_KEY` | Pictures, clips, music, voices on fal | https://fal.ai/dashboard/keys |
| `GEMINI_API_KEY` | Pictures, clips, voices, music on Gemini; writing and planning | https://aistudio.google.com/apikey |
| `ELEVENLABS_API_KEY` (optional) | ElevenLabs voices, voice checks and cloning on the user's key; caption timing when it isn't local | https://elevenlabs.io/app/settings/api-keys |

To write and plan on another provider, set `LLM_BASE_URL` and `LLM_API_KEY` (any OpenAI-compatible endpoint) and pass `--llm=endpoint`.

Don't echo key values back in chat or write them anywhere except `.env` (which is gitignored).

## Steps

1. **Check prerequisites.**
   ```bash
   node --version          # must be v22 or later
   ffmpeg -version && ffprobe -version
   corepack enable         # provides pnpm
   ```
   Missing FFmpeg: install it (`brew install ffmpeg` on macOS, `sudo apt-get install -y ffmpeg` on Debian/Ubuntu).

   On Windows, `corepack enable` fails with `EPERM` when Node is in `C:\Program Files\nodejs` and the user isn't an administrator. Run `npm i -g pnpm` instead: it installs pnpm in the user's own folder, which the Node installer already put on `PATH`.

2. **Install dependencies.**
   ```bash
   pnpm install
   ```

3. **Configure.** Pass the keys the user gave as flags so nothing prompts (leave out the ones they don't have):
   ```bash
   pnpm reelmakeeasy setup --yes \
     --fal-key="$FAL_KEY" \
     --gemini-key="$GEMINI_API_KEY" \
     --elevenlabs-key="$ELEVENLABS_API_KEY"
   ```
   Optionally add `--llm=claude|codex|gemini|endpoint` (which AI writes and plans) and `--generation=fal|google` (who makes the videos when both keys are set). Unset, ReelMakeEasy uses the first one that is ready; the user can change both later on the app's **Setup** page. This writes `.env` (from `.env.example`), generates the database client and downloads the preset pack (style previews, camera samples, render fonts and the editor engine, ~49 MB). Re-running it is safe.

   It also installs the free local voices (Kokoro and Qwen3-TTS), picking the backend from the hardware: `mlx` on Apple Silicon, `cuda` when `nvidia-smi` works, `cpu` (Kokoro only) otherwise. Qwen3 is installed only with enough memory (`tools/local-tts/hardware.json`): 24 GB of RAM on Apple Silicon (36 GB recommended), or 8 GB of GPU memory and 32 GB of RAM on NVIDIA (Windows, Linux). Otherwise setup installs Kokoro only (~0.4 GB) and Qwen3 voices run on fal; `doctor` shows the detected memory and the decision. It fetches `uv` if it's missing, builds a Python 3.12 venv in `.reelmakeeasy/local-tts`, and downloads the models into `.reelmakeeasy/models` from public Hugging Face repos. No Hugging Face account or token is needed. The download is about 10 GB on a Mac and 14 GB with CUDA (0.4 GB for Kokoro only), so allow time. Pass `--local-tts=off` to skip it (those voices then run on fal), `--local-tts=kokoro` for Kokoro only or `--local-tts=qwen` for Qwen3 only. A failure here is a warning, not an error. Run without `--yes` in a terminal, setup asks these questions itself, one screen at a time.

   It also installs free local caption timing, apart from the voices (so also with `--local-tts=off`): Whisper and a forced aligner in the same venv, about 2 GB on Apple Silicon or NVIDIA and 0.9 GB on a CPU. Captions are then timed on this computer; without it, ElevenLabs, fal or Gemini time them. Pass `--local-captions=off` to skip it, or set `LOCAL_ASR=off` in `.env` to stop using it. A failure here is a warning too. Skipping a part never uninstalls it: what an earlier setup installed stays on until `LOCAL_TTS=off` or `LOCAL_ASR=off`.

   Setup ends by building the app (a few minutes), so the first start is quick. `--no-build` skips it; the first start then builds instead.

4. **Verify.**
   ```bash
   pnpm reelmakeeasy doctor --json
   ```
   The output is `{ "ok": boolean, "checks": [{ "name", "ok", "blocking", "detail" }] }` and the exit code is non-zero when a blocking check fails. Fix every entry with `"ok": false, "blocking": true` before continuing. Non-blocking entries are warnings. For example, a busy port means an instance is already running.

   Two checks must pass: `Video key` (`FAL_KEY` set, or a `GEMINI_API_KEY` that works) and `Writing and planning` (Codex or Claude Code signed in, or a working Gemini key or endpoint). A failing `Chosen to write` or `Chosen for videos` means a picked provider isn't ready: fix it, or pick another in Setup.

5. **Start.** Run this as a long-lived background process (`pnpm start` does the same):
   ```bash
   pnpm reelmakeeasy start
   ```
   It builds the app first when it isn't built yet or the code changed (for example after a `git pull`). That build takes a few minutes; later starts are quick. Then it prints `[api] … Application is running on: http://localhost:5017/api` and the web app's ready line (`[web] ✓ Ready`). The first start also downloads MongoDB (~65 MB). `pnpm reelmakeeasy build` builds again on demand.

   Use `pnpm dev` only for changing the code: it compiles each page on its first visit, so pages load slowly.

6. **Confirm it's healthy.**
   ```bash
   curl -fsS http://localhost:5017/api/health
   curl -fsS "http://localhost:5017/api/project?q=me&page=1&pageSize=1"
   ```
   Both should return HTTP 200. Then check the web app answers, and send the user to http://localhost:3000:
   ```bash
   curl -fsS -o /dev/null http://localhost:3000/home
   ```

   Then `curl -fsS http://localhost:5017/api/setup/status` shows which keys were found (true/false only) and the choices in effect. If `llm.effective` or `generation.effective` is `null`, send the user to http://localhost:3000/setup.

## Running on a server

- **ReelMakeEasy has no access control.** There is no sign-in and no token: anyone who can reach the API or the web app acts as the local user, can read, create and delete every project, and spends the user's provider keys. Keep it on this computer or a private network. Never expose it to the internet directly.
- **It listens on this computer only.** The API and the web app bind to `127.0.0.1` unless `HOST` in `.env` says otherwise. To serve other machines, put an authenticating reverse proxy (for example oauth2-proxy, Cloudflare Access or Tailscale) on the same machine in front of both. Set `HOST=0.0.0.0` only when they must be reached directly, and then keep both ports behind a firewall.
- Use a real database: `docker compose up -d`, then set `DATABASE_URL=mongodb://127.0.0.1:27017/reelmakeeasy?replicaSet=rs0&directConnection=true` in `.env`. It publishes MongoDB on `127.0.0.1` only, without a password: turn on MongoDB authentication before making it reachable from elsewhere, and put the user and password in `DATABASE_URL`.
- Agent mode (`/api/agent/...`) runs the user's own Codex or Claude Code, so it only accepts requests from this computer (a loopback address with a `localhost`/`127.0.0.1`/`[::1]` Host) and answers 403 otherwise. It also refuses cross-site browser requests (`Sec-Fetch-Site: cross-site`, or an `Origin` that isn't `localhost`/`127.0.0.1`/`[::1]`), so another web page can't drive it from the user's browser. Don't expose it.
- Setup (`/api/setup/...`) also answers only this computer, and the Setup page says so when opened from elsewhere. On a server, set `LLM_PROVIDER` and `GENERATION_PROVIDER` in `.env` instead of using the Setup page.
- Set `PUBLIC_FILES_URL` to the public URL of `<api-origin>/api/files` so browsers can load media. Saved records hold `store://<key>` addresses, never a URL, so changing it (or `PORT`) needs no data change: the URLs are built from it when records are sent to the browser.
- Build once and run the bundle: `pnpm exec nx run api:build && node apps/services/api/dist/main.js` (it reads `HOST` and `PORT` too), plus `pnpm exec nx run web:next-build` for the web app.
- Workflows run inside the API process, so a restart ends any video that is mid-generation. Restart between jobs.
- ReelMakeEasy runs as a single process: locks, rate limits and live events are held in memory (finished runs' status is saved to `<DATA_DIR>/kv.json`), so horizontal scaling isn't supported. Run one instance.

## Common failures

| Symptom | Cause | Fix |
| --- | --- | --- |
| `doctor` shows `Video key` failing | Neither `FAL_KEY` nor a working `GEMINI_API_KEY` | Ask the user for one; a rejected Gemini key needs a new key from AI Studio |
| `doctor` shows `Writing and planning` failing | No AI can write: Codex and Claude Code not signed in, no Gemini key | Run `claude login`, or sign in to Codex in ChatGPT, or add `GEMINI_API_KEY` |
| A video start or agent-mode start says "No AI is set up to make pictures, clips and voices: open Setup. ..." | No usable video key, or the picked one lost its key (the rest of the message says which) | Add the key to `.env`, restart `pnpm reelmakeeasy start`, then pick in Setup |
| The script preview or a video says "No AI is set up for writing and planning: open Setup", or "<AI> can't write and plan right now (...): open Setup" | No AI can write and plan, or the one picked in Setup isn't ready | Fix as for `Writing and planning`, restart `pnpm reelmakeeasy start`, then pick it in Setup |
| `Port 5017 is already in use`, or `Port 3000 (the web app) is in use` | Another instance is running | Stop it, or set `PORT` (and `WEB_PORT` for the web app) |
| The app doesn't open from another machine | The API and the web app listen on `127.0.0.1` only | Use it on this computer, or see [Running on a server](#running-on-a-server) before setting `HOST` |
| `pnpm reelmakeeasy start` stops with `Building the web app failed` (or the API) | The code doesn't compile, or the build ran out of memory | Read the lines above it, fix that, then run `pnpm reelmakeeasy build` |
| Prisma error mentioning replica set | External MongoDB isn't a replica set | Use `docker compose` (it initializes one) or unset `DATABASE_URL` |
| Generation fails with `FAL_KEY is not set` | fal picked but its key is missing | Re-run step 3 with `--fal-key`, or pick Gemini in Setup |
| Render fails with `ffprobe` / `ffmpeg` ENOENT | FFmpeg not on `PATH` for the process | Install FFmpeg and restart `pnpm reelmakeeasy start` |
| `doctor` shows `Local voices` not installed | Setup was skipped or failed | Re-run step 3; check its output for the uv/pip or download error |
| `doctor` shows `Local captions` not installed | Setup ran with `--local-captions=off`, or its download failed | Re-run step 3 without `--local-captions=off`; meanwhile ElevenLabs, fal or Gemini time the captions |
| `doctor` shows `Agent: Claude Code` not signed in | Claude Code isn't logged in for agent chats | Run `claude login`, or set `ANTHROPIC_API_KEY` in `.env` |
| Kokoro/Qwen voices bill fal (or captions are timed online) although they are installed locally | The `[tts]` process exited, or `LOCAL_TTS=off` (`LOCAL_ASR=off` for captions) | Check the `[tts]` lines in the output of `pnpm reelmakeeasy start`; restart it |

## Publishing a video to social platforms

When the user asks to post, publish, share or schedule a finished video (YouTube, X, Instagram, TikTok, LinkedIn, Facebook), or to plan when posts go out, follow the [`publish-social`](skills/publish-social/SKILL.md) skill. It uses the OpusClip MCP server: its `opusclip_*` tools must be connected to your agent, and the user's social accounts connected in OpusClip.

- Upload the finished video once, then post or schedule it per account. Times go in UTC.
- Before posting, turn off OpusClip's emoji and captions, wait for that re-render, then render the final HD export and check it: a post publishes the last finished render, not the edit.
- Ask which video, which accounts, when and with what caption, repeat the plan back, and wait for a clear yes before any post, schedule or cancel.
- Every post, schedule and cancel returns an approval link: give it to the user. Nothing goes out until they confirm it in the OpusClip app.
- Importing the video uses OpusClip credits: check `opusclip_get_usage` and say so first.

## Rules for agents working in this repo

- Don't commit `.env`, `.reelmakeeasy/` or anything containing a key.
- Configuration lives in environment variables. Don't hard-code keys, hosts or model ids in source.
- **Stored files.** A stored file is named by its key and addressed as `store://<key>`; it lives at `<DATA_DIR>/files/<key>` (metadata in `files-meta/`, outside the served folder) and is served at `/api/files/<key>`. Saved data (MongoDB, stored JSON, `kv.json`, agent chat transcripts) holds only `store://` and `preset://` addresses, never a URL with a host or port, and so does text a user typed: an upload's tag keeps the file's address (`@img[label](id|store://…)`, see `toSavedAddressesInText`). The API builds the URLs as data leaves for the browser (`serveStoredUrls`, which serves URL fields and the addresses in text), and turns a served URL the browser sends back into its address where it saves it (`toSavedAddress`, `toSavedAddresses`). A key that leaves `files/` through a link is refused (`filePath`). Parse addresses with `parseStoreUri` and check folders with `keyIsUnder` (`libs/shared/common/src/storage/address.ts`), never with a raw string prefix. Every child of `projects/` is a project id: `projects/<projectId>/` is the one project folder (it took over the agent's old project root and the old `projects/<id>/user_uploaded/` upload prefix, whose only shared sub-path, `user_uploaded/`, meant the same in both). Anything else gets its own top-level folder (`brand-library/`, `tmp/`, `agent/workspace/`, `music-tracks/`, `voice-clones/`, `custom-style/`, `avatars/`).
- **English only for now.** Voice-over scripts, TTS and captions are generated in English regardless of the language of the brief: the caption render fonts in the preset pack only cover English, so other scripts would render with missing glyphs. The planner runtime pins `script_language` to `en` (`libs/uip-planner-runtime/src/normalization.ts`) and the script prompt says so. Voices follow suit: only the native-English Qwen3 presets are visible (`visible: false` on the rest in `preset-voices.ts`), and Qwen3 clones and designed voices always speak English. Don't add or expose other voice/caption languages yet; multi-language support (fonts first, then voices and prompts) is planned for later.
- Before proposing code changes, read [CONTRIBUTING.md](CONTRIBUTING.md) and run the type-check and tests it lists.
