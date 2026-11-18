use std::io::Cursor;
use std::time::Instant;

use parakeet_rs::{ExecutionConfig, Nemotron};
use serde_json::json;
use tiny_http::{Header, Method, Request, Response, Server};

const ADDR: &str = "127.0.0.1:8790";
const SAMPLE_RATE: u32 = 16000;

macro_rules! log {
    ($level:expr, $($arg:tt)*) => {
        println!("{} {} [stt] {}", timestamp(), $level, format!($($arg)*))
    };
}

fn timestamp() -> String {
    let d = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    format!("{}.{:03}", d.as_secs(), d.subsec_millis())
}

fn load_model(dir: &str) -> Nemotron {
    let threads = std::thread::available_parallelism().map_or(4, |n| n.get());
    log!("info", "loading model dir={dir} device=cpu threads={threads}");
    let t0 = Instant::now();
    let env = parakeet_rs::ort::init().build().unwrap_or_else(|e| fail(&format!("onnx runtime init failed: {e}")));
    let config = ExecutionConfig::new().with_environment(env).with_intra_threads(threads);
    let mut model = Nemotron::from_pretrained(dir, Some(config)).unwrap_or_else(|e| fail(&format!("model load failed from {dir}: {e}")));
    // First inference pays for arena setup; do it now, not on the first answer.
    model.transcribe_audio(&vec![0.0; SAMPLE_RATE as usize]).unwrap_or_else(|e| fail(&format!("warm-up failed: {e}")));
    log!("info", "model ready load_ms={} warm-up done", t0.elapsed().as_millis());
    model
}

fn fail(msg: &str) -> ! {
    log!("error", "{msg}");
    std::process::exit(1);
}

fn decode_wav(body: &[u8]) -> Result<Vec<f32>, String> {
    let reader = hound::WavReader::new(Cursor::new(body)).map_err(|e| format!("not a WAV file: {e}"))?;
    let spec = reader.spec();
    if spec.sample_rate != SAMPLE_RATE || spec.channels != 1 {
        return Err(format!("need {SAMPLE_RATE} Hz mono, got {} Hz x{} channels", spec.sample_rate, spec.channels));
    }
    match spec.sample_format {
        hound::SampleFormat::Float => reader.into_samples::<f32>().collect::<Result<_, _>>(),
        hound::SampleFormat::Int => reader.into_samples::<i16>().map(|s| s.map(|v| v as f32 / 32768.0)).collect::<Result<_, _>>(),
    }
    .map_err(|e| format!("bad WAV samples: {e}"))
}

fn reply(req: Request, status: u16, body: serde_json::Value) {
    let header = Header::from_bytes("Content-Type", "application/json").expect("static header");
    if let Err(e) = req.respond(Response::from_string(body.to_string()).with_status_code(status).with_header(header)) {
        log!("warn", "reply failed status={status}: {e}");
    }
}

fn handle(model: &mut Nemotron, mut req: Request) {
    if *req.method() != Method::Post || req.url() != "/transcribe" {
        log!("warn", "404 {} {}", req.method(), req.url());
        let msg = format!("unknown path {}", req.url());
        return reply(req, 404, json!({ "error": msg }));
    }
    let mut body = Vec::new();
    if let Err(e) = req.as_reader().read_to_end(&mut body) {
        log!("error", "read body failed: {e}");
        return reply(req, 400, json!({ "error": format!("read body failed: {e}") }));
    }
    if body.is_empty() {
        log!("warn", "400 empty body");
        return reply(req, 400, json!({ "error": "empty body; send a 16 kHz mono WAV" }));
    }
    let audio = match decode_wav(&body) {
        Ok(a) => a,
        Err(e) => {
            log!("warn", "400 bytes={}: {e}", body.len());
            return reply(req, 400, json!({ "error": e }));
        }
    };
    let audio_s = audio.len() as f32 / SAMPLE_RATE as f32;
    log!("debug", "transcribe start bytes={} audio_s={audio_s:.2}", body.len());
    let t0 = Instant::now();
    match model.transcribe_audio(&audio) {
        Ok(text) => {
            let text = text.trim().to_string();
            let ms = t0.elapsed().as_millis();
            log!("info", "transcribe done bytes={} audio_s={audio_s:.2} ms={ms} text_len={}", body.len(), text.len());
            reply(req, 200, json!({ "text": text, "ms": ms }));
        }
        Err(e) => {
            log!("error", "transcribe failed bytes={} audio_s={audio_s:.2}: {e}", body.len());
            reply(req, 500, json!({ "error": format!("transcribe failed: {e}") }));
        }
    }
}

fn main() {
    let dir = std::env::args().nth(1).unwrap_or_else(|| fail("usage: stt <model dir>"));
    let mut model = load_model(&dir);
    let server = Server::http(ADDR).unwrap_or_else(|e| fail(&format!("cannot listen on {ADDR}: {e}")));
    log!("info", "listening on http://{ADDR}");
    // One request at a time: one model, one user.
    for req in server.incoming_requests() {
        handle(&mut model, req);
    }
}
