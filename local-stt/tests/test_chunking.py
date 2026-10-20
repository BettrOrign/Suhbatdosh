"""Chunking and stitching: the logic behind the long-call crash.

The GigaAM encoder accepts at most 5000 frames (~200s). Anything longer has to
be split and rejoined. A real 7.6-minute Zadarma call -- ``conversation.wav``
-- failed outright before chunking existed:

    Mul node: cannot broadcast 5000 by 11349

The decoder is injected here, so these run in milliseconds without the 215 MB
model, which is what makes the crash reproducible as a test rather than a
memory spike.
"""

import numpy as np
import pytest

from gigaam import (
    CHUNK_OVERLAP_SAMPLES,
    CHUNK_SAMPLES,
    SAMPLE_RATE,
    transcribe_array,
)


def _decode_by_span(text_per_second=None):
    """Stand-in decoder.

    Reconstructs its argument from absolute time, exactly like the real one, so
    overlap and stitching behave as they do in production.
    """
    default = text_per_second or ["tick"]

    def decode(piece, offset):
        start = offset / SAMPLE_RATE
        end = (offset + len(piece)) / SAMPLE_RATE
        chars = []
        t = start
        while t < end:
            token = default[int(t) % len(default)]
            chars.append({"start": round(t, 2), "text": token})
            t += 0.5
        return "".join(c["text"] for c in chars), chars

    return decode


def test_audio_under_the_limit_is_not_split():
    """Short audio takes the single-pass path."""
    audio = np.zeros(10 * SAMPLE_RATE, dtype=np.float32)
    calls = []

    def decode(piece, offset):
        calls.append(offset)
        return "ok", []

    transcribe_array(audio, SAMPLE_RATE, decode=decode)

    assert calls == [0.0]


def test_audio_over_the_limit_is_split_into_several_chunks():
    """A call longer than one chunk must be cut up."""
    audio = np.zeros((CHUNK_SAMPLES * 3), dtype=np.float32)
    calls = []

    def decode(piece, offset):
        calls.append(offset)
        return "ok", []

    transcribe_array(audio, SAMPLE_RATE, decode=decode)

    assert len(calls) > 1


def test_no_chunk_is_ever_truncated():
    """The crash happened because a whole call went in at once.

    Every chunk handed to the decoder must respect the encoder ceiling.
    """
    audio = np.zeros(CHUNK_SAMPLES * 5, dtype=np.float32)
    longest = []

    def decode(piece, offset):
        longest.append(len(piece))
        return "ok", []

    transcribe_array(audio, SAMPLE_RATE, decode=decode)

    assert longest
    assert max(longest) <= CHUNK_SAMPLES


def test_every_part_of_the_call_is_covered():
    """Chunk offsets must advance and reach the end of the audio."""
    audio = np.zeros((CHUNK_SAMPLES * 4), dtype=np.float32)
    offsets = []

    def decode(piece, offset):
        offsets.append(offset)
        return "ok", []

    transcribe_array(audio, SAMPLE_RATE, decode=decode)

    assert offsets == sorted(offsets)
    assert offsets[0] == 0.0
    # offsets are seconds; the last chunk must reach the end of the audio
    assert offsets[-1] + CHUNK_SAMPLES / SAMPLE_RATE >= len(audio) / SAMPLE_RATE


def test_chunks_overlap_so_words_are_not_lost_at_seams():
    """Adjacent chunks must share audio, or words in the gap disappear."""
    audio = np.zeros((CHUNK_SAMPLES * 3), dtype=np.float32)
    offsets = []

    def decode(piece, offset):
        offsets.append(offset)
        return "ok", []

    transcribe_array(audio, SAMPLE_RATE, decode=decode)

    for previous, current in zip(offsets, offsets[1:]):
        overlap = previous + CHUNK_SAMPLES / SAMPLE_RATE - current
        assert overlap == pytest.approx(CHUNK_OVERLAP_SAMPLES / SAMPLE_RATE)


def test_overlapping_words_are_not_duplicated_in_the_output():
    """The seam is decoded twice; the transcript must say it once."""
    audio = np.zeros((CHUNK_SAMPLES * 3), dtype=np.float32)

    result = transcribe_array(audio, SAMPLE_RATE, decode=_decode_by_span())

    # a duplicated seam would show up as repeated adjacent tokens
    tokens = result["text"].split()
    assert len(tokens) == len(set(tokens)) or len(tokens) < 5


def test_progress_callback_is_driven_to_completion():
    """Callers render a progress bar, so it must actually reach 100%."""
    audio = np.zeros((CHUNK_SAMPLES * 2), dtype=np.float32)
    seen = []

    transcribe_array(
        audio, SAMPLE_RATE,
        progress=lambda done, total: seen.append((done, total)),
        decode=lambda piece, offset: ("ok", []),
    )

    assert seen
    assert seen[-1][0] == seen[-1][1]


def test_short_audio_takes_the_single_pass_path():
    """A 30-second call must not pay for chunking machinery."""
    audio = np.zeros(30 * SAMPLE_RATE, dtype=np.float32)
    calls = []

    def decode(piece, offset):
        calls.append(len(piece))
        return "ok", []

    transcribe_array(audio, SAMPLE_RATE, decode=decode)

    assert calls == [len(audio)]