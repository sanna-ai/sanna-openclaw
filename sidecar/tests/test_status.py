"""
Tests for GET /status and GET /health endpoints.
"""


def test_status_constitution_summary(client):
    """GET /status returns constitution name, hash, and boundary counts."""
    resp = client.get("/status")
    assert resp.status_code == 200
    body = resp.json()

    constitution = body["constitution"]
    assert constitution["loaded"] is True
    assert constitution["name"] == "test-agent"
    assert constitution["hash"]
    assert len(constitution["hash"]) == 64  # Full SHA-256 hex
    assert constitution["boundary_counts"]["can_execute"] == 2
    assert constitution["boundary_counts"]["must_escalate"] == 1
    assert constitution["boundary_counts"]["cannot_execute"] == 1


def test_status_enforcement_stats(client):
    """Stats increment after enforce calls."""
    # Get initial stats
    initial = client.get("/status").json()["enforcement_stats"]
    initial_total = initial["total"]

    # Make some enforce calls
    client.post("/enforce", json={"tool": "ls", "args": {}})  # allow
    client.post("/enforce", json={"tool": "rm", "args": {}})  # halt
    client.post("/enforce", json={"tool": "curl", "args": {}})  # escalate

    # Check stats incremented
    after = client.get("/status").json()["enforcement_stats"]
    assert after["total"] == initial_total + 3
    assert after["allowed"] >= 1
    assert after["halted"] >= 1
    assert after["escalated"] >= 1


def test_health_no_deps(client_no_constitution):
    """GET /health responds 200 even without a constitution loaded."""
    resp = client_no_constitution.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["version"]
    assert body["version"] != "unavailable"
