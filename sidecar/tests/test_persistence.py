"""
Tests for stats persistence (Item 8) and receipt SQL filtering (Item 9).
"""

import os
import tempfile

import yaml
from fastapi.testclient import TestClient

from sanna.constitution import parse_constitution, sign_constitution, constitution_to_dict
from sanna.crypto import generate_keypair


# Minimal test constitution
TEST_DATA = {
    "sanna_constitution": "0.1.0",
    "identity": {
        "agent_name": "persist-test",
        "domain": "testing",
        "description": "Persistence test",
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


def _setup(tmp_path):
    """Create constitution, keypair, and return paths."""
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
    return const_path, str(priv_path), store_path


# ---------------------------------------------------------------------------
# Item 8: Stats survive sidecar restart
# ---------------------------------------------------------------------------


def test_stats_persist_across_restart(tmp_path):
    """Stats survive sidecar restart (start, enforce, stop, start, check)."""
    from sidecar.server import create_app

    const_path, key_path, store_path = _setup(tmp_path)

    # First instance: make some enforce calls
    app1 = create_app(constitution_path=const_path, key_path=key_path, receipt_store_path=store_path)
    with TestClient(app1) as c1:
        c1.post("/enforce", json={"tool": "ls", "args": {}})  # allow
        c1.post("/enforce", json={"tool": "rm", "args": {}})  # halt
        c1.post("/enforce", json={"tool": "curl", "args": {}})  # escalate

        stats1 = c1.get("/status").json()["enforcement_stats"]
        assert stats1["total"] >= 3
        assert stats1["allowed"] >= 1
        assert stats1["halted"] >= 1
        assert stats1["escalated"] >= 1

    # Second instance: stats should be loaded from DB
    app2 = create_app(constitution_path=const_path, key_path=key_path, receipt_store_path=store_path)
    with TestClient(app2) as c2:
        stats2 = c2.get("/status").json()["enforcement_stats"]
        assert stats2["total"] >= 3
        assert stats2["allowed"] >= 1
        assert stats2["halted"] >= 1
        assert stats2["escalated"] >= 1


def test_stats_increment_after_restart(tmp_path):
    """Stats increment correctly after restart, not reset to 0."""
    from sidecar.server import create_app

    const_path, key_path, store_path = _setup(tmp_path)

    # First instance
    app1 = create_app(constitution_path=const_path, key_path=key_path, receipt_store_path=store_path)
    with TestClient(app1) as c1:
        c1.post("/enforce", json={"tool": "ls", "args": {}})
        c1.post("/enforce", json={"tool": "ls", "args": {}})

    # Second instance: make one more call
    app2 = create_app(constitution_path=const_path, key_path=key_path, receipt_store_path=store_path)
    with TestClient(app2) as c2:
        c2.post("/enforce", json={"tool": "ls", "args": {}})
        stats = c2.get("/status").json()["enforcement_stats"]
        assert stats["total"] >= 3
        assert stats["allowed"] >= 3


# ---------------------------------------------------------------------------
# Item 9: Receipt filtering in SQL
# ---------------------------------------------------------------------------


def test_receipts_filter_by_tool(tmp_path):
    """GET /receipts?tool=ls returns only ls receipts."""
    from sidecar.server import create_app

    const_path, key_path, store_path = _setup(tmp_path)

    app = create_app(constitution_path=const_path, key_path=key_path, receipt_store_path=store_path)
    with TestClient(app) as client:
        client.post("/enforce", json={"tool": "ls", "args": {}})
        client.post("/enforce", json={"tool": "rm", "args": {}})
        client.post("/enforce", json={"tool": "ls", "args": {}})

        resp = client.get("/receipts", params={"tool": "ls"})
        assert resp.status_code == 200
        results = resp.json()
        assert len(results) == 2
        assert all(r["tool"] == "ls" for r in results)


def test_receipts_filter_by_verdict(tmp_path):
    """GET /receipts?verdict=allow returns only allowed receipts."""
    from sidecar.server import create_app

    const_path, key_path, store_path = _setup(tmp_path)

    app = create_app(constitution_path=const_path, key_path=key_path, receipt_store_path=store_path)
    with TestClient(app) as client:
        client.post("/enforce", json={"tool": "ls", "args": {}})  # allow
        client.post("/enforce", json={"tool": "rm", "args": {}})  # halt
        client.post("/enforce", json={"tool": "curl", "args": {}})  # escalate

        resp = client.get("/receipts", params={"verdict": "allow"})
        assert resp.status_code == 200
        results = resp.json()
        assert len(results) == 1
        assert results[0]["verdict"] == "allow"
        assert results[0]["tool"] == "ls"


def test_receipts_filter_combined(tmp_path):
    """GET /receipts?tool=ls&verdict=allow filters on both."""
    from sidecar.server import create_app

    const_path, key_path, store_path = _setup(tmp_path)

    app = create_app(constitution_path=const_path, key_path=key_path, receipt_store_path=store_path)
    with TestClient(app) as client:
        client.post("/enforce", json={"tool": "ls", "args": {}})   # allow
        client.post("/enforce", json={"tool": "cat", "args": {}})  # allow
        client.post("/enforce", json={"tool": "rm", "args": {}})   # halt

        resp = client.get("/receipts", params={"tool": "ls", "verdict": "allow"})
        assert resp.status_code == 200
        results = resp.json()
        assert len(results) == 1
        assert results[0]["tool"] == "ls"
        assert results[0]["verdict"] == "allow"
