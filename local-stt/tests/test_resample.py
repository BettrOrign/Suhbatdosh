"""Regression: narrowband phone audio must be resampled before decoding.

A real Zadarma call arrived as an 8 kHz mono WAV. ``to_16k_mono`` used to
short-circuit WAV files and hand back the file's native rate, so the 16 kHz
encoder was fed 8 kHz audio and died on its positional-embedding lookup:
``cannot broadcast 5000 by 11349``.
"""

import numpy as np
import soundfile as sf

from gigaam import SAMPLE_RATE, to_16k_mono


def _write_wav(tmp_path, sample_rate, seconds=1.0):
    t = np.linspace(0, seconds, int(sample_rate * seconds), endpoint=False)
    tone = (0.4 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
    sf.write(tmp_path, tone, sample_rate)
    return tmp_path


def test_narrowband_wav_is_resampled_to_16k(tmp_path):
    """An 8 kHz phone recording comes back at 16 kHz, matching the encoder."""
    path = _write_wav(tmp_path / "call.wav", 8000)

    audio, sr = to_16k_mono(path)

    assert sr == SAMPLE_RATE
    assert sr == 16000


def test_stereo_is_downmixed_to_mono(tmp_path):
    """Zadarma can deliver two channels; the encoder expects one."""
    left = np.full(8000, 0.25, dtype=np.float32)
    right = np.full(8000, -0.25, dtype=np.float32)
    stereo = np.stack([left, right], axis=1)
    path = tmp_path / "stereo.wav"
    sf.write(path, stereo, SAMPLE_RATE)

    audio, sr = to_16k_mono(path)

    assert sr == SAMPLE_RATE
    assert audio.ndim == 1


def test_sample_count_matches_resampled_duration(tmp_path):
    """Resampling changes length proportionally, not by a fixed guess."""
    path = _write_wav(tmp_path / "two_seconds.wav", 8000, seconds=2.0)

    audio, sr = to_16k_mono(path)

    # 2s of audio stays 2s; an off-by-one chunk count would show up here.
    assert abs(len(audio) / sr - 2.0) < 0.01


def test_missing_file_raises_runtime_error(tmp_path):
    """A bad path surfaces as RuntimeError, not a bare subprocess error."""
    import pytest

    with pytest.raises(RuntimeError):
        to_16k_mono(tmp_path / "does_not_exist.wav")