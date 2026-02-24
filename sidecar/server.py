"""
FastAPI server wrapping the sanna library for governance evaluation.

The /enforce stub defaults to halt verdict — fail-closed principle.
If enforcement isn't wired yet, everything is denied.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class ToolCallContext(BaseModel):
    session_id: str = ""
    agent_id: str = ""
    conversation_turn: int = 0
    timestamp: str = ""


class EnforceRequest(BaseModel):
    tool: str
    args: dict[str, Any] = {}
    context: ToolCallContext = ToolCallContext()


class FailedCheck(BaseModel):
    id: str
    section: str
    description: str
    effect: str


class Receipt(BaseModel):
    receipt_id: str = ""
    tool: str = ""
    args_hash: str = ""
    verdict: str = ""
    timestamp: str = ""
    signature: str = ""
    public_key: str = ""


class EnforceResponse(BaseModel):
    verdict: str  # allow | deny | halt | escalate
    reason: str
    boundary_type: str | None = None
    failed_checks: list[FailedCheck] = []
    receipt: Receipt | None = None


class AuditRequest(BaseModel):
    tool: str
    args: dict[str, Any] = {}
    result: str | None = None
    error: str | None = None
    context: ToolCallContext = ToolCallContext()


class AuditResponse(BaseModel):
    receipt_id: str


class HealthResponse(BaseModel):
    status: str  # ok | degraded | error
    version: str


class StatusResponse(BaseModel):
    constitution: dict[str, Any] = {}
    enforcement_stats: dict[str, Any] = {}


class ExportResponse(BaseModel):
    bundle: dict[str, Any] = {}


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------


def create_app(
    constitution_path: str = "./constitutions",
    key_path: str = "",
    receipt_store_path: str = "",
) -> FastAPI:
    app = FastAPI(title="Sanna Governance Sidecar", version="0.1.0")

    # Store config in app state for endpoint access
    app.state.constitution_path = constitution_path
    app.state.key_path = key_path
    app.state.receipt_store_path = receipt_store_path

    # ---------------------------------------------------------------------------
    # GET /health — liveness probe, no dependencies
    # ---------------------------------------------------------------------------
    @app.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return HealthResponse(status="ok", version="0.0.0-stub")

    # ---------------------------------------------------------------------------
    # POST /enforce — { tool, args, context } → { verdict, reason, ... }
    # Stub defaults to halt verdict (fail-closed).
    # ---------------------------------------------------------------------------
    @app.post("/enforce", response_model=EnforceResponse)
    async def enforce(request: EnforceRequest) -> EnforceResponse:
        return EnforceResponse(
            verdict="halt",
            reason="Enforcement not yet implemented — fail-closed by default",
            boundary_type=None,
            failed_checks=[],
            receipt=None,
        )

    # ---------------------------------------------------------------------------
    # POST /audit — { tool, args, result, error, context } → { receipt_id }
    # ---------------------------------------------------------------------------
    @app.post("/audit", response_model=AuditResponse)
    async def audit(request: AuditRequest) -> AuditResponse:
        return AuditResponse(receipt_id="stub-receipt-id")

    # ---------------------------------------------------------------------------
    # GET /status — constitution summary + enforcement stats
    # ---------------------------------------------------------------------------
    @app.get("/status", response_model=StatusResponse)
    async def status() -> StatusResponse:
        return StatusResponse(
            constitution={"name": None, "loaded": False},
            enforcement_stats={"total": 0, "allowed": 0, "denied": 0, "halted": 0},
        )

    # ---------------------------------------------------------------------------
    # GET /receipts — query with ?tool=&verdict=&limit=
    # ---------------------------------------------------------------------------
    @app.get("/receipts")
    async def list_receipts(
        tool: str | None = None,
        verdict: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        return []

    # ---------------------------------------------------------------------------
    # POST /export — evidence bundle (stub)
    # ---------------------------------------------------------------------------
    @app.post("/export", response_model=ExportResponse)
    async def export_bundle() -> ExportResponse:
        return ExportResponse(bundle={"receipts": [], "constitution": None})

    return app
