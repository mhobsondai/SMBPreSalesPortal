"""SMB Pre-Sales Portal — Functions API.

Minimal shell for the v0.1 scaffold. Two endpoints:

  GET /api/health  — liveness + version, proves the chain end to end
  GET /api/me      — the calling user's identity, as seen by the API

Both are gated to ``authenticated`` by staticwebapp.config.json and
independently validated by ``require_auth``.

When the Fabric database and Claude integrations land they go in
``shared/`` as separate modules (db.py, ai.py) and get wired up here —
keep this file as routing only.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

import azure.functions as func

from shared.auth import ClientPrincipal, json_response, require_auth
from shared.display_name import name_from_upn

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
    return json_response(
        {
            "user_id": principal.user_id,
            "upn": principal.user_details,
            "display_name": name_from_upn(principal.user_details),
            "roles": list(principal.user_roles),
            "identity_provider": principal.identity_provider,
        }
    )
