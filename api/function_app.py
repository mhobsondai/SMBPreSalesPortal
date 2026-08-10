"""SMB Pre-Sales Portal — Functions API.

Endpoints:

  GET  /api/health                     — liveness + version
  GET  /api/me                         — the calling user's identity
  POST /api/tools/sap-quote/interpret  — read an assessment's free-text
                                         technical fields (AD-15)

All are gated to ``authenticated`` by staticwebapp.config.json and
independently validated by ``require_auth``.

This file stays routing only. The Claude integration lives in
``shared/ai.py`` and the prompt and schema in ``shared/interpretation.py``;
the Fabric database will land as ``shared/db.py`` the same way.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

import azure.functions as func

from shared import ai
from shared.auth import (
    ClientPrincipal,
    check_organisation,
    json_response,
    require_auth,
)
from shared.display_name import name_from_upn
from shared.interpretation import AIError, PayloadError, interpret, validate_payload

logging.basicConfig(level=logging.INFO)

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)

APP_VERSION = os.environ.get("APP_VERSION", "0.1.0")


@app.route(route="health", methods=["GET"])
@require_auth
def health(req: func.HttpRequest, principal: ClientPrincipal) -> func.HttpResponse:
    """Liveness probe. Confirms auth, routing, and the Python worker."""
    del req  # unused — signature fixed by the decorator
    return json_response(
        {
            "status": "ok",
            "version": APP_VERSION,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "authenticated_as": principal.user_details,
            # Diagnostic: whether an interpretation call could succeed.
            # Reports configuration only — never the key or any part of it.
            "ai_configured": ai.is_configured(),
            "ai_model": ai.configured_model() if ai.is_configured() else None,
        }
    )


@app.route(route="me", methods=["GET"])
@require_auth
def me(req: func.HttpRequest, principal: ClientPrincipal) -> func.HttpResponse:
    """The calling user's identity, as the API sees it.

    Deliberately derived from the platform-injected header rather than
    anything the client sent. When a profile store exists, this is where
    the database lookup (and just-in-time user provisioning) goes.
    """
    del req

    # Re-run the policy purely to surface *why* this caller was allowed.
    # require_auth has already enforced it; this is a diagnostic read, and
    # it is what /health panel 2 displays.
    #
    # `authorised_by` starting "tenant:" means the tid claim is arriving
    # and the email-domain fallback in check_organisation is redundant.
    # "domain:" means claims are absent and the fallback is load-bearing —
    # removing it would 403 every user. See AD-07.
    result = check_organisation(principal)

    return json_response(
        {
            "user_id": principal.user_id,
            "upn": principal.user_details,
            "display_name": name_from_upn(principal.user_details),
            "roles": list(principal.user_roles),
            "identity_provider": principal.identity_provider,
            "authorised_by": result.reason,
            "tenant_claim_present": principal.tenant_id is not None,
            "claim_count": len(principal.claims),
        }
    )


@app.route(route="tools/sap-quote/interpret", methods=["POST"])
@require_auth
def sap_quote_interpret(
    req: func.HttpRequest, principal: ClientPrincipal
) -> func.HttpResponse:
    """Interpret an install assessment's free-text technical fields.

    The browser parses the assessment itself and calls this only for the
    three strings it could not read deterministically. It sends **nothing
    else** — no client name, no contact names, no email addresses — so this
    endpoint has no personal-data footprint and needs no retention policy.
    ``validate_payload`` re-asserts that here rather than trusting the
    caller, in the AD-02 style. See AD-15.

    Failure is never fatal: the caller keeps its own deterministic reading
    and shows the consultant what it could and could not work out, so an
    unconfigured or unavailable API degrades the feature rather than
    blocking the quote.
    """
    try:
        body = req.get_json()
    except ValueError:
        return json_response(
            {"error": "invalid_json", "message": "Request body is not valid JSON."},
            status_code=400,
        )

    try:
        payload = validate_payload(body)
    except PayloadError as exc:
        return json_response({"error": "invalid_payload", "message": str(exc)}, status_code=400)

    if not ai.is_configured():
        return json_response(
            {
                "error": "ai_unavailable",
                "message": "AI interpretation is not configured on this environment.",
            },
            status_code=503,
        )

    try:
        result = interpret(payload)
    except AIError as exc:
        # Log the failure, not the payload. There is nothing sensitive in
        # the payload by construction, but there is nothing useful either.
        logging.warning("Interpretation failed for %s: %s", principal.user_details, exc)
        return json_response(
            {"error": "ai_failed", "message": "The interpretation service did not respond."},
            status_code=502,
        )

    return json_response(result)
