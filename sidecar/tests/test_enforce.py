"""
Tests for POST /enforce endpoint.
"""

from sanna.crypto import verify_receipt_signature


def test_enforce_can_execute(client):
    """Tool in can_execute list returns verdict=allow."""
    resp = client.post("/enforce", json={"tool": "ls", "args": {"path": "/tmp"}})
    assert resp.status_code == 200
    body = resp.json()
    assert body["verdict"] == "allow"
    assert body["boundary_type"] == "can_execute"


def test_enforce_cannot_execute(client):
    """Tool in cannot_execute list returns verdict=halt."""
    resp = client.post("/enforce", json={"tool": "rm", "args": {"path": "/important"}})
    assert resp.status_code == 200
    body = resp.json()
    assert body["verdict"] == "halt"
    assert body["boundary_type"] == "cannot_execute"


def test_enforce_must_escalate(client):
    """Tool matching must_escalate condition returns verdict=escalate."""
    resp = client.post("/enforce", json={"tool": "curl", "args": {"url": "http://example.com"}})
    assert resp.status_code == 200
    body = resp.json()
    assert body["verdict"] == "escalate"
    assert body["boundary_type"] == "must_escalate"


def test_enforce_receipt_present(client):
    """Enforce response includes a receipt with id, signature, and constitution_hash."""
    resp = client.post("/enforce", json={"tool": "ls", "args": {}})
    assert resp.status_code == 200
    body = resp.json()
    receipt = body["receipt"]
    assert receipt is not None
    assert receipt["receipt_id"]
    assert receipt["constitution_hash"]
    assert receipt["timestamp"]


def test_enforce_receipt_signed(client, keypair):
    """Receipt is signed with a valid Ed25519 signature."""
    _, pub_path = keypair
    resp = client.post("/enforce", json={"tool": "ls", "args": {}})
    body = resp.json()
    receipt = body["receipt"]

    assert receipt["signed"] is True
    assert receipt["signature"]
    assert receipt["key_id"]


def test_enforce_receipt_signature_verifies(client, keypair, receipt_store_path):
    """Full receipt in the store has a verifiable Ed25519 signature."""
    _, pub_path = keypair
    # Enforce to generate a receipt
    resp = client.post("/enforce", json={"tool": "cat", "args": {"file": "test.txt"}})
    receipt_id = resp.json()["receipt"]["receipt_id"]

    # Query the store for the full receipt
    from sanna.store import ReceiptStore

    store = ReceiptStore(receipt_store_path)
    results = store.query(limit=100)
    store.close()

    full_receipt = next((r for r in results if r.get("receipt_id") == receipt_id), None)
    assert full_receipt is not None
    assert "receipt_signature" in full_receipt

    valid = verify_receipt_signature(full_receipt, pub_path)
    assert valid is True


def test_enforce_no_constitution(client_no_constitution):
    """Sidecar without constitution returns halt with clear message."""
    resp = client_no_constitution.post("/enforce", json={"tool": "ls", "args": {}})
    assert resp.status_code == 200
    body = resp.json()
    assert body["verdict"] == "halt"
    assert "no constitution" in body["reason"].lower()


def test_enforce_no_key(client_no_key):
    """Sidecar without signing key returns receipt with unsigned warning."""
    resp = client_no_key.post("/enforce", json={"tool": "ls", "args": {}})
    assert resp.status_code == 200
    body = resp.json()
    assert body["verdict"] == "allow"
    receipt = body["receipt"]
    assert receipt is not None
    assert receipt["signed"] is False
    assert receipt["signature"] == ""
