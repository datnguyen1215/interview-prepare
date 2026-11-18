# /// script
# requires-python = ">=3.12"
# dependencies = ["huggingface_hub", "onnx", "onnxruntime"]
# ///
import shutil
import sys
import time
from pathlib import Path

from huggingface_hub import snapshot_download
from onnxruntime.quantization import QuantType, quantize_dynamic

REPO = "altunenes/parakeet-rs"
SUBDIR = "nemotron-speech-streaming-en-0.6b"
# Attention stays fp32: ORT's default list turns it into QAttention, which breaks this graph.
INT8_OPS = ["MatMul", "Gemm", "Gather", "LSTM"]


def log(msg):
    print(f"[fetch-model] {msg}", flush=True)


def main():
    out = Path(sys.argv[1])
    if (out / "encoder.onnx").exists():
        log(f"model already at {out}, nothing to do")
        return
    cache = out.parent / ".download"
    log(f"downloading {REPO}/{SUBDIR} (~2.5 GB) into {cache}")
    t0 = time.monotonic()
    src = Path(snapshot_download(REPO, allow_patterns=[f"{SUBDIR}/*"], local_dir=cache)) / SUBDIR
    log(f"downloaded in {time.monotonic() - t0:.0f}s")
    tmp = out.with_name(out.name + ".tmp")
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    for name in ("encoder.onnx", "decoder_joint.onnx"):
        t0 = time.monotonic()
        log(f"quantizing {name} to int8")
        quantize_dynamic(model_input=str(src / name), model_output=str(tmp / name), weight_type=QuantType.QInt8, op_types_to_quantize=INT8_OPS)
        log(f"quantized {name} in {time.monotonic() - t0:.0f}s, {(tmp / name).stat().st_size / 1e6:.0f} MB")
    shutil.copy(src / "tokenizer.model", tmp / "tokenizer.model")
    tmp.rename(out)
    shutil.rmtree(cache)
    log(f"model ready at {out}")


if __name__ == "__main__":
    main()
