"""Optional local speech engines. Embedded in the sidecar, executed without a shell."""
import argparse
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import urllib.request
import wave
import zipfile

VOSK_MODELS = {
    "vosk-model-small-ru-0.22": "ru",
    "vosk-model-small-en-us-0.15": "en",
    "vosk-model-small-uk-v3-nano": "uk",
}
WHISPER_MODELS = {"tiny", "base", "small", "medium", "large-v3", "large-v3-turbo"}


def model_path(args):
    return Path(args.home) / "models" / args.engine / args.model


def check(args):
    package = "faster_whisper" if args.engine == "faster-whisper" else "vosk"
    if importlib.util.find_spec(package) is None:
        return {"ready": False, "message": "Движок не установлен. Нажмите «Установить движок и модель»."}
    model = model_path(args)
    files = ["model.bin", "config.json", "tokenizer.json"] if args.engine == "faster-whisper" else ["am/final.mdl", "conf/model.conf"]
    if not all((model / name).is_file() for name in files):
        return {"ready": False, "message": "Модель не загружена. Нажмите «Установить движок и модель»."}
    return {"ready": True, "message": "Движок и модель готовы. Диктовка работает без сети."}


def prepare(args):
    destination = model_path(args)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if args.engine == "faster-whisper":
        from faster_whisper.utils import download_model
        download_model(args.model, output_dir=str(destination))
    elif not check(args)["ready"]:
        # Only catalogued model URLs are accepted. Extract into a private staging directory.
        url = "https://alphacephei.com/vosk/models/" + args.model + ".zip"
        with tempfile.TemporaryDirectory(dir=destination.parent) as temporary:
            temporary = Path(temporary)
            archive_path = temporary / "model.zip"
            total = 0
            with urllib.request.urlopen(url, timeout=60) as response, archive_path.open("wb") as output:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > 250 * 1024 * 1024:
                        raise ValueError("Архив модели превышает 250 МБ.")
                    output.write(chunk)
            with zipfile.ZipFile(archive_path) as archive:
                if sum(member.file_size for member in archive.infolist()) > 500 * 1024 * 1024:
                    raise ValueError("Распакованная модель превышает 500 МБ.")
                for member in archive.infolist():
                    target = (temporary / member.filename).resolve()
                    if not target.is_relative_to(temporary.resolve()) or (member.external_attr >> 16) & 0o170000 == 0o120000:
                        raise ValueError("Небезопасный путь в архиве модели.")
                archive.extractall(temporary)
            if destination.exists():
                raise ValueError("Каталог модели уже существует, но неполон: " + str(destination))
            shutil.move(str(temporary / args.model), destination)
    result = check(args)
    if not result["ready"]:
        raise ValueError(result["message"])
    return result


def transcribe(args):
    if not check(args)["ready"]:
        raise ValueError(check(args)["message"])
    audio = sys.stdin.buffer.read(2_900_045)
    if len(audio) > 2_900_044:
        raise ValueError("Запись превышает 90 секунд.")
    source = io.BytesIO(audio)
    with wave.open(source, "rb") as recording:
        if recording.getnchannels() != 1 or recording.getsampwidth() != 2 or recording.getframerate() != 16000:
            raise ValueError("Нужен WAV: mono, PCM16, 16000 Гц.")
        if recording.getnframes() > 90 * 16000:
            raise ValueError("Запись превышает 90 секунд.")
        frames = recording.readframes(recording.getnframes())
    if args.engine == "faster-whisper":
        import numpy as np
        from faster_whisper import WhisperModel
        # ponytail: cold model load per recording. Keep a worker alive if startup latency matters.
        model = WhisperModel(str(model_path(args)), device=args.device,
                             compute_type="int8" if args.device == "cpu" else "float16",
                             local_files_only=True)
        samples = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
        segments, _ = model.transcribe(samples, language=None if args.language == "auto" else args.language,
                                       beam_size=5, vad_filter=True)
        text = " ".join(segment.text.strip() for segment in segments).strip()
    else:
        from vosk import KaldiRecognizer, Model, SetLogLevel
        SetLogLevel(-1)
        recognizer = KaldiRecognizer(Model(str(model_path(args))), 16000)
        parts = []
        for offset in range(0, len(frames), 8000):
            if recognizer.AcceptWaveform(frames[offset:offset + 8000]):
                parts.append(json.loads(recognizer.Result()).get("text", ""))
        parts.append(json.loads(recognizer.FinalResult()).get("text", ""))
        text = " ".join(part for part in parts if part).strip()
    return {"text": text}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["check", "prepare", "transcribe"])
    parser.add_argument("--engine", required=True, choices=["faster-whisper", "vosk"])
    parser.add_argument("--model", required=True)
    parser.add_argument("--home", required=True)
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    parser.add_argument("--language", choices=["auto", "ru", "uk", "en"], default="auto")
    args = parser.parse_args()
    allowed = WHISPER_MODELS if args.engine == "faster-whisper" else VOSK_MODELS
    if args.model not in allowed:
        raise ValueError("Неизвестная локальная модель.")
    if args.action != "prepare":
        os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1")
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    return {"check": check, "prepare": prepare, "transcribe": transcribe}[args.action](args)


if __name__ == "__main__":
    try:
        print(json.dumps(main(), ensure_ascii=False))
    except Exception as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False))
        sys.exit(1)
