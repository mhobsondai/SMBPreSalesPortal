#!/usr/bin/env python3
"""
Measure the sap-bia-quote-plan round trip against the ~45 second Static Web
Apps gateway.

The 45 seconds is not a plan limit and Standard does not lift it — it is a
blanket SWA API constraint that applies to managed and linked backends
alike. If the call does not fit, the answer is submit-and-poll, which is a
bigger change than the rest of the feature. So: measure before designing.

    setx ANTHROPIC_API_KEY "sk-ant-..."     (once, new shell after)
    pip install anthropic
    python measure_plan_roundtrip.py skill_XXXX 1786... assessment.json [runs]

`assessment.json` should be a real install-assessment export. It is stripped
to the allowlist before sending, exactly as the endpoint will, so the timing
reflects the payload that will actually go.

Reports each run and the spread, and says plainly whether it fits.
"""
from __future__ import annotations

import json
import os
import statistics
import sys
import time

BETAS = ["code-execution-2025-08-25", "skills-2025-10-02"]
GATEWAY_SECONDS = 45.0
MODEL = os.environ.get("CLAUDE_PLAN_MODEL", "claude-opus-5")

# The allowlist. Everything the engine reads, and nothing else — no client
# name, no contacts, no free-text narratives, no hostnames.
CLIENT_FIELDS = [
    "installationType", "productionEnvironmentCount",
    "hasTestEnvironments", "testEnvironmentCount",
    "hasDevEnvironments", "devEnvironmentCount",
    "trainingBiLaunchpad", "trainingCms", "trainingWebi",
    "trainingInformationDesignTool", "trainingCrystalReports",
    "trainingUniverseConversion",
    "goLiveTiming", "goLiveWeekday", "universeModifiers",
]
ANSWER_FIELDS = [
    "operatingSystem", "platformSoftware", "authentication",
    "separateTomcat", "externallyFacing",
    "inputFileRepositoryGb", "outputFileRepositoryGb",
    "universeCountMode", "unvCount", "unxCount", "combinedUniverseCount",
    "crystalDocuments", "webiDocuments", "publications",
    "pendingInstances", "successfulInstances",
    "successfulInstancesRequired", "destinationChangesRequired",
]

PROMPT = (
    "Produce a sap-quote-plan v1 document for the install assessment below.\n"
    "Follow SKILL.md exactly: run the engine, review the warnings, validate, "
    "and return the plan as JSON and nothing else.\n\n"
)


def strip(export: dict) -> dict:
    """Build the payload from an allowlist, never clean a denylist."""
    client = export.get("client") or {}
    out = {
        "schemaVersion": export.get("schemaVersion"),
        "tool": export.get("tool"),
        "installationType": export.get("installationType"),
        "client": {k: client[k] for k in CLIENT_FIELDS if k in client},
        "environments": [
            {
                "id": env.get("id"),
                "label": env.get("label"),
                "answers": {
                    k: (env.get("answers") or {})[k]
                    for k in ANSWER_FIELDS
                    if k in (env.get("answers") or {})
                },
            }
            for env in export.get("environments") or []
        ],
        "completeness": export.get("completeness"),
        "advisories": export.get("advisories"),
    }
    return out


def main() -> int:
    if len(sys.argv) < 4:
        print(__doc__)
        return 2
    skill_id, version, path = sys.argv[1], sys.argv[2], sys.argv[3]
    runs = int(sys.argv[4]) if len(sys.argv) > 4 else 3

    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ERROR: ANTHROPIC_API_KEY is not set in this shell.")
        return 2

    import anthropic

    with open(path, encoding="utf-8") as handle:
        payload = strip(json.load(handle))

    blob = json.dumps(payload)
    if "@" in blob:
        print("REFUSING: an '@' survived the strip. Check the allowlist.")
        return 2

    client = anthropic.Anthropic()
    print(f"model {MODEL}   skill {skill_id} v{version}")
    print(f"payload {len(blob):,} bytes, {runs} run(s)\n")

    times, failures = [], 0
    for run in range(1, runs + 1):
        started = time.monotonic()
        try:
            response = client.beta.messages.create(
                model=MODEL,
                max_tokens=8192,
                betas=BETAS,
                container={"skills": [
                    {"type": "custom", "skill_id": skill_id, "version": version}
                ]},
                tools=[{"type": "code_execution_20250825", "name": "code_execution"}],
                messages=[{"role": "user", "content": PROMPT + blob}],
            )
        except Exception as exc:
            failures += 1
            print(f"  run {run}: FAILED after {time.monotonic()-started:.1f}s — {exc}")
            continue

        elapsed = time.monotonic() - started
        times.append(elapsed)

        turns = sum(
            1 for b in response.content if getattr(b, "type", "") == "server_tool_use"
        )
        text = "".join(
            getattr(b, "text", "") for b in response.content
            if getattr(b, "type", "") == "text"
        )
        try:
            plan = json.loads(text[text.index("{"): text.rindex("}") + 1])
            shape = f"{len(plan.get('lines', []))} lines, route {plan.get('route')}"
        except Exception:
            shape = "NO PARSEABLE JSON IN THE REPLY"

        verdict = "fits" if elapsed < GATEWAY_SECONDS else "OVER GATEWAY"
        print(
            f"  run {run}: {elapsed:6.1f}s  {verdict:12} "
            f"{turns} code turns, {shape}"
        )

    print()
    if not times:
        print("No successful runs — nothing measured.")
        return 1

    slowest = max(times)
    print(f"min {min(times):.1f}s   median {statistics.median(times):.1f}s   "
          f"max {slowest:.1f}s   failures {failures}")
    print()
    if slowest < GATEWAY_SECONDS * 0.6:
        print(f"FITS with room — slowest run used "
              f"{slowest / GATEWAY_SECONDS * 100:.0f}% of the 45s window.")
        print("Request/response is viable. Set a client timeout below 45s so the")
        print("app fails its own way rather than being cut off by the gateway.")
    elif slowest < GATEWAY_SECONDS:
        print(f"FITS, but only just — {slowest / GATEWAY_SECONDS * 100:.0f}% of "
              "the window on the slowest run.")
        print("A larger estate or a slower day will breach it. Treat submit-and-poll")
        print("as likely rather than hypothetical.")
    else:
        print("DOES NOT FIT. Request/response is not viable through /api/*.")
        print("Submit-and-poll is required — and it is a bigger change than the")
        print("rest of the feature, so redesign now rather than later.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
