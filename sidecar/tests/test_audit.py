"""
Tests for POST /audit endpoint.
"""


def test_audit_generates_receipt(client):
    """POST /audit returns a receipt_id."""
    resp = client.post(
        "/audit",
        json={
            "tool": "ls",
            "args": {"path": "/tmp"},
            "result": "file1.txt\nfile2.txt",
            "error": None,
            "context": {"session_id": "test-session", "agent_id": "test-agent"},
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["receipt_id"]
    assert body["receipt_id"] != "unavailable"


def test_audit_stores_receipt(client):
    """Audit receipt is queryable via GET /receipts."""
    # Generate an audit receipt
    audit_resp = client.post(
        "/audit",
        json={
            "tool": "cat",
            "args": {"file": "readme.md"},
            "result": "file contents here",
            "error": None,
            "context": {"session_id": "audit-test"},
        },
    )
    receipt_id = audit_resp.json()["receipt_id"]

    # Query receipts and find it
    receipts_resp = client.get("/receipts")
    assert receipts_resp.status_code == 200
    receipts = receipts_resp.json()

    found = [r for r in receipts if r.get("receipt_id") == receipt_id]
    assert len(found) == 1
    assert found[0]["tool"] == "cat"
    assert found[0]["verdict"] == "audit"
