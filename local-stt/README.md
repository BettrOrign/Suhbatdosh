# Local Offline STT — GigaAM 220M

Self-contained, fully offline speech-to-text for **Uzbek, Russian, English, Kazakh and Kyrgyz**.

No API keys, no internet, CPU only. Copy this folder anywhere and it works.

## Install

```bash
pip install -r requirements.txt      # sherpa-onnx, soundfile, numpy
```

Also needs **ffmpeg** on the system for compressed formats (ogg/mp3/m4a/mp4):

```bash
# Ubuntu/Debian
sudo apt install ffmpeg
# macOS
brew install ffmpeg
```

## Use it

**As a CLI**

```bash
python stt.py recording.ogg
python stt.py call1.wav call2.mp3 --json
```

**As an HTTP server**

```bash
./run.sh                    # http://127.0.0.1:8099
./run.sh --port 9000
./run.sh --host 0.0.0.0     # expose on the LAN
```

### Endpoints

```
GET  /health      -> {"status":"ok","offline":true,...}

POST /transcribe  -> raw audio body, or multipart/form-data
                    returns {"text":"...", "duration_sec":..., "rtf":...}
```

```bash
# raw body
curl -X POST --data-binary @call.ogg http://127.0.0.1:8099/transcribe

# multipart
curl -X POST -F "file=@call.ogg" http://127.0.0.1:8099/transcribe
```

### From Python

```python
import requests

with open("call.ogg", "rb") as f:
    r = requests.post("http://127.0.0.1:8099/transcribe", files={"file": f})

print(r.json()["text"])
```

## Measured accuracy

Scored on 12 FLEURS clips (6 Uzbek, 6 Russian), word error rate:

| Model | Size | Uzbek WER | Russian WER | Speed |
|---|---|---|---|---|
| **GigaAM 220M (this one)** | 215 MB | **15.9%** | **10.9%** | 0.08x realtime |
| GigaAM 600M | 591 MB | 15.3% | 9.3% | 0.15x realtime |
| Whisper large-v3 | 3.1 GB | 101% | 6.0% | 4.75x realtime |

The 600M variant is only marginally better, so the 220M is shipped by default — 1/3 the size for ~0.6 WER.

For comparison, **Whisper large-v3 cannot transcribe Uzbek at all** — it detects the language as
Azerbaijani or Kazakh and outputs nonsense. Don't use Whisper for Uzbek.

## Known limitations

- **Output is lowercase with no punctuation.** It is a CTC model with a 71-character
  lowercase vocabulary. Fine as input to an LLM; not suitable for user-facing display
  without a punctuation/capitalisation model.
- **Not streaming.** Full-utterance model — it needs the whole recording before it can
  transcribe.
- **No speaker diarization.** Returns one flat text stream, no speaker labels.
- Numbers are written out as words ("bir million to'rt yuz" not "1400000").

## Files

```
model/model.int8.onnx   215 MB, int8 quantized weights
model/tokens.txt        character vocabulary
gigaam.py               core: load + transcribe
server.py               HTTP server
stt.py                  CLI
```

## License

Model weights: MIT — see `model/LICENSE`.
Base model: [ai-sage/GigaAM-Multilingual](https://huggingface.co/ai-sage/GigaAM-Multilingual)
(SaluteDevices/Sber, Apache-2.0). ONNX conversion for sherpa-onnx:
[fussraider/GigaAM-Multilingual-sherpa-onnx-ctc](https://huggingface.co/fussraider/GigaAM-Multilingual-sherpa-onnx-ctc).
Training data attribution (USC corpus, CC-BY-4.0) is documented on the base model card.