"""Read the free-text technical fields of an SAP install assessment.

One job: turn three strings a consultant typed during a client call into
three structured facts the effort model can use.

    "W2K12R2 Datacenter"        -> pre-Windows Server 2022: true
    "AD with SSO via Kerberos"  -> Windows AD
    "SAP BOBJ BI 4.2 SP7"       -> 4.2 SP7

The browser already tries this deterministically and only calls here when
it is uncertain, so this endpoint sees the awkward cases by design.

── What this module must never receive ──────────────────────────────────

**Three strings describing a server. Nothing else.**

The assessment those strings came from also holds a client name, two
contact names and two email addresses. None of them is sent, because none
of them helps read a Windows version. That is what keeps the portal's
AD-08 position intact — there is no personal data here to have a retention
policy about.

`validate_payload` enforces it on this side as well. The browser stripping
it is the control; this is the assertion that the control held, in the
AD-02 defence-in-depth style. A payload carrying an email address is
rejected rather than cleaned, because a cleaned payload hides a bug in the
caller.

── Why the model is not trusted with the decision ───────────────────────

The operating-system answer decides whether a quote is an in-place upgrade
or a full install and migration — a different engagement at a different
price. So the model returns a fact plus a confidence and a reason, and the
consultant confirms it in the UI. `null` is a permitted answer and is
preferred to a guess.
"""

from __future__ import annotations

import logging
from typing import Any

from shared.ai import AIError, complete_structured

logger = logging.getLogger(__name__)

AUTH_MODES = ["Enterprise", "Windows AD", "SAML"]
CONFIDENCE = ["high", "low", "unknown"]

MAX_FIELD_LENGTH = 200
ALLOWED_KEYS = {"operatingSystem", "authentication", "platformSoftware"}

TOOL_NAME = "record_interpretation"

SYSTEM_PROMPT = """\
You read short, informal technical notes taken by a pre-sales consultant \
during a client call about an SAP BusinessObjects or SAP Crystal Server \
estate, and turn them into structured facts.

You are given at most three strings: a server operating system, an \
authentication method, and the installed platform software version. They \
are often abbreviated, misspelled, or carry extra detail such as an edition \
or a service pack.

Rules:

- Return null for anything you cannot determine. A null is correct and \
useful; a guess is neither. Never infer a version from context.
- `pre_windows_server_2022` means the OS is an edition of Windows Server \
earlier than Windows Server 2022. Windows Server 2022 and 2025 are false. \
Anything that is not Windows Server at all — Linux, RHEL, SUSE, AIX — is \
null, not false, because the rule does not apply to it.
- Map authentication to exactly one of: Enterprise, Windows AD, SAML. \
Kerberos, NTLM and Active Directory all mean Windows AD. ADFS and federated \
sign-on mean SAML. LDAP is none of the three — return null and say so.
- `confidence` is "high" only when the string states the answer plainly. \
Use "low" when you inferred it, "unknown" when you could not.
- Each `reason` is one short sentence a consultant will read next to a \
figure. State what you read it as, not what you did.

Do not comment on anything other than these three fields."""

INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "operating_system": {
            "type": "object",
            "properties": {
                "detected": {
                    "type": ["string", "null"],
                    "description": "Normalised OS name, e.g. 'Windows Server 2016'.",
                },
                "pre_windows_server_2022": {
                    "type": ["boolean", "null"],
                    "description": "True if earlier than Windows Server 2022. Null if not Windows Server or undetermined.",
                },
                "confidence": {"type": "string", "enum": CONFIDENCE},
                "reason": {"type": "string"},
            },
            "required": ["detected", "pre_windows_server_2022", "confidence", "reason"],
        },
        "authentication": {
            "type": "object",
            "properties": {
                "auth": {"type": ["string", "null"], "enum": [*AUTH_MODES, None]},
                "confidence": {"type": "string", "enum": CONFIDENCE},
                "reason": {"type": "string"},
            },
            "required": ["auth", "confidence", "reason"],
        },
        "platform_software": {
            "type": "object",
            "properties": {
                "current_version": {
                    "type": ["string", "null"],
                    "description": "e.g. '4.2 SP7' or '2016'.",
                },
                "confidence": {"type": "string", "enum": CONFIDENCE},
                "reason": {"type": "string"},
            },
            "required": ["current_version", "confidence", "reason"],
        },
    },
    "required": ["operating_system", "authentication", "platform_software"],
}


