import json
import logging
import os
import queue
import re
import socketserver
import subprocess
import threading
import time
from pathlib import Path

from kokoro import KModel, KPipeline

SOCKET_PATH = f"{os.environ['XDG_RUNTIME_DIR']}/interview-kokoro.sock"
DEFAULT_VOICE = "bm_daniel"
DEFAULT_SPEED = 1.3
SAMPLE_RATE = 24000
SENTENCE_SPLIT = r"(?<=[.!?])\s+"
MARKDOWN = re.compile(r"[*_`#>]+")

log = logging.getLogger("tts")


class Speaker:
    def __init__(self):
        t = time.perf_counter()
        self.model = KModel().to("cpu").eval()
        self.pipelines = {}
        self.queue = queue.Queue()
        self.epoch = 0
        self.speaking = False
        self.player = None
        self.lock = threading.Lock()
        list(self.pipeline(DEFAULT_VOICE)("warm up", voice=DEFAULT_VOICE))
        self.ensure_player()
        log.info("model loaded and warmed in %.1fs, voice=%s speed=%s", time.perf_counter() - t, DEFAULT_VOICE, DEFAULT_SPEED)

    def pipeline(self, voice):
        lang = voice[0]
        if lang not in self.pipelines:
            log.info("creating pipeline for lang=%s (voice=%s)", lang, voice)
            self.pipelines[lang] = KPipeline(lang_code=lang, model=self.model, device="cpu")
        return self.pipelines[lang]

    def ensure_player(self):
        if self.player and self.player.poll() is None:
            return self.player
        if self.player:
            log.warning("player exited with code %s, restarting", self.player.returncode)
        # Small latency target so audio starts as soon as the first sentence lands.
        self.player = subprocess.Popen(
            ["pacat", "--format=float32le", f"--rate={SAMPLE_RATE}", "--channels=1", "--latency-msec=50"],
            stdin=subprocess.PIPE,
        )
        log.info("player started pid=%s", self.player.pid)
        return self.player

    def say(self, text, voice, speed):
        with self.lock:
            epoch = self.epoch
        self.queue.put((epoch, text, voice, speed))
        log.info("queued epoch=%s voice=%s speed=%s chars=%d queue=%d", epoch, voice, speed, len(text), self.queue.qsize())

    def stop(self):
        with self.lock:
            self.epoch += 1
            dropped = 0
            while not self.queue.empty():
                self.queue.get_nowait()
                dropped += 1
            player, self.player = self.player, None
        if player and player.poll() is None:
            player.kill()
            player.wait()
        log.info("stopped: epoch=%s dropped_queued=%d killed_player=%s", self.epoch, dropped, bool(player))
        self.ensure_player()
        return dropped

    def run(self):
        while True:
            epoch, text, voice, speed = self.queue.get()
            if epoch != self.epoch:
                log.debug("skipping stale item epoch=%s current=%s", epoch, self.epoch)
                continue
            self.speaking = True
            try:
                self.speak(epoch, text, voice, speed)
            except Exception:
                log.exception("failed speaking voice=%s text=%r", voice, text[:80])
            finally:
                self.speaking = self.queue.qsize() > 0

    def speak(self, epoch, text, voice, speed):
        t0 = time.perf_counter()
        clean = MARKDOWN.sub("", text)
        for i, r in enumerate(self.pipeline(voice)(clean, voice=voice, speed=speed, split_pattern=SENTENCE_SPLIT)):
            if epoch != self.epoch:
                log.info("interrupted after %d sentences", i)
                return
            audio = r.audio.numpy().astype("float32").tobytes()
            if i == 0:
                log.info("first audio ready after %.0fms", 1000 * (time.perf_counter() - t0))
            try:
                self.ensure_player().stdin.write(audio)
                self.player.stdin.flush()
            except (BrokenPipeError, AttributeError):
                log.warning("player went away mid-write (likely stopped), sentence %d dropped", i)
                return
            log.debug("sentence %d handed to player at %.0fms, %.2fs audio: %r", i, 1000 * (time.perf_counter() - t0), len(r.audio) / SAMPLE_RATE, r.graphemes[:60])
        log.info("all audio handed to player after %.0fms", 1000 * (time.perf_counter() - t0))


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        raw = self.rfile.readline()
        try:
            req = json.loads(raw)
            cmd = req["cmd"]
        except (json.JSONDecodeError, KeyError) as e:
            log.error("bad request %r: %s", raw[:200], e)
            return self.reply(ok=False, error=f"bad request: {e}")
        log.debug("request cmd=%s", cmd)
        speaker = self.server.speaker
        if cmd == "say":
            speaker.say(req["text"], req.get("voice") or DEFAULT_VOICE, req.get("speed") or DEFAULT_SPEED)
            return self.reply(ok=True)
        if cmd == "stop":
            return self.reply(ok=True, dropped=speaker.stop())
        if cmd == "status":
            return self.reply(ok=True, speaking=speaker.speaking, queued=speaker.queue.qsize(), voice=DEFAULT_VOICE, speed=DEFAULT_SPEED)
        log.error("unknown command %r", cmd)
        self.reply(ok=False, error=f"unknown command: {cmd}")

    def reply(self, **body):
        self.wfile.write(json.dumps(body).encode() + b"\n")


class Server(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True


def main():
    logging.basicConfig(level=os.environ.get("SPEAK_LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
    speaker = Speaker()
    threading.Thread(target=speaker.run, daemon=True).start()
    Path(SOCKET_PATH).unlink(missing_ok=True)
    with Server(SOCKET_PATH, Handler) as server:
        server.speaker = speaker
        log.info("listening on %s", SOCKET_PATH)
        server.serve_forever()


if __name__ == "__main__":
    main()
