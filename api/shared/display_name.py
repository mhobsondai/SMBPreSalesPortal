"""Derive a human-readable name from a UPN.

Placeholder until the API has a profile store (Fabric) to read real
display names from. Mirrors frontend/src/lib/displayName.ts.
"""

from __future__ import annotations

import re


def name_from_upn(upn: str) -> str:
    local_part = upn.split("@")[0] if "@" in upn else upn
    parts = [p for p in re.split(r"[._-]+", local_part) if p]
    return " ".join(p[:1].upper() + p[1:] for p in parts) or upn