class PayloadError(ValueError):
    """The request body is not the three-string payload this accepts."""


def validate_payload(body: Any) -> dict[str, str]:
    """Accept exactly the three permitted strings, or refuse.

    Unknown keys are rejected rather than ignored: an unexpected key means
    the caller is sending more than it should, and silently dropping it
    would let that go unnoticed until something personal was in it.
    """
    if not isinstance(body, dict):
        raise PayloadError("Expected a JSON object.")

    unknown = set(body) - ALLOWED_KEYS
    if unknown:
        raise PayloadError(
            "Unexpected field(s): " + ", ".join(sorted(unknown)) +
            ". This endpoint accepts only technical strings."
        )

    cleaned: dict[str, str] = {}
    for key in ALLOWED_KEYS:
        value = body.get(key, "")
        if value is None:
            value = ""
        if not isinstance(value, str):
            raise PayloadError(f"{key} must be a string.")
        value = value.strip()
        if len(value) > MAX_FIELD_LENGTH:
            raise PayloadError(f"{key} is longer than {MAX_FIELD_LENGTH} characters.")
        if "@" in value:
            # An email address here means the browser-side strip failed.
            raise PayloadError(
                f"{key} looks like it contains an email address. This endpoint "
                "must not receive personal data."
            )
        cleaned[key] = value

    if not any(cleaned.values()):
        raise PayloadError("Nothing to interpret.")

    return cleaned


def _user_text(payload: dict[str, str]) -> str:
    def line(label: str, value: str) -> str:
        return f"{label}: {value}" if value else f"{label}: (not recorded)"

    return "\n".join(
        [
            line("Operating system", payload["operatingSystem"]),
            line("Authentication", payload["authentication"]),
            line("Platform software", payload["platformSoftware"]),
        ]
    )


def _coerce_confidence(value: Any) -> str:
    return value if value in CONFIDENCE else "unknown"


def _coerce_text(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def interpret(payload: dict[str, str]) -> dict[str, Any]:
    """Run one interpretation and normalise the result.

    Every field is re-checked against the permitted values rather than
    trusted from the schema — a schema is a request, not a guarantee, and an
    out-of-range auth mode would otherwise reach the effort model. Anything
    unexpected degrades to null with `unknown` confidence, which the UI
    already knows how to display.
    """
    result = complete_structured(
        system=SYSTEM_PROMPT,
        user_text=_user_text(payload),
        tool_name=TOOL_NAME,
        tool_description=(
            "Record the structured interpretation of the three technical strings."
        ),
        input_schema=INPUT_SCHEMA,
    )

    data = result.data
    os_block = data.get("operating_system") or {}
    auth_block = data.get("authentication") or {}
    platform_block = data.get("platform_software") or {}

    pre = os_block.get("pre_windows_server_2022")
    if not isinstance(pre, bool):
        pre = None

    auth = auth_block.get("auth")
    if auth not in AUTH_MODES:
        auth = None

    return {
        "operatingSystem": {
            "raw": payload["operatingSystem"],
            "preWindowsServer2022": pre,
            "detected": _coerce_text(os_block.get("detected")),
            "confidence": _coerce_confidence(os_block.get("confidence")),
            "reason": _coerce_text(os_block.get("reason")) or "No reason given.",
        },
        "authentication": {
            "raw": payload["authentication"],
            "auth": auth,
            "confidence": _coerce_confidence(auth_block.get("confidence")),
            "reason": _coerce_text(auth_block.get("reason")) or "No reason given.",
        },
        "platformSoftware": {
            "raw": payload["platformSoftware"],
            "currentVersion": _coerce_text(platform_block.get("current_version")),
            "confidence": _coerce_confidence(platform_block.get("confidence")),
            "reason": _coerce_text(platform_block.get("reason")) or "No reason given.",
        },
        "source": "ai",
        "model": result.model,
        "usage": {
            "input_tokens": result.input_tokens,
            "output_tokens": result.output_tokens,
        },
    }


__all__ = ["AIError", "PayloadError", "interpret", "validate_payload"]
