"""SWA client-principal decoding, plus tenant authorisation.

## What the platform now guarantees

This app runs on the **Standard** SKU with custom authentication: an
Entra app registration pinned to the Codestone tenant
(``2e99fe9c-8eeb-485a-83e3-6c4179eded6d``). Adding a custom registration
disables every service-defined provider, so ``authenticated`` genuinely
means "signed in against our tenant" — unlike the Free SKU, where it
meant "holds any Microsoft account". See docs/decisions.md AD-06.

## Why this module still exists

Defence in depth. Platform-level auth is configuration, and configuration
drifts: a merge that quietly drops the ``auth`` block, or an SKU
downgrade, would silently reopen the app to any Microsoft account. The
route rules would still say ``authenticated`` and still look correct.

These checks are code, they are covered by tests, and they fail closed.
They cost one dictionary lookup per request. Keep them.

## The email-domain fallback

``check_organisation`` accepts either a matching ``tid`` claim or a
matching email domain. On Standard the ``tid`` claim should always be
present, making the domain fallback redundant — and it is the weaker of
the two tests (see AD-06 residual risk 2).

**Do not remove it until you have confirmed on the live site that
/health panel 2 reports a ``tenant:`` reason rather than a ``domain:``
one.** Removing it while claims are absent 403s every user, including
whoever is trying to fix it.

Reference:
https://learn.microsoft.com/en-us/azure/static-web-apps/user-information
"""

from __future__ import annotations

import base64
import functools
import json
import logging
import os
from dataclasses import dataclass, field
from typing import Callable

import azure.functions as func

logger = logging.getLogger(__name__)

# ─── Authorisation policy ────────────────────────────────────────────
#
# Overridable via SWA Application settings so the policy can be changed
# without a redeploy.

_DEFAULT_TENANTS = "2e99fe9c-8eeb-485a-83e3-6c4179eded6d"
_DEFAULT_DOMAINS = "codestone.com,daicodestone.onmicrosoft.com"


def _csv_env(name: str, default: str) -> frozenset[str]:
    raw = os.environ.get(name, default)
    return frozenset(part.strip().lower() for part in raw.split(",") if part.strip())


ALLOWED_TENANT_IDS = _csv_env("ALLOWED_TENANT_IDS", _DEFAULT_TENANTS)
ALLOWED_EMAIL_DOMAINS = _csv_env("ALLOWED_EMAIL_DOMAINS", _DEFAULT_DOMAINS)


@dataclass(frozen=True)
class ClientPrincipal:
    """Validated user identity, as forwarded by the SWA platform.

    SWA strips any inbound ``x-ms-client-principal`` header before
    proxying, so a client cannot forge this.
    """

    identity_provider: str
    user_id: str
    user_details: str
    user_roles: tuple[str, ...]
    claims: dict[str, str] = field(default_factory=dict)

    @property
    def is_authenticated(self) -> bool:
        return "authenticated" in self.user_roles

    @property
    def email_domain(self) -> str:
        return self.user_details.rsplit("@", 1)[-1].lower() if "@" in self.user_details else ""

    @property
    def tenant_id(self) -> str | None:
        """The ``tid`` claim, when the provider supplies one.

        The service-defined ``aad`` provider does not reliably populate
        claims in the principal header, so treat this as best-effort.
        Absence is not proof of anything — fall back to the domain check.
        """
        tid = self.claims.get("tid") or self.claims.get(
            "http://schemas.microsoft.com/identity/claims/tenantid"
        )
        return tid.lower() if tid else None

    def has_role(self, role: str) -> bool:
        return role in self.user_roles


