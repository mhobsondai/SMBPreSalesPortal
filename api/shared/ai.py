"""Thin Anthropic Claude client wrapper.

The **only** place in this codebase that talks to the Anthropic API.
Everything above it is pure and testable; this is the I/O seam.

Adapted from the same module in the PDD Generator, deliberately: that
pattern is in production, and inventing a second one would mean two places
to get streaming, retries and error mapping wrong.

Forced tool use, not free prose
-------------------------------
Every call names one tool and requires the model to call it, so the reply
is a dict matching a schema rather than text we would have to parse. For
this portal's first AI feature — reading a free-text operating system
string — that matters more than usual: the answer decides whether a quote
is an in-place upgrade or a full install and migration.

Lazy client, lazy import
------------------------
`anthropic` is imported inside `_client()`, not at module load, so the API
imports cleanly without the SDK present and Azure Functions pays the
construction cost on first use rather than every cold import.

Configuration (SWA Application Settings — never in the frontend bundle)
-----------------------------------------------------------------------
  ANTHROPIC_API_KEY   required
  CLAUDE_MODEL        defaults to a fast model; this task is small
  CLAUDE_MAX_TOKENS   output ceiling, defaults to 1024
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)

# Interpretation is a small, well-bounded task and must return inside the
# Static Web Apps gateway window (~45s), so it defaults to a fast model.
DEFAULT_MODEL = "claude-haiku-4-5-20251001"
DEFAULT_MAX_TOKENS = 1024


@dataclass(frozen=True)
class AIResult:
    """The parsed outcome of one forced-tool-use call."""

    data: dict[str, Any]
    model: str
    input_tokens: int
    output_tokens: int
    stop_reason: str | None


class AIError(Exception):
    """Any failure producing a structured completion.

    Deliberately one type — missing configuration, transport failure and a
    well-formed reply carrying no tool call all mean the same thing to the
    caller: fall back to the deterministic interpretation.
    """


_client_singleton: Any = None


def _client() -> Any:
    global _client_singleton
    if _client_singleton is not None:
        return _client_singleton

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise AIError("ANTHROPIC_API_KEY is not set")

    try:
        from anthropic import Anthropic
    except ImportError as exc:  # pragma: no cover - deploy-time guard
        raise AIError("anthropic SDK is not installed") from exc

    _client_singleton = Anthropic(api_key=api_key)
    return _client_singleton


def is_configured() -> bool:
    """Whether a call could succeed, without making one.

    Lets `/api/health` report AI availability, and lets the interpret
    endpoint answer 503 immediately rather than after a timeout.
    """
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def configured_model() -> str:
    return os.environ.get("CLAUDE_MODEL") or DEFAULT_MODEL


def _max_tokens() -> int:
    raw = os.environ.get("CLAUDE_MAX_TOKENS")
    if raw is None:
        return DEFAULT_MAX_TOKENS
    try:
        value = int(raw)
    except (TypeError, ValueError):
        logger.warning("CLAUDE_MAX_TOKENS=%r is not an integer; using %d", raw, DEFAULT_MAX_TOKENS)
        return DEFAULT_MAX_TOKENS
    if value <= 0:
        logger.warning("CLAUDE_MAX_TOKENS=%r is not positive; using %d", raw, DEFAULT_MAX_TOKENS)
        return DEFAULT_MAX_TOKENS
    return value


def complete_structured(
    *,
    system: str,
    user_text: str,
    tool_name: str,
    tool_description: str,
    input_schema: dict[str, Any],
    model: str | None = None,
) -> AIResult:
    """Run one forced-tool-use call and return the parsed tool input."""
    client = _client()
    model = model or configured_model()

    try:
        message = client.messages.create(
            model=model,
            max_tokens=_max_tokens(),
            system=system,
            tools=[
                {
                    "name": tool_name,
                    "description": tool_description,
                    "input_schema": input_schema,
                }
            ],
            tool_choice={"type": "tool", "name": tool_name},
            messages=[{"role": "user", "content": user_text}],
        )
    except AIError:
        raise
    except Exception as exc:  # the SDK raises a family of APIError subclasses
        logger.exception("Anthropic request failed")
        raise AIError(f"AI request failed: {exc}") from exc

    tool_input = _extract_tool_input(message, tool_name)

    usage = getattr(message, "usage", None)
    return AIResult(
        data=tool_input,
        model=model,
        input_tokens=int(getattr(usage, "input_tokens", 0) or 0),
        output_tokens=int(getattr(usage, "output_tokens", 0) or 0),
        stop_reason=getattr(message, "stop_reason", None),
    )


def _extract_tool_input(message: Any, tool_name: str) -> dict[str, Any]:
    for block in getattr(message, "content", []) or []:
        if getattr(block, "type", None) == "tool_use" and getattr(block, "name", None) == tool_name:
            data = getattr(block, "input", None)
            if isinstance(data, dict):
                return data
            raise AIError("tool_use block carried a non-object input")
    raise AIError(f"response contained no '{tool_name}' tool_use block")
