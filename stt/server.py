import io
import json
import sys
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer

import numpy as np
from faster_whisper import WhisperModel

HOST, PORT = "127.0.0.1", 8790
MODEL, DEVICE, COMPUTE = "large-v3-turbo", "cuda", "float16"


def log(level, msg):
    print(f"{datetime.now(timezone.utc).isoformat()} {level} [stt] {msg}", flush=True)


def load_model():
    log("info", f"loading model={MODEL} device={DEVICE} compute_type={COMPUTE}")
    t0 = time.monotonic()
    try:
        model = WhisperModel(MODEL, device=DEVICE, compute_type=COMPUTE)
        segments, _ = model.transcribe(np.zeros(16000, dtype=np.float32), language="en")
        list(segments)
    except Exception as e:
        log("error", f"CUDA model init failed for model={MODEL} device={DEVICE}: {e!r}")
        sys.exit(1)
    log("info", f"model ready model={MODEL} device={DEVICE} load_ms={(time.monotonic() - t0) * 1000:.0f} warm-up done")
    return model


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/transcribe":
            log("warn", f"404 path={self.path}")
            self.send_json(404, {"error": f"unknown path {self.path}"})
            return
        size = int(self.headers.get("Content-Length") or 0)
        if size == 0:
            log("warn", "400 empty body")
            self.send_json(400, {"error": "empty body; send raw audio bytes"})
            return
        body = self.rfile.read(size)
        log("debug", f"transcribe start bytes={size}")
        t0 = time.monotonic()
        try:
            segments, info = self.server.model.transcribe(io.BytesIO(body), language="en", vad_filter=True)
            text = "".join(s.text for s in segments).strip()
        except Exception as e:
            log("error", f"transcribe failed bytes={size}: {e!r}")
            self.send_json(500, {"error": f"transcribe failed: {e}"})
            return
        ms = round((time.monotonic() - t0) * 1000)
        log("info", f"transcribe done bytes={size} audio_s={info.duration:.2f} ms={ms} text_len={len(text)}")
        self.send_json(200, {"text": text, "ms": ms})

    def log_message(self, format, *args):
        log("debug", f"http {self.address_string()} {format % args}")


def main():
    model = load_model()
    # Single-threaded on purpose: one GPU model, one user.
    server = HTTPServer((HOST, PORT), Handler)
    server.model = model
    log("info", f"listening on http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
