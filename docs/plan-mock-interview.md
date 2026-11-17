# Mock interview mode

Paste a job post, DeepSeek prepares a question plan, then a spoken mock interview in the "Option 2: Video call" layout, recorded into the existing library with a transcript sidecar. No scoring or grading, anywhere.

**Test command:** `npm run check && npx vitest run && npx playwright test`
**Run:** `stt/run.sh` (separate terminal), then `npx vite dev`
**UI target:** `docs/design/mock-interview-variations.html`, section "Option 2: Video call" (CSS under `/* Option 2: Video call */`, the shared `.btn`, `.ptt`, `.timer`, `.msg` rules, and the demo `<script>`). Match it exactly.
**Out of scope:** scoring/feedback, live streaming captions, global (out-of-tab) hotkey, interview resume, choosing voice/model/port in the UI.

## Rules for every phase

- Follow `~/.claude/ENGINEERING.md` and the `svelte` skill: runes only, callback props, keyed `{#each}`, no `$effect` for derived state, flat control flow, no config knobs.
- Server-only code in `src/lib/server/`. Imports use `#lib/...js` like `src/routes/+page.server.ts`.
- Logging: same `log` helper shape as `src/lib/server/recordings.ts` (ISO time + `[module]` tag). Log entry/exit, every external call with duration in ms, results (lengths/counts, not bodies), errors with context. Never log the API key, full job post, or audio bytes.
- Fail loud: throw `Error` naming what failed and the value. Routes convert external failures to `error(502, '<step> failed: <message>')` so the UI can show the message. No silent fallbacks (no CPU fallback for Whisper, no default questions).
- Comments only for a non-obvious why, 2 lines max.
- Commit at the end of each phase: `git add <only this phase's files> && git commit -m "<one line, imperative, no period>"`. Parallel agents stage only their own files; if `.git/index.lock` exists, wait and retry.

## API contract (fixed now so phases 3 and 5 can work in parallel against it)

- `POST /api/interview/plan` `{ jobPost }` → `{ role, level, stack: string[], questions: string[] }`
- `POST /api/interview/turn` `{ plan, history: { who: 'interviewer'|'you'|'hint', text }[], kind: 'next'|'hint' }` → `{ text }`. `next` also stops Kokoro, then speaks `text`. `hint` is not spoken.
- `GET /api/interview/speech` → `{ speaking: boolean, queued: number }`. `DELETE /api/interview/speech` → stops Kokoro, `204`.
- `POST /api/interview/transcribe` raw `audio/webm` body → `{ text }`
- `POST /api/recordings/[name]/transcript` `text/plain` body (finished `[m:ss] Interviewer|You|Hint: text` lines, `m:ss` since recording start) → `201`. `GET /recordings/[name]/transcript` → the saved file as-is, `text/plain`.

## Parallelism map

| Phase | Depends on | Can run alongside | Files it owns (nobody else edits them) |
|---|---|---|---|
| 1 STT server | none | 2 | `stt/*`, `.gitignore` |
| 2 Test harness | none | 1 | `package.json`, `package-lock.json`, `vite.config.ts`, `playwright.config.ts`, `e2e/fixtures.ts`, `e2e/studio.spec.ts` |
| 3 Interview backend | 2 | 4 | `src/lib/server/{deepseek,kokoro,stt,interviewer}.ts` + `.test.ts`, `src/routes/api/interview/**` |
| 4 Shared media + transcript storage | 2 | 3 | `src/lib/devices.svelte.ts`, `src/lib/media.ts`, `src/lib/CheckRow.svelte`, `src/lib/Recorder.svelte`, `src/lib/server/recordings.ts` + `recordings.test.ts`, `src/routes/+page.svelte`, `src/routes/api/recordings/[name]/transcript/+server.ts`, `src/routes/recordings/[name]/transcript/+server.ts` |
| 5 Setup + call view | 3, 4 | none | `src/routes/interview/+page.svelte`, `src/lib/Call.svelte`, `e2e/interview.spec.ts` |
| 6 Talk, hint, end, save | 5 | none | same files as 5 |

