"""
Shared fixtures for sidecar tests.

- Test constitution with 3 authority boundaries:
    can_execute: ["ls", "cat"]
    must_escalate: [{"condition": "curl"}]
    cannot_execute: ["rm"]
- Ephemeral Ed25519 signing keypair
- FastAPI TestClient with test constitution loaded
"""

import os
import shutil
import tempfile

import pytest
import yaml
from fastapi.testclient import TestClient

from sanna.constitution import parse_constitution, sign_constitution
from sanna.crypto import generate_keypair


TEST_CONSTITUTION_DATA = {
    "sanna_constitution": "0.1.0",
    "identity": {
        "agent_name": "test-agent",
        "domain": "testing",
        "description": "Test constitution for sidecar tests",
    },
    "provenance": {
        "authored_by": "test-suite",
        "approved_by": ["test-approver"],
        "approval_date": "2024-01-01",
        "approval_method": "automated-test",
    },
    "boundaries": [
        {
            "id": "B001",
            "description": "Test boundary",
            "category": "scope",
            "severity": "high",
        }
    ],
    "authority_boundaries": {
        "can_execute": ["ls", "cat"],
        "must_escalate": [{"condition": "curl"}],
        "cannot_execute": ["rm"],
    },
}


@pytest.fixture(scope="session")
def tmp_dir():
    """Session-scoped temp directory, cleaned up after all tests."""
    d = tempfile.mkdtemp(prefix="sanna-test-")
    yield d
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture(scope="session")
def keypair(tmp_dir):
    """Generate an ephemeral Ed25519 keypair for testing."""
    key_dir = os.path.join(tmp_dir, "keys")
    os.makedirs(key_dir, exist_ok=True)
    priv_path, pub_path = generate_keypair(key_dir, signed_by="test-signer")
    return str(priv_path), str(pub_path)


@pytest.fixture(scope="session")
def constitution_path(tmp_dir, keypair):
    """Write and sign a test constitution YAML file."""
    priv_path, _ = keypair
    const_dir = os.path.join(tmp_dir, "constitutions")
    os.makedirs(const_dir, exist_ok=True)

    # Parse, sign, then write as YAML
    constitution = parse_constitution(TEST_CONSTITUTION_DATA)
    constitution = sign_constitution(
        constitution, private_key_path=priv_path, signed_by="test-signer"
    )

    # Write the raw data (with policy_hash set by signing) as YAML
    from sanna.constitution import constitution_to_dict

    data = constitution_to_dict(constitution)
    yaml_path = os.path.join(const_dir, "test-constitution.yaml")
    with open(yaml_path, "w") as f:
        yaml.dump(data, f, default_flow_style=False)

    return yaml_path


@pytest.fixture(scope="session")
def receipt_store_path(tmp_dir):
    """Path for a test receipt store."""
    os.environ["SANNA_ALLOW_TEMP_DB"] = "1"
    return os.path.join(tmp_dir, "test-receipts.db")


@pytest.fixture()
def client(constitution_path, keypair, receipt_store_path):
    """FastAPI TestClient with a real constitution and signing key loaded."""
    from sidecar.server import create_app

    priv_path, _ = keypair
    app = create_app(
        constitution_path=constitution_path,
        key_path=priv_path,
        receipt_store_path=receipt_store_path,
    )
    with TestClient(app) as tc:
        yield tc


@pytest.fixture()
def client_no_constitution(tmp_dir):
    """FastAPI TestClient with NO constitution loaded."""
    from sidecar.server import create_app

    empty_dir = os.path.join(tmp_dir, "empty-constitutions")
    os.makedirs(empty_dir, exist_ok=True)
    app = create_app(constitution_path=empty_dir, key_path="", receipt_store_path="")
    with TestClient(app) as tc:
        yield tc


@pytest.fixture()
def client_no_key(constitution_path, receipt_store_path):
    """FastAPI TestClient with constitution but NO signing key."""
    from sidecar.server import create_app

    app = create_app(
        constitution_path=constitution_path,
        key_path="",
        receipt_store_path=receipt_store_path,
    )
    with TestClient(app) as tc:
        yield tc
