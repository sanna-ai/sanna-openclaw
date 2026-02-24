"""
FastAPI server wrapping the sanna library for governance evaluation.

Fail-closed: /enforce returns halt when no constitution is loaded or on any error.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel

logger = logging.getLogger("sanna.sidecar")

# Guard sanna imports — installation may be incomplete
try:
    import sanna
    from sanna.constitution import (
        Constitution,
        compute_constitution_hash,
        load_constitution,
    )
    from sanna.crypto import sign_receipt
    from sanna.enforcement.authority import evaluate_authority
    from sanna.hashing import hash_obj
    from sanna.store import ReceiptStore

    SANNA_AVAILABLE = True
    SANNA_VERSION = sanna.__version__
except ImportError as exc:
    logger.warning("sanna library not available: %s", exc)
    SANNA_AVAILABLE = False
    SANNA_VERSION = "unavailable"


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


class ReceiptSummary(BaseModel):
    receipt_id: str = ""
    tool: str = ""
    args_hash: str = ""
    verdict: str = ""
    boundary_type: str = ""
    timestamp: str = ""
    constitution_hash: str = ""
    signature: str = ""
    key_id: str = ""
    signed: bool = False


class EnforceResponse(BaseModel):
    verdict: str  # allow | deny | halt | escalate
    reason: str
    boundary_type: str | None = None
    failed_checks: list[FailedCheck] = []
    receipt: ReceiptSummary | None = None


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
    # Store reference captured by lifespan and endpoints via closure
    _store_holder: list[ReceiptStore | None] = [None]

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        yield
        if _store_holder[0] is not None:
            _store_holder[0].close()

    app = FastAPI(title="Sanna Governance Sidecar", version="0.1.0", lifespan=lifespan)

    # -----------------------------------------------------------------------
    # State initialisation
    # -----------------------------------------------------------------------
    constitution: Constitution | None = None
    constitution_hash: str = ""
    constitution_meta: dict[str, Any] = {"name": None, "loaded": False}
    signing_key_path: str = key_path
    store: ReceiptStore | None = None
    stats: dict[str, int] = {"total": 0, "allowed": 0, "halted": 0, "escalated": 0}

    # 1. Load constitution
    if SANNA_AVAILABLE and constitution_path:
        try:
            path = Path(constitution_path)
            resolved: Path | None = None

            if path.is_file():
                resolved = path
            elif path.is_dir():
                yamls = sorted(path.glob("*.yaml")) + sorted(path.glob("*.yml"))
                if yamls:
                    resolved = yamls[0]

            if resolved is not None:
                constitution = load_constitution(str(resolved))
                constitution_hash = compute_constitution_hash(constitution)
                constitution_meta = {
                    "name": constitution.identity.agent_name,
                    "version": constitution.version,
                    "hash": constitution_hash,
                    "path": str(resolved),
                    "loaded": True,
                    "boundary_counts": _count_boundaries(constitution),
                }
                logger.info(
                    "Constitution loaded: %s (hash=%s)",
                    constitution.identity.agent_name,
                    constitution_hash[:16],
                )
            else:
                logger.warning("No constitution YAML found at %s", constitution_path)
        except Exception:
            logger.exception("Failed to load constitution from %s", constitution_path)

    # 2. Validate signing key path (actual loading happens in sign_receipt)
    if signing_key_path and not Path(signing_key_path).is_file():
        logger.warning("Signing key not found at %s — receipts will be unsigned", signing_key_path)
        signing_key_path = ""

    # 3. Initialise receipt store
    if SANNA_AVAILABLE:
        try:
            if receipt_store_path:
                store = ReceiptStore(receipt_store_path)
            else:
                # Dev mode: use a path under ~/.sanna/
                dev_path = str(Path.home() / ".sanna" / "openclaw-dev-receipts.db")
                store = ReceiptStore(dev_path)
            _store_holder[0] = store
            logger.info("Receipt store ready")
        except Exception:
            logger.exception("Failed to initialise receipt store")

    # -----------------------------------------------------------------------
    # Helpers
    # -----------------------------------------------------------------------

    def _build_receipt(
        tool: str,
        args: dict[str, Any],
        verdict: str,
        reason: str,
        boundary_type: str,
        context: dict[str, Any],
    ) -> dict[str, Any]:
        """Build an enforcement receipt dict."""
        now = datetime.now(timezone.utc).isoformat()
        return {
            "receipt_id": str(uuid.uuid4()),
            "spec_version": "openclaw-enforce/0.1.0",
            "tool_version": SANNA_VERSION,
            "timestamp": now,
            "tool": tool,
            "args_hash": hash_obj(args) if SANNA_AVAILABLE else "",
            "verdict": verdict,
            "reason": reason,
            "boundary_type": boundary_type,
            "context": context,
            "constitution_hash": constitution_hash,
            "status": "PASS" if verdict == "allow" else "FAIL",
        }

    def _sign_and_store(receipt: dict[str, Any]) -> dict[str, Any]:
        """Sign a receipt (if key loaded) and store it."""
        if signing_key_path:
            try:
                receipt = sign_receipt(receipt, signing_key_path, signed_by="sanna-openclaw")
            except Exception:
                logger.exception("Failed to sign receipt %s", receipt.get("receipt_id"))
                receipt["_unsigned_warning"] = "signing failed"
        else:
            receipt["_unsigned_warning"] = "no signing key configured"

        if store is not None:
            try:
                store.save(receipt)
            except Exception:
                logger.exception("Failed to store receipt %s", receipt.get("receipt_id"))

        return receipt

    def _receipt_to_summary(receipt: dict[str, Any]) -> ReceiptSummary:
        """Convert a full receipt dict to a response summary."""
        sig_block = receipt.get("receipt_signature", {})
        return ReceiptSummary(
            receipt_id=receipt.get("receipt_id", ""),
            tool=receipt.get("tool", ""),
            args_hash=receipt.get("args_hash", ""),
            verdict=receipt.get("verdict", ""),
            boundary_type=receipt.get("boundary_type", ""),
            timestamp=receipt.get("timestamp", ""),
            constitution_hash=receipt.get("constitution_hash", ""),
            signature=sig_block.get("signature", ""),
            key_id=sig_block.get("key_id", ""),
            signed=bool(sig_block.get("signature")),
        )

    # -----------------------------------------------------------------------
    # GET /health — liveness probe, no dependencies
    # -----------------------------------------------------------------------
    @app.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        status = "ok" if SANNA_AVAILABLE else "degraded"
        return HealthResponse(status=status, version=SANNA_VERSION)

    # -----------------------------------------------------------------------
    # POST /enforce — evaluate authority boundaries, generate signed receipt
    # -----------------------------------------------------------------------
    @app.post("/enforce", response_model=EnforceResponse)
    async def enforce(request: EnforceRequest) -> EnforceResponse:
        stats["total"] += 1

        # Fail-closed: no sanna library
        if not SANNA_AVAILABLE:
            stats["halted"] += 1
            return EnforceResponse(
                verdict="halt",
                reason="sanna library not available — fail-closed",
            )

        # Fail-closed: no constitution loaded
        if constitution is None:
            stats["halted"] += 1
            return EnforceResponse(
                verdict="halt",
                reason="No constitution loaded — fail-closed",
            )

        # Evaluate authority boundaries
        try:
            decision = evaluate_authority(request.tool, request.args, constitution)
        except Exception as exc:
            stats["halted"] += 1
            logger.exception("Authority evaluation error for %s", request.tool)
            return EnforceResponse(
                verdict="halt",
                reason=f"Authority evaluation error — fail-closed: {exc}",
            )

        # Map sanna decision to our verdict
        verdict = decision.decision  # "allow" | "halt" | "escalate"

        # Build and sign receipt
        context_dict = request.context.model_dump()
        receipt = _build_receipt(
            tool=request.tool,
            args=request.args,
            verdict=verdict,
            reason=decision.reason,
            boundary_type=decision.boundary_type,
            context=context_dict,
        )
        receipt = _sign_and_store(receipt)

        # Build failed_checks for non-allow verdicts
        failed_checks: list[FailedCheck] = []
        if verdict != "allow":
            failed_checks.append(
                FailedCheck(
                    id=f"authority:{decision.boundary_type}",
                    section="authority_boundaries",
                    description=decision.reason,
                    effect=verdict,
                )
            )

        # Update stats
        if verdict == "allow":
            stats["allowed"] += 1
        elif verdict == "escalate":
            stats["escalated"] += 1
        else:
            stats["halted"] += 1

        return EnforceResponse(
            verdict=verdict,
            reason=decision.reason,
            boundary_type=decision.boundary_type,
            failed_checks=failed_checks,
            receipt=_receipt_to_summary(receipt),
        )

    # -----------------------------------------------------------------------
    # POST /audit — post-execution audit receipt
    # -----------------------------------------------------------------------
    @app.post("/audit", response_model=AuditResponse)
    async def audit(request: AuditRequest) -> AuditResponse:
        if not SANNA_AVAILABLE:
            return AuditResponse(receipt_id="unavailable")

        context_dict = request.context.model_dump()
        receipt = _build_receipt(
            tool=request.tool,
            args=request.args,
            verdict="audit",
            reason=f"Post-execution audit: result={'ok' if request.error is None else 'error'}",
            boundary_type="audit",
            context=context_dict,
        )
        # Include execution outcome in receipt
        receipt["execution_result"] = request.result
        receipt["execution_error"] = request.error

        receipt = _sign_and_store(receipt)
        return AuditResponse(receipt_id=receipt["receipt_id"])

    # -----------------------------------------------------------------------
    # GET /status — constitution summary + enforcement stats
    # -----------------------------------------------------------------------
    @app.get("/status", response_model=StatusResponse)
    async def status() -> StatusResponse:
        return StatusResponse(
            constitution=constitution_meta,
            enforcement_stats=dict(stats),
        )

    # -----------------------------------------------------------------------
    # GET /receipts — query with ?tool=&verdict=&limit=
    # -----------------------------------------------------------------------
    @app.get("/receipts")
    async def list_receipts(
        tool: str | None = None,
        verdict: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        if store is None:
            return []

        try:
            results = store.query(limit=limit)
        except Exception:
            logger.exception("Receipt query failed")
            return []

        # Apply tool/verdict filters (ReceiptStore doesn't have these columns)
        if tool is not None:
            results = [r for r in results if r.get("tool") == tool]
        if verdict is not None:
            results = [r for r in results if r.get("verdict") == verdict]

        # Return summaries
        return [
            {
                "receipt_id": r.get("receipt_id", ""),
                "tool": r.get("tool", ""),
                "args_hash": r.get("args_hash", ""),
                "verdict": r.get("verdict", ""),
                "boundary_type": r.get("boundary_type", ""),
                "timestamp": r.get("timestamp", ""),
                "constitution_hash": r.get("constitution_hash", ""),
                "signed": bool(r.get("receipt_signature", {}).get("signature")),
            }
            for r in results
        ]

    # -----------------------------------------------------------------------
    # POST /export — evidence bundle
    # -----------------------------------------------------------------------
    @app.post("/export", response_model=ExportResponse)
    async def export_bundle() -> ExportResponse:
        receipts: list[dict[str, Any]] = []
        if store is not None:
            try:
                receipts = store.query()
            except Exception:
                logger.exception("Export query failed")

        return ExportResponse(
            bundle={
                "exported_at": datetime.now(timezone.utc).isoformat(),
                "constitution": constitution_meta,
                "receipt_count": len(receipts),
                "receipts": receipts,
            }
        )

    return app


def _count_boundaries(constitution: Constitution) -> dict[str, int]:
    """Count authority boundaries in a constitution."""
    ab = constitution.authority_boundaries
    if ab is None:
        return {"can_execute": 0, "must_escalate": 0, "cannot_execute": 0}
    return {
        "can_execute": len(ab.can_execute),
        "must_escalate": len(ab.must_escalate),
        "cannot_execute": len(ab.cannot_execute),
    }