Phase 1 only needs to finish before the phase 5 manual check. Phases 5 and 6 are sequential (same files).

## Phase 1 — Local Whisper STT server (riskiest: Blackwell CUDA)

Goal: `stt/run.sh` serves `POST /transcribe` on 127.0.0.1:8790 using the GPU, and turns a webm/opus clip into text.

- [ ] Create `stt/requirements.txt`: pinned `faster-whisper`, plus the `nvidia-cublas-cuXX` and `nvidia-cudnn-cuXX` wheels matching the CUDA major that the installed `ctranslate2` wheel was built for (check `pip show ctranslate2` / its release notes; Kokoro's venv uses CUDA 13 wheels, ctranslate2 may still target 12). Pin exact versions that worked.
- [ ] Create `stt/server.py`: stdlib `http.server.HTTPServer` (single-threaded on purpose: one GPU model, one user) bound to `127.0.0.1:8790`. Load `WhisperModel("large-v3-turbo", device="cuda", compute_type="float16")` once at startup, run one warm-up transcription on 1 s of silence, log device, model and load time. CUDA init failure exits non-zero with the error; no CPU fallback.
- [ ] In `stt/server.py`: `POST /transcribe` reads the raw body, `model.transcribe(io.BytesIO(body), language="en", vad_filter=True)`, joins segment text, returns `{"text": ..., "ms": ...}`. Empty body → 400 JSON error. Decode/transcribe exception → 500 JSON `{"error": "..."}` and logged with byte count. Log each request: bytes in, audio seconds, ms, text length.
- [ ] Create `stt/run.sh` (executable): exports `LD_LIBRARY_PATH` from the venv's `nvidia/cublas/lib` and `nvidia/cudnn/lib` dirs, then execs `stt/.venv/bin/python stt/server.py`. Works from any cwd.
- [ ] Add `stt/.venv/`, `test-results/`, `playwright-report/` to `.gitignore` (phase 1 owns this file; phase 2 needs the last two).
- [ ] Install with `uv venv --python 3.12 stt/.venv && uv pip install --python stt/.venv -r stt/requirements.txt` (system Python is 3.14; ctranslate2 wheels may not exist for it).
- [ ] Verify: start `stt/run.sh` → log shows `device=cuda`, warm-up done. Make a speech clip through the real System_Audio path: `pw-record --target system_audio /tmp/s.wav & sleep 0.5; ksay "Tell me about a time you scaled a service"; sleep 4; kill %1; ffmpeg -y -i /tmp/s.wav -c:a libopus /tmp/s.webm`. Then `curl -s --data-binary @/tmp/s.webm -H 'Content-Type: audio/webm' 127.0.0.1:8790/transcribe` → text contains "scaled a service", `ms` under 1000. This also proves Kokoro's output lands on the System_Audio monitor.
- [ ] Commit: `git add stt .gitignore && git commit -m "Add local faster-whisper STT server"`

## Phase 2 — Test harness (Vitest + Playwright with fake media)

Goal: `npx vitest run` and `npx playwright test` both run; a Studio smoke test passes using Chromium fake devices.

- [ ] `npm i -D vitest @playwright/test` and `npx playwright install chromium`. If vitest's peer range rejects Vite 8, pick the newest vitest whose peer range includes it (`npm view vitest peerDependencies`).
- [ ] `package.json`: add scripts `"test": "vitest run"`, `"test:e2e": "playwright test"`.
- [ ] `vite.config.ts`: add `test: { include: ['src/**/*.test.ts'], environment: 'node' }`. Keep the sveltekit plugin so `#lib` and `$env` resolve.
- [ ] Create `playwright.config.ts`: `testDir: 'e2e'`, Chromium only, `launchOptions.args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']`, `webServer: { command: 'npx vite dev --port 5199 --strictPort', port: 5199 }` (5174 is in use on this machine), `baseURL` to match.
- [ ] Create `e2e/fixtures.ts`: a Playwright `test` extended with an init script that (a) wraps `navigator.mediaDevices.enumerateDevices` to append a copy of the first `audioinput` with label `System_Audio` (same `deviceId`), (b) replaces `getDisplayMedia` with a 1280x720 canvas `captureStream(30)`, (c) routes `**/api/recordings` and `**/api/recordings/**` (Playwright's `*` does not cross `/`) to a `201 { name: 'test.webm' }` stub that records every request (URL, body) so specs can assert the upload and the transcript POST. Export the fixture.
- [ ] Create `e2e/studio.spec.ts`: load `/`, expect Camera, Microphone and System sound rows to show ✓, `● Record` enabled; click it, wait 2 s, click Stop, expect the stubbed upload to have received a non-empty body.
- [ ] Verify: `npx vitest run` → "No test files found" is acceptable at this point only if it exits 0 (add `passWithNoTests: true` to the test config); `npx playwright test` → 1 passed; `npm run check` → 0 errors.
- [ ] Commit: `git add package.json package-lock.json vite.config.ts playwright.config.ts e2e && git commit -m "Add Vitest and Playwright with fake media devices"`

## Phase 3 — Interview backend (DeepSeek, Kokoro, STT proxy)

Goal: the four `/api/interview/*` endpoints in the contract work and are unit-tested with no network, socket or GPU.

- [ ] `src/lib/server/deepseek.ts`: `chat(messages, { json?: boolean, maxTokens: number }): Promise<string>`. Plain `fetch` to `https://api.deepseek.com/chat/completions`, model `deepseek-chat` (non-reasoning), `response_format: { type: 'json_object' }` when `json`, `AbortSignal.timeout(30_000)`. Key from `env.DEEPSEEK_API_KEY` (`$env/dynamic/private`), read per call; missing → throw `DEEPSEEK_API_KEY is not set; add it to .env`. Non-2xx → throw with status and response text. Log model, message count, ms, usage tokens.
- [ ] `src/lib/server/kokoro.ts`: `send(req)` opens one `node:net` connection to `${process.env.XDG_RUNTIME_DIR}/kokoro-speaker.sock` per request (same as `~/.local/bin/ksay`), writes one JSON line, reads one JSON line, closes. `ok: false` → throw with `error`. Connect failure → throw naming the socket path and `systemctl --user start kokoro-speaker`. Unset `XDG_RUNTIME_DIR` → throw. Export `say(text)`, `stop()`, `status(): { speaking, queued }`. 5 s timeout per request.
- [ ] `src/lib/server/stt.ts`: `transcribe(body: ArrayBuffer): Promise<string>` POSTs to `http://127.0.0.1:8790/transcribe`; connection refused → throw `STT server not reachable at 127.0.0.1:8790; start it with stt/run.sh`.
- [ ] `src/lib/server/interviewer.ts`: types `Plan`, `Entry`. `preparePlan(jobPost)`: one `chat({ json: true })` asking for `{ role, level, stack, questions }` (6 to 10 ordered questions fitted to the level and stack); parse and validate (non-empty string `questions`), else throw with the first 200 chars of the reply. `nextTurn(plan, history, kind)`: system prompt = interviewer for `role`/`level`, the ordered question plan, ask one thing at a time, follow up on vague or partial answers, otherwise move to the next planned question, replies are 1 to 2 spoken sentences with no markdown, and never grade, score, rate or give feedback on answer quality. Empty history → greet briefly and ask question 1. `hint` → one short nudge for the current question without giving the answer. Map `interviewer`/`hint` → `assistant` (hint prefixed `(hint)`), `you` → `user`. `maxTokens` 200.
- [ ] `src/routes/api/interview/plan/+server.ts`, `turn/+server.ts`, `speech/+server.ts`, `transcribe/+server.ts`: thin handlers per the contract, same shape as `src/routes/api/recordings/+server.ts`. Validate input with `error(400, ...)`. `turn` with `kind: 'next'` calls `kokoro.stop()` then `kokoro.say(text)` before returning. Log route, ms per step.
- [ ] Tests next to each module (`*.test.ts`): `deepseek` with `vi.stubGlobal('fetch')` and `vi.mock('$env/dynamic/private')` (request shape, missing key, non-2xx); `kokoro` with a real `net.createServer` on a temp socket and `XDG_RUNTIME_DIR` pointed at the temp dir (say/stop/status lines, `ok:false`, missing socket); `stt` with stubbed fetch (text, refused); `interviewer` with `chat` mocked (plan validation, role mapping, empty-history greeting, hint prompt contains no-answer rule, no prompt asks for a score).
- [ ] Verify: `npx vitest run` → all pass; `npm run check` → 0 errors. With `.env` present and Kokoro running, start this app with `npx vite dev --port 5199 --strictPort` (5173 is another app on this machine): `curl -s -XPOST localhost:5199/api/interview/plan -H 'content-type: application/json' -d '{"jobPost":"Senior Go backend engineer, Kafka, Postgres"}'` → JSON with questions; a `turn` call with empty history is heard through the speakers; `curl localhost:5199/api/interview/speech` shows `speaking: true` then `false`. Confirm `speaking || queued > 0` is true immediately after `say` returns (drives the talking outline in phase 5).
- [ ] Commit: `git add src/lib/server/deepseek* src/lib/server/kokoro* src/lib/server/stt* src/lib/server/interviewer* src/routes/api/interview && git commit -m "Add DeepSeek, Kokoro and STT interview endpoints"`

## Phase 4 — Shared media pipeline and transcript storage

Goal: device acquisition and recording live in reusable modules, Studio behaves exactly as before, and recordings can carry a transcript that the library links to.

- [ ] `src/lib/media.ts`: move from `Recorder.svelte` unchanged: `RAW_AUDIO`, `SYSTEM_LABEL`, `SYSTEM_SETUP`, `findSystemDevice` (throws instead of setting `checks.system.fix`; caller sets it), `videoOf`, `tick`, `composite`, `mixAudio`. Add `startRecording({ screen, camera, mic, system })` → `{ stop(): Promise<Blob> }` (the MediaRecorder part of `start`/`stop`, cleanup included) and `uploadRecording(blob, title, duration): Promise<string>` (returns the saved name, throws with status and body on failure).
- [ ] `src/lib/devices.svelte.ts`: `useDevices()` holding the `checks` state, `ready`, the `acquire` wrapper, meters and the `onMount` acquire/cleanup from `Recorder.svelte`. Returns one reactive object (`$state` with `ready` as a getter) exposing `checks`, `ready`, `camera`, `mic`, `system`; callers use `devices.camera` etc. and never destructure it, because the streams are assigned after async mount and a plain literal would freeze them.
- [ ] `src/lib/CheckRow.svelte`: the `.dev` row markup and its CSS (`.dev`, `.ok`, `.fail`, `.pend`, `.meter`, `.fix`) moved from `Recorder.svelte`. Prop: `check`.
- [ ] `src/lib/Recorder.svelte`: use the three modules above. Rendered markup and behaviour unchanged. Add a `<a href="/interview" class="status">Mock interview →</a>` as the last item of `.side` (copies the `.status` small muted text).
- [ ] `src/lib/server/recordings.ts`: `saveTranscript(name, text)` writes `<name minus .webm>.txt` next to the recording (validates `name` via `recordingPath`); `transcriptPath(name)` for the GET route; `listRecordings` adds `transcript: boolean`; `deleteRecording` also removes the sidecar if present.
- [ ] `src/routes/api/recordings/[name]/transcript/+server.ts` (POST text body → 201, empty body → 400) and `src/routes/recordings/[name]/transcript/+server.ts` (GET → the `.txt` file as-is, `text/plain`, 404 when absent).
- [ ] `src/routes/+page.svelte`: in the card's `<small>` line append ` · <a href="/recordings/{name}/transcript" target="_blank">Transcript</a>` when `r.transcript`, inheriting the `.meta small` style (link colour `var(--muted)`, underline). Nothing else in the library changes.
- [ ] `src/lib/server/recordings.test.ts`: `process.chdir` into a temp dir before dynamically importing the module; save writes the text unchanged to `<name>.txt`, list reports `transcript`, delete removes the sidecar with the recording, bad name rejected.
- [ ] Verify: `npx vitest run` and `npx playwright test` (studio smoke unchanged) pass; `npm run check` 0 errors; manual: record 5 s in Studio, it appears in the library as before.
- [ ] Commit: `git add src/lib/media.ts src/lib/devices.svelte.ts src/lib/CheckRow.svelte src/lib/Recorder.svelte src/lib/server/recordings* src/routes/+page.svelte src/routes/api/recordings src/routes/recordings && git commit -m "Extract media pipeline and add transcript sidecars"`

## Phase 5 — Setup, loading and the video-call view

Goal: `/interview` takes a job post, prepares questions, starts recording, and shows the Option 2 call with the interviewer asking question 1 (captions, talking outline, timer, transcript drawer).

- [ ] `src/routes/interview/+page.svelte`, state `'setup' | 'preparing' | 'call' | 'saving'` plus `status` string:
  - setup: copies the Studio `.studio` grid with Recorder's `.side` panel. Rows via `CheckRow` (camera, mic, system from `useDevices()`). Job post `<textarea rows="10">` styled like Recorder's `input`. Button `● Start interview` copies `.recbtn`, disabled (`.recbtn:disabled`) until devices `ready` and text non-empty. Missing key or a down Kokoro/Whisper surfaces through the `Error:` line below or the in-call `Error:` captions. Left column copies Recorder's `.screen` camera preview.
  - preparing: same panel, button disabled with label `Preparing questions...`.
  - error (any step): Recorder's `.status` line with `Error: <message>` (same text pattern as Recorder), state returns to setup.
  - Start click calls `getDisplayMedia` first (needs the click's user activation, which expires during the multi-second plan call), then `POST /plan`, then `startRecording`, then switches to call and requests the first turn. Any error before the call starts stops every track of the display stream before returning to setup.
- [ ] `src/lib/Call.svelte`: port the Option 2 markup and CSS verbatim (`.call`, `.main .screen`, `.tiles`, `.tile`, `.tile.talking`, `.avatar` "AI", `label` "Interviewer"/"You", `.captions` with `<b>Interviewer:</b>` in `--accent` and `<b style="color:var(--good)">You:</b>`, `.dock`, `.timer` left, `.round` 🎙 `aria-label="Mute"`, `.ptt` "Hold Space to talk", `.round` ? `aria-label="Hint"`, `.round.end` "End interview", `.btn.drawer-btn` "☰ Transcript", the `@media (max-width: 900px)` tile width) plus the `--warn` token. The `.main .screen` shows the live screen-share `<video>` (object-fit contain) instead of the mockup SVG; the `.me` tile shows the camera `<video>` with the `.me` box's inset and radius. Remove the `.stage`/`.variant` wrappers only. The call fills the viewport width like the mockup stage.
- [ ] `Call.svelte` transcript drawer (not drawn in the mockup): panel copies the mockup's `.room .convo` (`--panel` background, `--line` border, 10px radius) anchored under the drawer button, list uses the mockup's `.msg`, `.msg .who`, `.msg.ai .body`, `.msg.me .body` rules, `who` text "Interviewer", "You", "Hint" (Hint `who` in `--warn`, as the mockup JS does). Toggled by the button.
- [ ] `Call.svelte` speaking loop: after each `next` turn returns, set captions to the interviewer line, add `.talking` to the AI tile, poll `GET /api/interview/speech` every 300 ms until `!speaking && queued === 0`, then remove it. Timer counts from recording start, format `m:ss` as in the mockup script.
- [ ] `e2e/interview.spec.ts` (uses `e2e/fixtures.ts`; `page.route` stubs every `/api/interview/*` call, speech returns speaking twice then idle): device rows ✓, Start disabled until text entered, plan stub called with the job post, call view shows "Interviewer:" caption with the stubbed question, AI tile `.talking` then not, timer advances, drawer lists the question. Plan stub returning 502 shows `Error: ...` on setup and the stubbed display stream's tracks are stopped (`readyState === 'ended'`).
- [ ] Verify: `npx playwright test` → all pass; `npm run check` 0 errors. Screenshot the call view at 1180px wide and the mockup's Option 2 panel at the same width; compare side by side: tile size/position, caption position and label colours, dock order (timer, 🎙, pill, ?, End interview), button shapes. No differences other than real video in place of the placeholders.
- [ ] Commit: `git add src/routes/interview src/lib/Call.svelte e2e/interview.spec.ts && git commit -m "Add mock interview setup and video call view"`

## Phase 6 — Push-to-talk, hint, mute, end and save

Goal: a full spoken interview works end to end and lands in the library with its transcript.

- [ ] `Call.svelte` push-to-talk: on `window` keydown/keyup (capture phase) for `Space`, ignore `e.repeat` and events whose target is an input, textarea or contenteditable; `preventDefault` so Space never clicks a focused button (End interview stays focused after a click). Pointer down/up/leave on the pill does the same, as in the mockup script. While held: pill `aria-pressed="true"` and text `● Listening… release to send`, You tile `.talking`, AI tile not, captions `You: …`; if the AI is speaking, `DELETE /api/interview/speech` first (barge-in). Only one turn in flight: while a `/transcribe` or `/turn` request is pending, Space, the pill and `?` are ignored (pill and `?` `disabled`).
- [ ] Clip capture: a second `MediaRecorder` on the mic stream only (`audio/webm;codecs=opus`), separate from the main recording. On release: clips under 300 ms are dropped; otherwise `POST /transcribe`, caption `You: <text>`, append to transcript, then `POST /turn` `kind: 'next'` and run the speaking loop. Empty text → log warn, no turn. Log client timings for record, transcribe, turn, first-speech.
- [ ] Hint `?`: `POST /turn` `kind: 'hint'`, caption `<b style="color:var(--warn)">Hint:</b> text`, append to transcript. Not spoken, as in the mockup script.
- [ ] Mute 🎙: toggles the mic track `enabled` (silences both the recording and clips), `aria-pressed` reflects it.
- [ ] End interview: set an `ended` flag (any `/transcribe` or `/turn` result arriving after it is dropped, not captioned or appended, and no speaking loop starts), discard a held Space clip, and show `Saving...`; if a `/transcribe` or `/turn` is in flight, await it settling first, because the server's `/turn` calls `kokoro.say` itself and would talk after an earlier `DELETE /speech`. Then stop polling, `DELETE /speech`, stop the clip recorder, `startRecording().stop()`, `uploadRecording(blob, 'interview-' + plan.role, elapsed)`, `POST /api/recordings/<name>/transcript` with the entries formatted as `[m:ss] Who: text` lines (one per line, `m:ss` as the timer), then `goto('/')`. While saving, captions show `Saving...` (Recorder's status text). If either save step fails, keep the blob and transcript in memory, show `<b style="color:var(--bad)">Error:</b> message` with a `.btn` "Retry save" that reruns the failed steps (no re-upload once the recording is saved), and only `goto('/')` after both succeed. Screen share ended by the browser triggers the same path, as Recorder does.
- [ ] In-call errors (transcribe, turn, speech): captions show `<b style="color:var(--bad)">Error:</b> message` (same pattern as the Hint caption), logged with context; the interview continues.
- [ ] Extend `e2e/interview.spec.ts`: hold Space → pill pressed, You tile talking; release → transcribe stub received a non-empty `audio/webm` body, caption `You: <stub text>`, turn stub received history with that entry; Space with focus on End interview does not end; hint shows `Hint:` caption; a second Space press while the turn stub is still pending (delayed response) sends no second transcribe or turn request; End → upload and transcript stubs called (transcript body is `[m:ss] Who: text` lines in order) and URL is `/`; End pressed while the turn stub is delayed → `Saving...` shown, `DELETE /speech` sent only after the turn stub responds, and the posted transcript has no `Interviewer:` line for that reply; transcript stub returning 500 once shows `Error:` and "Retry save", URL stays `/interview`, Retry posts the transcript again without a second upload, then URL is `/`; transcribe 502 shows an `Error:` caption.
- [ ] Verify: `npx vitest run && npx playwright test` all pass, `npm run check` 0 errors. Manual run with real services: 3 to 4 turns, release-to-voice under 4 s (check logs), End, card appears in Studio with a working Transcript link, video contains both your voice and the interviewer's.
- [ ] Commit: `git add src/routes/interview src/lib/Call.svelte e2e/interview.spec.ts && git commit -m "Add push-to-talk, hints and saving to mock interview"`

## Risks

- **Turn latency** (target under 4 s from release to voice): upload ~50 ms, Whisper turbo on GPU ~0.3 to 0.8 s, DeepSeek `deepseek-chat` 1 to 3 s, Kokoro first audio ~0.3 s. Mitigate: non-reasoning model, `maxTokens` 200 and 1 to 2 sentence replies, model warm-up at STT start, per-step timings logged on server and client so the slow step is obvious.
- **Space key**: only works while the interview tab has focus; diagramming in another window steals it. Mitigate: the pill also works with mouse hold; a global hotkey is out of scope. Space on a focused button would click it, so the handler always `preventDefault`s. Inputs/textareas are ignored; the job post textarea is not mounted during the call.
- **Kokoro is one shared speaker**: anything else using `ksay` speaks into the recording, and our `stop` clears its queue. Mitigate: log a warning if it is already speaking at start; use headphones so the mic does not pick up the speakers. Kokoro must play on the sink whose monitor is `System_Audio` (phase 1 verify proves it).
- **faster-whisper on RTX 50-series (Blackwell, sm_120)**: needs a recent ctranslate2 built for a CUDA that supports sm_120 and matching cuBLAS/cuDNN libs. Mitigate: phase 1 runs first and in isolation, pinned wheels, `run.sh` sets `LD_LIBRARY_PATH`, Python 3.12 via uv. If no wheel works, stop and report: fallback options are building ctranslate2 from source or a torch-based Whisper in Kokoro's venv. No silent CPU fallback.
- **DeepSeek key missing or bad**: Start surfaces it on setup as `Error: plan failed: DEEPSEEK_API_KEY is not set...` or `Error: plan failed: 401 ...`.
- **DeepSeek model name drift**: confirm `deepseek-chat` with `curl -H "Authorization: Bearer $KEY" https://api.deepseek.com/models` in phase 3 verify.
- **Playwright fake screen**: `--use-fake-ui-for-media-stream` does not reliably satisfy `getDisplayMedia`, so the fixture stubs it with a canvas stream.

## Manual steps for the user

1. Create `.env` in the repo root with `DEEPSEEK_API_KEY=...` (already gitignored).
2. Once: `uv venv --python 3.12 stt/.venv && uv pip install --python stt/.venv -r stt/requirements.txt`.
3. Each session: `systemctl --user start kokoro-speaker` (if not running), `stt/run.sh` in its own terminal, then `npx vite dev`.
4. Load the System_Audio PipeWire source if the setup row says so (Recorder already prints the `pactl` command).
5. Use headphones during interviews.
