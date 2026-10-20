"""Private-mode availability must fail loudly, not silently.

Review found this exact failure: point ``LOCAL_STT_MODEL_DIR`` at any real
weights directory and ``status()`` reported "implementation missing", so every
private call quietly fell back to Gemini. Nothing in the UI said so. The mode
was switched on, the badge read "private", and the audio still left the
building.
"""

from pathlib import Path

import pytest

from app import config, local_stt


@pytest.fixture(autouse=True)
def _reset_module_cache():
    """local_stt caches the loaded implementation process-wide.

    status() short-circuits on that cache, so each test needs a clean slate or
    it reads a module loaded by whichever test ran before it.
    """
    local_stt._module = None
    local_stt._unavailable_reason = None
    yield
    local_stt._module = None
    local_stt._unavailable_reason = None


def _make_weights(root: Path) -> Path:
    model_dir = root / "local-stt" / "model"
    model_dir.mkdir(parents=True)
    (model_dir / "model.int8.onnx").write_bytes(b"fake weights")
    (model_dir / "tokens.txt").write_text("a 1\n")
    return model_dir


def _make_implementation(root: Path) -> Path:
    source = Path(__file__).resolve().parents[2] / "local-stt" / "gigaam.py"
    target = root / "gigaam.py"
    target.write_text(source.read_text())
    return target


def test_available_when_weights_and_implementation_both_present(tmp_path, monkeypatch):
    impl = _make_implementation(tmp_path)
    model_dir = _make_weights(tmp_path)
    monkeypatch.setattr(config, "LOCAL_STT_IMPL_PATH", impl)
    monkeypatch.setattr(config, "LOCAL_STT_MODEL_DIR", model_dir)

    st = local_stt.status()

    assert st["available"] is True


def test_unavailable_when_weights_missing(tmp_path, monkeypatch):
    impl = _make_implementation(tmp_path)
    monkeypatch.setattr(config, "LOCAL_STT_IMPL_PATH", impl)
    monkeypatch.setattr(config, "LOCAL_STT_MODEL_DIR", tmp_path / "absent")

    st = local_stt.status()

    assert st["available"] is False
    assert "model missing" in local_stt.unavailable_reason()


def test_unavailable_when_tokens_missing(tmp_path, monkeypatch):
    """A half-copied model directory is worse than none -- it looks present."""
    impl = _make_implementation(tmp_path)
    model_dir = tmp_path / "local-stt" / "model"
    model_dir.mkdir(parents=True)
    (model_dir / "model.int8.onnx").write_bytes(b"fake weights")
    monkeypatch.setattr(config, "LOCAL_STT_IMPL_PATH", impl)
    monkeypatch.setattr(config, "LOCAL_STT_MODEL_DIR", model_dir)

    assert local_stt.status()["available"] is False


def test_model_dir_outside_the_repo_still_resolves_the_implementation(
    tmp_path, monkeypatch
):
    """Regression: the impl was derived as model_dir.parent/'gigaam.py'.

    Any deployment pointing LOCAL_STT_MODEL_DIR at its own weights directory
    lost private mode entirely, with only a fallback log line to show for it.
    """
    impl = _make_implementation(tmp_path)
    monkeypatch.setattr(config, "LOCAL_STT_IMPL_PATH", impl)
    weights = tmp_path / "elsewhere" / "weights"
    weights.mkdir(parents=True)
    (weights / "model.int8.onnx").write_bytes(b"fake weights")
    (weights / "tokens.txt").write_text("a 1\n")
    monkeypatch.setattr(config, "LOCAL_STT_MODEL_DIR", weights)

    st = local_stt.status()

    assert st["available"] is True, local_stt.unavailable_reason()


def test_status_never_raises_on_a_broken_tree(tmp_path, monkeypatch):
    """The settings endpoint calls this on every page load."""
    monkeypatch.setattr(config, "LOCAL_STT_MODEL_DIR", tmp_path / "nothing-here")

    st = local_stt.status()

    assert st["provider"] == "local"
    assert st["available"] is False
    assert isinstance(local_stt.unavailable_reason(), str)