"""
Tests for constitution directory resolution (Item 4).
"""

import os
import tempfile

import yaml
from fastapi.testclient import TestClient

from sanna.constitution import parse_constitution, constitution_to_dict
from sidecar.server import _resolve_constitution_dir


# Reuse the minimal valid constitution data from conftest
MINIMAL_CONSTITUTION = {
    "sanna_constitution": "0.1.0",
    "identity": {
        "agent_name": "resolve-test",
        "domain": "testing",
        "description": "Resolution test",
    },
    "provenance": {
        "authored_by": "test",
        "approved_by": ["test"],
        "approval_date": "2024-01-01",
        "approval_method": "test",
    },
    "boundaries": [
        {"id": "B001", "description": "Test", "category": "scope", "severity": "high"}
    ],
    "authority_boundaries": {
        "can_execute": ["ls"],
        "must_escalate": [],
        "cannot_execute": ["rm"],
    },
}


def _write_constitution(dir_path, filename, agent_name="resolve-test"):
    """Write a minimal valid constitution YAML to a file."""
    data = dict(MINIMAL_CONSTITUTION)
    data["identity"] = dict(data["identity"])
    data["identity"]["agent_name"] = agent_name
    path = os.path.join(dir_path, filename)
    with open(path, "w") as f:
        yaml.dump(data, f, default_flow_style=False)
    return path


def test_default_yaml_preferred(tmp_path):
    """default.yaml is loaded even when other yamls exist alphabetically earlier."""
    _write_constitution(tmp_path, "aaa.yaml", agent_name="aaa-agent")
    _write_constitution(tmp_path, "default.yaml", agent_name="default-agent")

    from pathlib import Path

    result = _resolve_constitution_dir(Path(tmp_path))
    assert result is not None
    assert result.name == "default.yaml"


def test_constitution_yaml_second_preference(tmp_path):
    """constitution.yaml is used when no default.yaml exists."""
    _write_constitution(tmp_path, "aaa.yaml", agent_name="aaa-agent")
    _write_constitution(tmp_path, "constitution.yaml", agent_name="const-agent")

    from pathlib import Path

    result = _resolve_constitution_dir(Path(tmp_path))
    assert result is not None
    assert result.name == "constitution.yaml"


def test_alphabetical_fallback_returns_first(tmp_path):
    """Without default/constitution, the first alphabetically is used."""
    _write_constitution(tmp_path, "beta.yaml")
    _write_constitution(tmp_path, "alpha.yaml")

    from pathlib import Path

    result = _resolve_constitution_dir(Path(tmp_path))
    assert result is not None
    assert result.name == "alpha.yaml"


def test_alphabetical_fallback_logs_warning(tmp_path, caplog):
    """Alphabetical fallback produces a warning about naming."""
    _write_constitution(tmp_path, "my-policy.yaml")

    from pathlib import Path
    import logging

    with caplog.at_level(logging.WARNING, logger="sanna.sidecar"):
        result = _resolve_constitution_dir(Path(tmp_path))

    assert result is not None
    assert "No default.yaml found" in caplog.text
    assert "my-policy.yaml" in caplog.text


def test_empty_directory_returns_none(tmp_path):
    """Empty directory returns None (no constitution found)."""
    from pathlib import Path

    result = _resolve_constitution_dir(Path(tmp_path))
    assert result is None


def test_default_yml_variant(tmp_path):
    """default.yml (not .yaml) is also recognized as preferred."""
    _write_constitution(tmp_path, "default.yml", agent_name="yml-agent")
    _write_constitution(tmp_path, "aaa.yaml", agent_name="aaa-agent")

    from pathlib import Path

    result = _resolve_constitution_dir(Path(tmp_path))
    assert result is not None
    assert result.name == "default.yml"
