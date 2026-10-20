"""Turn detection: where speech stops, a new turn begins.

GigaAM is a character-level CTC model with no idea who is speaking. What it
does give us is a flat text stream. These tests pin the energy-based splitter
that turns that stream into readable turns -- the thing that makes a
transcript usable and gives the analysis stage real turn-taking data.
"""

import numpy as np

from gigaam import SAMPLE_RATE, speech_regions


def _tone(seconds, freq=440):
    t = np.linspace(0, seconds, int(SAMPLE_RATE * seconds), endpoint=False)
    return (0.4 * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def _silence(seconds):
    return np.zeros(int(SAMPLE_RATE * seconds), dtype=np.float32)


def test_silence_alone_yields_no_regions():
    """A dead line is not a conversation -- nothing should come back."""
    audio = _silence(3.0)

    assert speech_regions(audio, SAMPLE_RATE) == []


def test_single_continuous_utterance_is_one_region():
    """No internal pause means one turn, not many."""
    audio = _tone(4.0)

    regions = speech_regions(audio, SAMPLE_RATE)

    assert len(regions) == 1


def test_long_pause_splits_two_speakers():
    """The real case: two people, a gap between them, two regions."""
    audio = np.concatenate([_tone(3.0), _silence(1.2), _tone(3.0)])

    regions = speech_regions(audio, SAMPLE_RATE)

    assert len(regions) == 2


def test_short_pause_does_not_split_one_speaker():
    """A breath or a hesitation must not fragment the transcript."""
    audio = np.concatenate([_tone(2.0), _silence(0.15), _tone(2.0)])

    regions = speech_regions(audio, SAMPLE_RATE)

    assert len(regions) == 1


def test_region_bounds_stay_inside_the_audio():
    """Timestamps feed the UI, so they must address real positions."""
    audio = np.concatenate([_tone(2.0), _silence(1.0), _tone(2.0)])
    duration = len(audio) / SAMPLE_RATE

    for start, end in speech_regions(audio, SAMPLE_RATE):
        assert 0.0 <= start < end <= duration + 0.05


def test_three_way_conversation():
    """Three turns in, three turns out."""
    audio = np.concatenate([
        _tone(2.0), _silence(1.0),
        _tone(2.0), _silence(1.0),
        _tone(2.0),
    ])

    assert len(speech_regions(audio, SAMPLE_RATE)) == 3


def test_uniformly_loud_audio_is_not_all_silence():
    """The threshold is adaptive; a quiet recording still has speech."""
    audio = (0.02 * np.sin(
        2 * np.pi * 440 * np.linspace(0, 3.0, int(SAMPLE_RATE * 3.0), endpoint=False)
    )).astype(np.float32)

    regions = speech_regions(audio, SAMPLE_RATE)

    assert len(regions) >= 1


def test_empty_audio_returns_nothing():
    """Zero-length input is legal and must not raise."""
    assert speech_regions(np.array([], dtype=np.float32), SAMPLE_RATE) == []