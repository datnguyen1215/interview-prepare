# Setup

## Prerequisites

- **Linux with PipeWire** (for system audio capture)
- **Node.js 22.17+** (developed on Node 24)
- **Chromium-based browser** (Chrome, Chromium, Edge)
- **[uv](https://docs.astral.sh/uv/)** (fetches Python 3.12 for the voice servers) and **[Rust](https://rustup.rs/)** (builds the speech-to-text server)
- **About 5 GB of disk** for models and build output. No GPU needed: both voice servers run on CPU.
- **A DeepSeek API key**

## 1. Install

```sh
npm install
cp .env.example .env   # then set DEEPSEEK_API_KEY
```

## 2. Start speech-to-text

```sh
stt/run.sh   # leave running; serves POST /transcribe on 127.0.0.1:8790
```

Speech-to-text is NVIDIA Nemotron (`nemotron-speech-streaming-en-0.6b`) on CPU. The first start downloads it (about 2.5 GB), shrinks it to int8 in `stt/models/` (about 850 MB), and builds the server. That takes a few minutes; later starts take about a second.

## 3. Start Daniel's voice (Kokoro, CPU only)

```sh
tts/run.sh   # leave running; listens on $XDG_RUNTIME_DIR/interview-kokoro.sock
```

The first start installs its Python packages and downloads the Kokoro model into `tts/models/` (about 300 MB).

After the first start of both, everything lives inside the project folder and works offline. To move to another computer, copy the folder, or clone it and let the first start set things up again.

## 4. Create the System_Audio source

The recording captures what your speakers play (including Daniel) through a PipeWire virtual source named `System_Audio`. Create it with:

```sh
pw-loopback -n system_audio_loopback \
  --capture-props='stream.capture.sink=true node.passive=true node.name=system_audio_capture' \
  --playback-props='media.class=Audio/Source node.name=system_audio node.description=System_Audio'
```

Leave it running. If it is missing, the System sound check fails and shows this command.

## 5. Run

```sh
npm run dev
```

Open the printed URL (default `http://localhost:5173`) in Chrome.

## 6. Interview

1. Allow camera and microphone. Wait for Camera, Microphone and System sound to turn green.
2. Click **Share screen** and pick the screen or window you will work in.
3. Paste the job post and click **Start interview**. Daniel greets you and asks the first question.
4. Just answer out loud. About 1.5 seconds of silence sends your answer; start talking while Daniel speaks to interrupt him. Press `?` for a hint, the mic button to mute (nothing is heard while muted), **☰ Transcript** to read back the conversation.
5. Click **End interview**. The recording and transcript are saved and appear in the library.

Recordings land in `./recordings/` as `<timestamp>_<title>_<seconds>s.webm` with a matching `.txt` transcript. The folder is git-ignored.

## Testing

```sh
npm run check          # svelte-check + TypeScript
npm test               # Vitest unit tests
npx playwright install chromium   # once
npm run test:e2e       # Playwright, starts its own dev server on port 5199
```

The end-to-end tests use Chromium's fake camera and mic, a canvas stream as the screen share, a scripted stand-in for voice detection, and stub every `/api/interview/*` and `/api/recordings` call, so they need no API key, voice servers or PipeWire, and never write to `recordings/`.
