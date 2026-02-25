"""
Tests for write-ahead receipt persistence.

Every receipt must be written to disk BEFORE the enforce response is returned.
If persistence fails, enforce returns HTTP 500 and the action is blocked.
"""

import json
import os
import stat
import tempfile

import yaml
from fastapi.testclient import TestClient

from sanna.constitution import parse_constitution, sign_constitution, constitution_to_dict
from sanna.crypto import generate_keypair


# Minimal test constitution
TEST_DATA = {
    "sanna_constitution": "0.1.0",
    "identity": {
        "agent_name": "wal-test",
        "domain": "testing",
        "description": "Write-ahead test",
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
        "can_execute": ["ls", "cat"],
        "must_escalate": [{"condition": "curl"}],
        "cannot_execute": ["rm"],
    },
}


def _setup(tmp_path, receipt_dir=None):
    """Create constitution, keypair, receipt dir, and return paths."""
    os.environ["SANNA_ALLOW_TEMP_DB"] = "1"

    key_dir = os.path.join(str(tmp_path), "keys")
    os.makedirs(key_dir, exist_ok=True)
    priv_path, _ = generate_keypair(key_dir, signed_by="test")

    constitution = parse_constitution(TEST_DATA)
    constitution = sign_constitution(constitution, private_key_path=str(priv_path), signed_by="test")
    data = constitution_to_dict(constitution)

    const_path = os.path.join(str(tmp_path), "constitution.yaml")
    with open(const_path, "w") as f:
        yaml.dump(data, f, default_flow_style=False)

    store_path = os.path.join(str(tmp_path), "receipts.db")

    if receipt_dir is None:
        receipt_dir = os.path.join(str(tmp_path), "receipt_store")
        os.makedirs(receipt_dir, exist_ok=True)

    return const_path, str(priv_path), store_path, receipt_dir


# ---------------------------------------------------------------------------
# Receipt file is created on disk after successful enforce
# ---------------------------------------------------------------------------


def test_receipt_file_created_on_enforce(tmp_path):
    """Enforce creates a receipt JSON file in the receipt store directory."""
    const_path, key_path, store_path, receipt_dir = _setup(tmp_path)

    os.environ["SANNA_RECEIPT_STORE"] = receipt_dir
    try:
        from sidecar.server import create_app

        app = create_app(constitution_path=const_path, key_path=key_path, receipt_store_path=store_path)
        with TestClient(app) as client:
            resp = client.post("/enforce", json={"tool": "ls", "args": {}})
            assert resp.status_code == 200
            body = resp.json()
            receipt_id = body["receipt"]["receipt_id"]

            # Check that the file exists
            receipt_file = os.path.join(receipt_dir, f"{receipt_id}.json")
            assert os.path.isfile(receipt_file), f"Receipt file not found: {receipt_file}"
    finally:
        os.environ.pop("SANNA_RECEIPT_STORE", None)


# ---------------------------------------------------------------------------
# Receipt file content matches response
# ---------------------------------------------------------------------------


def test_receipt_file_content_matches_response(tmp_path):
    """The receipt file on disk contains the same data as the response."""
    const_path, key_path, store_path, receipt_dir = _setup(tmp_path)

    os.environ["SANNA_RECEIPT_STORE"] = receipt_dir
    try:
        from sidecar.server import create_app

        app = create_app(constitution_path=const_path, key_path=key_path, receipt_store_path=store_path)
        with TestClient(app) as client:
            resp = client.post("/enforce", json={"tool": "ls", "args": {}})
            assert resp.status_code == 200
            body = resp.json()
            receipt_id = body["receipt"]["receipt_id"]
            response_verdict = body["verdict"]
            response_tool = body["receipt"]["tool"]

            # Read the file
            receipt_file = os.path.join(receipt_dir, f"{receipt_id}.json")
            with open(receipt_file) as f:
                disk_receipt = json.load(f)

            assert disk_receipt["receipt_id"] == receipt_id
            assert disk_receipt["verdict"] == response_verdict
            assert disk_receipt["tool"] == response_tool
            assert disk_receipt["constitution_hash"] == body["receipt"]["constitution_hash"]
    finally:
        os.environ.pop("SANNA_RECEIPT_STORE", None)


# ---------------------------------------------------------------------------
# Enforce returns 500 when receipt directory is not writable
# ---------------------------------------------------------------------------


def test_enforce_returns_500_when_receipt_dir_not_writable(tmp_path):
    """If the receipt store directory is not writable, enforce returns HTTP 500."""
    const_path, key_path, store_path, receipt_dir = _setup(tmp_path)

    # Make the receipt directory read-only
    os.chmod(receipt_dir, stat.S_IRUSR | stat.S_IXUSR)

    os.environ["SANNA_RECEIPT_STORE"] = receipt_dir
    try:
        from sidecar.server import create_app

        app = create_app(constitution_path=const_path, key_path=key_path, receipt_store_path=store_path)
        with TestClient(app) as client:
            resp = client.post("/enforce", json={"tool": "ls", "args": {}})
            assert resp.status_code == 500
            body = resp.json()
            assert body["verdict"] == "error"
            assert "persistence failed" in body["reason"].lower()
    finally:
        # Restore permissions for cleanup
        os.chmod(receipt_dir, stat.S_IRWXU)
        os.environ.pop("SANNA_RECEIPT_STORE", None)


# ---------------------------------------------------------------------------
# Action is blocked (no allow returned) when persistence fails
# ---------------------------------------------------------------------------


def test_no_allow_returned_when_persistence_fails(tmp_path):
    """Even for an allowed tool, if persistence fails, no allow is returned."""
    const_path, key_path, store_path, receipt_dir = _setup(tmp_path)

    # Make the receipt directory read-only so persistence fails
    os.chmod(receipt_dir, stat.S_IRUSR | stat.S_IXUSR)

    os.environ["SANNA_RECEIPT_STORE"] = receipt_dir
    try:
        from sidecar.server import create_app

        app = create_app(constitution_path=const_path, key_path=key_path, receipt_store_path=store_path)
        with TestClient(app) as client:
            # "ls" would normally be allowed, but persistence failure blocks it
            resp = client.post("/enforce", json={"tool": "ls", "args": {}})
            assert resp.status_code == 500
            body = resp.json()
            # The verdict is NOT "allow" — it's "error"
            assert body["verdict"] != "allow"
            assert body["verdict"] == "error"
    finally:
        os.chmod(receipt_dir, stat.S_IRWXU)
        os.environ.pop("SANNA_RECEIPT_STORE", None)


# ---------------------------------------------------------------------------
# /health includes receipt_store path
# ---------------------------------------------------------------------------


def test_health_includes_receipt_store_path(tmp_path):
    """/health response includes the receipt_store directory path."""
    const_path, key_path, store_path, receipt_dir = _setup(tmp_path)

    os.environ["SANNA_RECEIPT_STORE"] = receipt_dir
    try:
        from sidecar.server import create_app

        app = create_app(constitution_path=const_path, key_path=key_path, receipt_store_path=store_path)
        with TestClient(app) as client:
            resp = client.get("/health")
            assert resp.status_code == 200
            body = resp.json()
            assert body["receipt_store"] == receipt_dir
    finally:
        os.environ.pop("SANNA_RECEIPT_STORE", None)