def get_client_principal(req: func.HttpRequest) -> ClientPrincipal | None:
    """Decode the SWA client principal from the incoming request."""

    header = req.headers.get("x-ms-client-principal")
    if not header:
        return None

    try:
        payload = json.loads(base64.b64decode(header).decode("utf-8"))
    except (ValueError, json.JSONDecodeError):
        logger.warning("Malformed x-ms-client-principal header; treating as anonymous")
        return None

    # Claims arrive as a list of {typ, val} when present at all.
    raw_claims = payload.get("claims") or []
    claims: dict[str, str] = {}
    if isinstance(raw_claims, list):
        for c in raw_claims:
            if isinstance(c, dict) and "typ" in c:
                claims[str(c["typ"])] = str(c.get("val", ""))

    return ClientPrincipal(
        identity_provider=payload.get("identityProvider", ""),
        user_id=payload.get("userId", ""),
        user_details=payload.get("userDetails", ""),
        user_roles=tuple(payload.get("userRoles", ())),
        claims=claims,
    )


# ─── Authorisation ───────────────────────────────────────────────────


class AuthzResult:
    """Outcome of the organisational check, with the reason for logging."""

    __slots__ = ("allowed", "reason")

    def __init__(self, allowed: bool, reason: str) -> None:
        self.allowed = allowed
        self.reason = reason


def check_organisation(principal: ClientPrincipal) -> AuthzResult:
    """Is this signed-in user actually one of ours?

    Two independent tests, either of which passes the caller:

    1. ``tid`` claim matches an allowed tenant — strongest signal, but
       the service-defined provider often omits claims entirely.
    2. Email domain is on the allowlist — the practical fallback.

    Test 2 is weaker than it looks. A personal Microsoft account can be
    registered against a verified ``@codestone.com`` mailbox, so a
    departed employee who set one up while still employed could pass it
    even after their Entra account is disabled. Upgrading to Standard
    SKU and pinning the tenant is the real fix.
    """

    tid = principal.tenant_id
    if tid:
        if tid in ALLOWED_TENANT_IDS:
            return AuthzResult(True, f"tenant:{tid}")
        return AuthzResult(False, f"tenant_not_allowed:{tid}")

    domain = principal.email_domain
    if domain and domain in ALLOWED_EMAIL_DOMAINS:
        return AuthzResult(True, f"domain:{domain}")

    return AuthzResult(False, f"domain_not_allowed:{domain or 'none'}")


def json_response(body: dict, status_code: int = 200) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps(body),
        status_code=status_code,
        mimetype="application/json",
    )


def require_auth(
    handler: Callable[[func.HttpRequest, ClientPrincipal], func.HttpResponse],
) -> Callable[[func.HttpRequest], func.HttpResponse]:
    """Reject unauthenticated callers (401) and outsiders (403).

    Defence in depth: the SWA route rules gate /api/* to
    ``authenticated``, but on the Free SKU that only means "has a
    Microsoft account". The organisational boundary is enforced here.
    """

    @functools.wraps(handler)
    def wrapper(req: func.HttpRequest) -> func.HttpResponse:
        principal = get_client_principal(req)

        if principal is None or not principal.is_authenticated:
            return json_response(
                {"error": "unauthenticated", "message": "Sign-in required."},
                status_code=401,
            )

        result = check_organisation(principal)
        if not result.allowed:
            # Log the rejection — on Free SKU the sign-in page is open to
            # the world, so this is the only place outsider access
            # attempts become visible.
            logger.warning(
                "Access denied for %s (%s)", principal.user_details, result.reason
            )
            return json_response(
                {
                    "error": "not_authorised",
                    "message": (
                        "This portal is restricted to Codestone staff. "
                        "Your account is signed in but not authorised."
                    ),
                },
                status_code=403,
            )

        return handler(req, principal)

    # The Azure Functions v2 model inspects the decorated callable's
    # signature to match it against the HTTP trigger binding.
    # inspect.signature() follows __wrapped__ by default, which would
    # expose the two-argument inner signature and break binding — so we
    # keep the metadata functools.wraps copied but drop the back-pointer.
    del wrapper.__wrapped__

    return wrapper
