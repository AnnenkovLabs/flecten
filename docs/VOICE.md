# Voice Input

Clicking the microphone button in the composer records up to 90 seconds of speech. Clicking again stops capture and inserts the transcribed text into the composer draft without auto-sending. Pressing `Escape` or **Cancel** aborts capture and transcription immediately.

## Recognition Modes

Configure under **Settings > General > Voice Input > Speech Recognition**:

| Mode | Best for | Execution |
| --- | --- | --- |
| Provider API | Zero local setup via an `/audio/transcriptions` endpoint | Remote server of selected `voice.provider` |
| `faster-whisper` | High accuracy, multilingual dictation, complex technical terms | Local CPU (`int8`) or NVIDIA CUDA (`float16`) |
| `Vosk` | Compact models, low-spec CPUs, single preselected language | Local CPU |

`faster-whisper` offers `tiny`, `base`, `small`, `medium`, `large-v3-turbo`, and `large-v3` (start with `small`, or `tiny`/`base` on constrained hardware; larger weights improve accuracy at the cost of RAM and latency, and displayed sizes exclude Python runtime packages).

`Vosk` offers compact single-language models (Russian 45 MB, English 40 MB, Ukrainian `nano` 73 MB) with no automatic language detection and simpler punctuation on free-form dictation than Whisper.

## Installing a Local Engine

1. Install Python `3.9+` with `venv` and `pip`, and set the executable name (`python3`, `python` on Windows, or an absolute path).
2. Pick an engine (`faster-whisper` or `Vosk`), model size, and device (`CPU` or `CUDA`; CUDA requires an NVIDIA GPU with CUDA 12, cuBLAS, and cuDNN 9 visible to Python; use `CPU` on macOS).
3. Click **Install engine and model** to provision an isolated app virtualenv and download model weights (cancellable; previously downloaded models are reused on retry).
4. Click **Check installation** (verifies Python package + model files on disk; CUDA runtime libraries are verified during actual transcription) and then **Save**.

Network access is used only when installing packages or downloading weights: during dictation, audio stays strictly in local memory and local engine errors surface directly rather than silently falling back to a cloud API. If `pip` lacks prebuilt wheels for your platform or Python version, try Python `3.12` or `3.13`; if CUDA fails to load, install matching CUDA 12 / cuDNN 9 libraries per `faster-whisper` docs or switch to `CPU` (both engines are verified on Linux CPU in CI; CUDA, macOS, and Windows require on-device verification).

## Cache Layout and Cleanup

Runtimes and downloaded weights are shared across workspaces:

- **Linux**: `$XDG_CACHE_HOME/flecten/voice` or `~/.cache/flecten/voice`
- **macOS**: `~/Library/Caches/flecten/voice`
- **Windows**: `%LOCALAPPDATA%/flecten/voice`

Virtualenvs live under `runtimes/<engine>` and weights under `models/<engine>/<model>` (no user audio recordings are ever written here; `FLECTEN_VOICE_HOME` overrides the cache root in tests). Quit Flecten before deleting individual models or the entire `voice` directory; if a `Vosk` install was interrupted mid-extraction, delete only that incomplete `models/vosk/<model>` folder before retrying.

## Live Engine Smoke Tests

Standard test runs never download Python wheels or speech models. With a populated cache containing Whisper `tiny` and Vosk small English, run the end-to-end integration and headless Electron suites against real local engines:

```bash
FLECTEN_VOICE_HOME=/path/to/voice-cache \
FLECTEN_VOICE_SMOKE_AUDIO=/path/to/mono-16khz-pcm16.wav \
bun test tests/integration/local-voice.test.ts
```

Passing the same environment variables to `tests/e2e/local-voice.spec.ts` injects [Vosk's public English `test.wav`](https://github.com/alphacep/vosk-api/blob/master/python/example/test.wav) into the renderer capture path, converts it in-browser, and verifies live Vosk transcription into the composer.

Upstream repositories and licenses: [faster-whisper](https://github.com/SYSTRAN/faster-whisper), [Vosk](https://github.com/alphacep/vosk-api), [Vosk models](https://alphacephei.com/vosk/models), [Whisper models](https://huggingface.co/Systran).
