"""SWA client-principal helpers.

Azure Static Web Apps validates the user identity at the edge and forwards
it to the linked Functions API in the ``x-ms-client-principal`` request
header as base64-encoded JSON. The client cannot forge this header: SWA
strips any inbound copy before proxying.

This module unpacks that header and exposes the accessors endpoint code
uses to identify (and authorise) the calling user.

Reference:
https://learn.microsoft.com/en-us/azure/static-web-apps/user-information
"""

from __future__ import annotations

import base64
import functools
import json
import logging
from dataclasses import dataclass
from typing import Callable

import azure.functions as func

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ClientPrincipal:
    """Validated user identity, as forwarded by the SWA platform."""

    identity_provider: str
    user_id: str
    user_details: str
    user_roles: tuple[str, ...]

    @property
    def is_authenticated(self) -> bool:
        return "authenticated" in self.user_roles

    def has_role(self, role: str) -> bool:
        return role in self.user_roles


def get_client_principal(req: func.HttpRequest) -> ClientPrincipal | None:
    """Decode the SWA client principal from the incoming request.

    Returns ``None`` when no principal header is present, which on a
    correctly configured SWA means the request is anonymous.
    """

    header = req.headers.get("x-ms-client-principal")
    if not header:
        return None

    try:
        decoded = base64.b64decode(header).decode("utf-8")
        payload = json.loads(decoded)
    except (ValueError, json.JSONDecodeError):
        logger.warning("Malformed x-ms-client-principal header; treating as anonymous")
        return None

    return ClientPrincipal(
        identity_provider=payload.get("identityProvider", ""),
        user_id=payload.get("userId", ""),
        user_details=payload.get("userDetails", ""),
        user_roles=tuple(payload.get("userRoles", ())),
    )


def json_response(body: dict, status_code: int = 200) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps(body),
        status_code=status_code,
        mimetype="application/json",
    )


def require_auth(
    handler: Callable[[func.HttpRequest, ClientPrincipal], func.HttpResponse],
) -> Callable[[func.HttpRequest], func.HttpResponse]:
    """Decorator: reject unauthenticated callers with a 401.

    Belt and braces. The SWA route rules already restrict /api/* to
    ``authenticated``, but the API must not depend on the routing layer
    alone — defence in depth means the function validates for itself.
    """

    @functools.wraps(handler)
    def wrapper(req: func.HttpRequest) -> func.HttpResponse:
        principal = get_client_principal(req)
        if principal is None or not principal.is_authenticated:
            return json_response(
                {"error": "unauthenticated", "message": "Sign-in required."},
                status_code=401,
            )
        return handler(req, principal)

    # The Azure Functions v2 model inspects the decorated callable's
    # signature to match it against the HTTP trigger binding.
    # inspect.signature() follows __wrapped__ by default, which would
    # expose the two-argument inner signature and break binding — so we
    # keep the metadata functools.wraps copied but drop the back-pointer.
    del wrapper.__wrapped__

    return wrapper
