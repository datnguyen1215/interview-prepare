# Setup

## Prerequisites

- **Linux with PipeWire** (for system audio capture)
- **Node.js 22.17+** (developed on Node 24)
- **Chromium-based browser** (Chrome, Chromium, Edge)
- **Python 3.12, an NVIDIA GPU and [uv](https://docs.astral.sh/uv/)** for the speech-to-text server. It is pinned to CUDA (`float16`) and exits if CUDA fails to start; there is no CPU fallback.
- **A Kokoro TTS server** listening on `$XDG_RUNTIME_DIR/kokoro-speaker.sock` and playing audio to your default output. It is not part of this repo; see the [socket protocol](architecture.md#kokoro-socket-protocol) to plug in your own.
- **A DeepSeek API key**

## 1. Install

```sh
npm install
cp .env.example .env   # then set DEEPSEEK_API_KEY
```

## 2. Start speech-to-text

```sh
uv venv --python 3.12 stt/.venv
uv pip install --python stt/.venv -r stt/requirements.txt
stt/run.sh   # leave running; serves POST /transcribe on 127.0.0.1:8790
```

The first start downloads the Whisper model.

## 3. Create the System_Audio source

The recording captures what your speakers play (including Daniel) through a PipeWire virtual source named `System_Audio`. Create it with:

```sh
pw-loopback -n system_audio_loopback \
  --capture-props='stream.capture.sink=true node.passive=true node.name=system_audio_capture' \
  --playback-props='media.class=Audio/Source node.name=system_audio node.description=System_Audio'
```

Leave it running. If it is missing, the System sound check fails and shows this command.

## 4. Run

```sh
npm run dev
```

Open the printed URL (default `http://localhost:5173`) in Chrome.

## 5. Interview

1. Allow camera and microphone. Wait for Camera, Microphone and System sound to turn green.
2. Click **Share screen** and pick the screen or window you will work in.
3. Paste the job post and click **Start interview**. Daniel greets you and asks the first question.
4. **Hold Space** to answer, release to send. Press `?` for a hint, the mic button to mute, **☰ Transcript** to read back the conversation.
5. Click **End interview**. The recording and transcript are saved and appear in the library.

Recordings land in `./recordings/` as `<timestamp>_<title>_<seconds>s.webm` with a matching `.txt` transcript. The folder is git-ignored.

## Testing

```sh
npm run check          # svelte-check + TypeScript
npm test               # Vitest unit tests
npx playwright install chromium   # once
npm run test:e2e       # Playwright, starts its own dev server on port 5199
```

The end-to-end tests use Chromium's fake camera and mic, a canvas stream as the screen share, and stub every `/api/interview/*` and `/api/recordings` call, so they need no API key, GPU, Kokoro or PipeWire, and never write to `recordings/`.
