#!/usr/bin/env python3
"""Validate Phase 1 fixture integrity, coverage, determinism metadata and privacy."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
GENERATED_ROOT = ROOT / "generated" / "legacy"
ALLOWED_CLASSIFICATIONS = {"must-preserve", "intentional-correction", "obsolete"}
REQUIRED_BEHAVIORS = {
    "inline-defaults-on",
    "inline-defaults-off",
    "flat-parent-child-hierarchy",
    "explicit-visual-indentation",
    "child-inheritance-and-overrides",
    "checkbox-tags-unicode-escaping-lists-visual-custom",
    "daily-target-resolution",
    "file-default-and-explicit-target",
    "filename-sanitization",
    "template-order-unmanaged-fields-tags-body",
    "collision-without-overwrite",
    "unconfirmed-overwrite",
    "vault-path-guards",
    "non-markdown-and-hidden-targets",
    "stdout-stderr-result-contract",
    "caller-provided-operon-id",
    "legacy-reminders-field",
    "canonical-reminder-fields",
    "personal-profile-snapshot",
}
COMPACT_CREATE_ROUTES = {"legacy-guided", "compact", "error"}
COMPACT_CREATE_REPRESENTATIONS = {"inline", "file", None}
COMPACT_CREATE_CHANNELS = {"argv", "stdin"}
COMPACT_CREATE_CAPABILITIES = {"create-capability-unavailable"}
TYPED_CREATE_FEATURES = [
    "exact-inline-placement",
    "exact-file-target",
    "deterministic-file-template",
    "file-body-replacement",
    "same-source-task-graph",
    "cross-source-parent-related",
]
GRAPH_TRANSACTION_FEATURES = [
    "vault-wide-graph-transaction",
    "compare-aware-compensation",
    "same-plan-safe-continuation",
    "cross-source-reciprocal-dependency",
]
HUMAN_COMMAND_CATEGORY_MINIMUMS = {
    "inspect": 15,
    "create": 28,
    "update": 20,
    "lifecycle-reminder-pin": 18,
    "recurrence-relationship": 20,
    "timer": 16,
    "source-transition": 14,
    "plan-recovery": 10,
}
TYPED_CREATE_CASE_IDS = [
    "typed-exact-inline-append",
    "typed-exact-inline-line",
    "typed-exact-file-target",
    "typed-builtin-file-template",
    "typed-folder-file-template",
    "typed-file-body-replacement",
    "typed-same-source-parent-child",
    "typed-same-source-related-graph",
    "typed-same-source-dependency-chain",
    "typed-cross-source-parent-warning",
    "typed-cross-source-parent-legacy-blocker",
    "typed-cross-source-dependency-blocker",
    "typed-cross-source-dependency-transaction",
]
FORBIDDEN_PRIVACY_PATTERNS = {
    "/Users/": "absolute macOS home path",
    "Dropbox": "personal sync provider path",
    "Stratejya": "personal vault name",
    "hasanyilmaz": "personal account name",
    "marketplace": "personal marketplace artifact",
    "cachebuster": "personal cache artifact",
}


def fail(message: str) -> None:
    raise AssertionError(message)


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        fail(f"expected object in {path}")
    return value


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def assert_unique(values: list[str], label: str) -> None:
    if len(values) != len(set(values)):
        fail(f"duplicate {label}: {values}")


def validate_privacy() -> None:
    for path in sorted(ROOT.rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        if path.resolve() == Path(__file__).resolve():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for pattern, reason in FORBIDDEN_PRIVACY_PATTERNS.items():
            if pattern in text:
                fail(f"{reason} found in {path.relative_to(ROOT)}: {pattern}")


def manifest_case_references(behavior: dict[str, Any]) -> list[str]:
    references: list[str] = []
    single = behavior.get("legacyCase")
    if isinstance(single, str) and single:
        references.append(single)
    multiple = behavior.get("legacyCases")
    if isinstance(multiple, list):
        references.extend(str(item) for item in multiple if str(item))
    return references


def validate_catalog_and_delta() -> tuple[dict[str, Any], dict[str, Any]]:
    catalog = load_json(ROOT / "legacy-case-catalog.json")
    delta = load_json(ROOT / "parity-delta-manifest.json")
    profile = load_json(ROOT / "sanitized-profile.json")
    canonical = load_json(ROOT / "canonical-golden.json")

    validate_compact_create_golden()
    validate_compact_update_golden()
    validate_human_command_golden()
    validate_typed_create_golden()
    validate_graph_transaction_golden()

    if catalog.get("schemaVersion") != 1:
        fail("unsupported legacy case catalog schema")
    if delta.get("schemaVersion") != 1:
        fail("unsupported parity/delta schema")
    if profile.get("fixtureSchemaVersion") != 1:
        fail("unsupported sanitized profile schema")
    if canonical.get("schemaVersion") != 1:
        fail("unsupported canonical golden schema")

    raw_cases = catalog.get("cases")
    if not isinstance(raw_cases, list) or not raw_cases:
        fail("legacy catalog must contain cases")
    case_ids = [str(case.get("id", "")) for case in raw_cases if isinstance(case, dict)]
    if len(case_ids) != len(raw_cases) or any(not case_id for case_id in case_ids):
        fail("each legacy case needs an id")
    assert_unique(case_ids, "legacy case ids")

    behaviors = delta.get("behaviors")
    if not isinstance(behaviors, list) or not behaviors:
        fail("parity/delta manifest must contain behaviors")
    behavior_ids = [str(item.get("id", "")) for item in behaviors if isinstance(item, dict)]
    assert_unique(behavior_ids, "behavior ids")
    missing_behaviors = REQUIRED_BEHAVIORS.difference(behavior_ids)
    if missing_behaviors:
        fail(f"required behaviors missing: {sorted(missing_behaviors)}")

    known_cases = set(case_ids)
    for behavior in behaviors:
        if not isinstance(behavior, dict):
            fail("behavior entry must be an object")
        classification = behavior.get("classification")
        if classification not in ALLOWED_CLASSIFICATIONS:
            fail(f"invalid classification for {behavior.get('id')}: {classification}")
        expectation = behavior.get("canonicalExpectation")
        if not isinstance(expectation, str) or not expectation.strip():
            fail(f"missing canonical expectation for {behavior.get('id')}")
        for reference in manifest_case_references(behavior):
            if reference not in known_cases:
                fail(f"unknown legacy case reference {reference} in {behavior.get('id')}")

    canonical_text = (ROOT / "canonical-golden.json").read_text(encoding="utf-8")
    if "reminderDatetimes" not in canonical_text or "reminderRules" not in canonical_text:
        fail("canonical baseline must include both current reminder fields")
    return catalog, delta


def validate_compact_create_golden() -> None:
    compact = load_json(ROOT / "compact-create-golden.json")
    canonical = load_json(ROOT / "canonical-golden.json")
    if compact.get("schemaVersion") != 1:
        fail("unsupported compact create golden schema")
    expected_contract = {
        "command": "operon task create",
        "representation": "optional-inline-or-file",
        "fieldKeys": "canonical-only",
        "duplicateKeys": "reject",
        "listDelimiter": "semicolon-canonical-space",
        "rawStdinQuotes": "straight-double-required",
        "inlineValueParity": "semantic-values-only",
        "temporalCreate": "atomic-v1",
        "temporalCreateVersion": 1,
        "temporalCreateKeys": [
            "reminderDatetimes",
            "reminderRules",
            "repeat",
            "datetimeRepeatEnd",
        ],
    }
    if compact.get("contract") != expected_contract:
        fail("compact create golden contract drifted")
    serializer_fixture = compact.get("serializerFixture")
    canonical_case = canonical.get("inline", {}).get("remindersCustomUnicode", {})
    if serializer_fixture != {
        "file": "canonical-golden.json",
        "caseId": canonical_case.get("id"),
    }:
        fail("compact create serializer fixture link drifted")
    cases = compact.get("cases")
    if not isinstance(cases, list) or not cases:
        fail("compact create golden requires cases")
    case_ids: list[str] = []
    for case in cases:
        if not isinstance(case, dict):
            fail("compact create case must be an object")
        case_id = case.get("id")
        channel = case.get("channel")
        expect = case.get("expect")
        if not isinstance(case_id, str) or not case_id:
            fail("compact create case needs an id")
        case_ids.append(case_id)
        if channel not in COMPACT_CREATE_CHANNELS:
            fail(f"compact create channel is invalid: {case_id}")
        if channel == "argv":
            argv = case.get("argv")
            if not isinstance(argv, list) or not all(isinstance(token, str) and token for token in argv):
                fail(f"compact create case argv is invalid: {case_id}")
            if argv[:2] != ["task", "create"]:
                fail(f"compact create case must target task create: {case_id}")
            if "input" in case or "inputFormat" in case:
                fail(f"argv compact case contains stdin fields: {case_id}")
        else:
            if case.get("inputFormat") != "compact" or not isinstance(case.get("input"), str):
                fail(f"compact stdin case is invalid: {case_id}")
            if "argv" in case:
                fail(f"stdin compact case contains argv: {case_id}")
        display_command = case.get("displayCommand")
        if display_command is not None:
            if (
                channel != "argv"
                or expect.get("route") != "compact"
                or not isinstance(display_command, str)
                or not display_command.startswith("operon task create ")
                or any(quote in display_command for quote in ("“", "”"))
                or "--json" in display_command
                or "--input -" in display_command
            ):
                fail(f"compact display command is invalid: {case_id}")
        if not isinstance(expect, dict) or expect.get("route") not in COMPACT_CREATE_ROUTES:
            fail(f"compact create case route is invalid: {case_id}")
        representation = expect.get("representation")
        if representation is not None and representation not in COMPACT_CREATE_REPRESENTATIONS:
            fail(f"compact create representation is invalid: {case_id}")
        assignments = expect.get("assignments", [])
        if not isinstance(assignments, list):
            fail(f"compact create assignments are invalid: {case_id}")
        assignment_keys: list[str] = []
        for assignment in assignments:
            if (
                not isinstance(assignment, dict)
                or not isinstance(assignment.get("key"), str)
                or not assignment["key"]
                or not isinstance(assignment.get("value"), str)
                or not assignment["value"]
            ):
                fail(f"compact create assignment is invalid: {case_id}")
            assignment_keys.append(assignment["key"])
            if assignment.get("valueType") in {
                "list",
                "reminder-datetimes",
                "reminder-rules",
            }:
                items = assignment.get("items")
                canonical_value = assignment.get("canonical")
                if (
                    not isinstance(items, list)
                    or not items
                    or not all(isinstance(item, str) and item for item in items)
                    or not isinstance(canonical_value, str)
                    or not canonical_value
                ):
                    fail(f"compact create list assignment is invalid: {case_id}")
        if expect.get("route") == "compact":
            assert_unique(assignment_keys, f"compact assignment keys in {case_id}")
        capability = expect.get("capability")
        if capability is not None and capability not in COMPACT_CREATE_CAPABILITIES:
            fail(f"compact create capability is invalid: {case_id}")
    assert_unique(case_ids, "compact create case ids")
    required_case_ids = {
        "legacy-empty-create",
        "legacy-single-description",
        "legacy-single-inline-word",
        "configured-default-representation",
        "explicit-inline-without-fields",
        "explicit-file-representation",
        "inline-description-with-omitted-representation",
        "list-spacing-and-multiword-items",
        "list-escaped-semicolon",
        "scalar-semicolon-literal",
        "scalar-double-colon-value",
        "tags-links-parent-human",
        "raw-compact-stdin-valid",
        "raw-custom-key-with-spaces",
        "raw-compact-stdin-missing-quotes",
        "raw-compact-stdin-smart-quotes",
        "raw-first-unquoted-before-valid-assignment",
        "visible-property-name-rejected",
        "unknown-canonical-key-rejected",
        "runtime-owned-key-rejected",
        "duplicate-key-rejected",
        "empty-list-element-rejected",
        "compact-positional-input-conflict",
        "input-format-requires-input",
        "preview-only-json-is-preview",
        "absolute-reminder-create-valid",
        "reminder-rule-create-valid",
        "recurrence-create-valid",
        "repeat-end-create-valid",
    }
    missing_case_ids = required_case_ids.difference(case_ids)
    if missing_case_ids:
        fail(f"compact create coverage missing: {sorted(missing_case_ids)}")
    compact_text = (ROOT / "compact-create-golden.json").read_text(encoding="utf-8")
    if "dateDue.30m" not in compact_text or "mode=schedule|freq=day|interval=1" not in compact_text:
        fail("compact temporal canonical examples are missing")
    if "dateDue:-PT30M" in compact_text or "dateDue:-PT30M" in json.dumps(canonical):
        fail("retired reminder rule syntax remains in canonical fixtures")


def validate_human_command_golden() -> None:
    human = load_json(ROOT / "human-cli-command-golden.json")
    compact = load_json(ROOT / "compact-create-golden.json")
    if human.get("schemaVersion") != 1:
        fail("unsupported human command golden schema")
    contract = human.get("contract")
    if contract != {
        "marker": "human-command-case-id",
        "commandAuthority": "operon-cli-manifest-v1",
        "compactCreateAuthority": "compact-create-golden.json",
        "minimumUniqueCommands": 141,
        "straightDoubleQuotes": True,
        "canonicalListDelimiter": "; ",
        "agentPayloadsForbidden": True,
    }:
        fail("human command golden contract drifted")
    if human.get("categories") != {
        category: {"minimum": minimum}
        for category, minimum in HUMAN_COMMAND_CATEGORY_MINIMUMS.items()
    }:
        fail("human command category policy drifted")
    cases = human.get("cases")
    if not isinstance(cases, list) or len(cases) < contract["minimumUniqueCommands"]:
        fail("human command golden lacks the required commands")
    case_ids: list[str] = []
    commands: list[str] = []
    counts = {category: 0 for category in HUMAN_COMMAND_CATEGORY_MINIMUMS}
    compact_cases = {
        case.get("id"): case
        for case in compact.get("cases", [])
        if isinstance(case, dict)
    }
    for case in cases:
        if not isinstance(case, dict):
            fail("human command case must be an object")
        case_id = case.get("id")
        category = case.get("category")
        command = case.get("displayCommand")
        if not isinstance(case_id, str) or not re.fullmatch(r"[a-z0-9-]+", case_id):
            fail("human command case has an invalid id")
        if category not in counts:
            fail(f"human command category is invalid: {case_id}")
        if not isinstance(command, str) or not command.startswith("operon "):
            fail(f"human display command is invalid: {case_id}")
        if any(value in command for value in ("--json", "--input ", "--confirm", "“", "”")):
            fail(f"human display command contains a forbidden machine pattern: {case_id}")
        case_ids.append(case_id)
        commands.append(command)
        counts[category] += 1
        compact_case_id = case.get("compactCaseId")
        if compact_case_id is not None:
            compact_case = compact_cases.get(compact_case_id)
            if (
                case.get("commandId") != "task.create"
                or compact_case_id != case_id
                or not isinstance(compact_case, dict)
                or compact_case.get("displayCommand") != command
            ):
                fail(f"human compact authority link drifted: {case_id}")
    assert_unique(case_ids, "human command case ids")
    assert_unique(commands, "human display commands")
    for category, minimum in HUMAN_COMMAND_CATEGORY_MINIMUMS.items():
        if counts[category] < minimum:
            fail(f"human command category lacks coverage: {category}")
def validate_compact_update_golden() -> None:
    compact = load_json(ROOT / "compact-update-golden.json")
    if compact.get("version") != 1:
        fail("unsupported compact update golden version")
    cases = compact.get("cases")
    if not isinstance(cases, list) or not cases:
        fail("compact update golden requires cases")
    case_ids: list[str] = []
    for case in cases:
        if not isinstance(case, dict):
            fail("compact update case must be an object")
        case_id = case.get("id")
        if not isinstance(case_id, str) or not case_id:
            fail("compact update case requires an id")
        case_ids.append(case_id)
        if not isinstance(case.get("assignments"), list) or not isinstance(case.get("clear"), list):
            fail(f"compact update case requires assignment and clear lists: {case_id}")
        if not isinstance(case.get("expect"), dict):
            fail(f"compact update case requires an expectation: {case_id}")
    if len(case_ids) != len(set(case_ids)):
        fail("compact update case IDs must be unique")
    required = {
        "multi-set-clear",
        "scalar-double-colon",
        "unicode-nfc",
        "duplicate-set",
        "duplicate-clear",
        "set-clear-conflict",
        "empty-update",
    }
    missing = required.difference(case_ids)
    if missing:
        fail(f"compact update coverage missing: {sorted(missing)}")
    batch_cases = compact.get("batchCases")
    if not isinstance(batch_cases, list) or not batch_cases:
        fail("compact update golden requires batch cases")
    batch_case_ids: list[str] = []
    for case in batch_cases:
        if not isinstance(case, dict):
            fail("compact update batch case must be an object")
        case_id = case.get("id")
        if not isinstance(case_id, str) or not case_id:
            fail("compact update batch case requires an id")
        batch_case_ids.append(case_id)
        if not isinstance(case.get("input"), str) or not isinstance(case.get("expect"), dict):
            fail(f"compact update batch case requires input and expectation: {case_id}")
    assert_unique(batch_case_ids, "compact update batch case ids")
    batch_required = {
        "two-heterogeneous-updates",
        "crlf-final-newline-optional",
        "duplicate-id",
        "description-selector-refused",
        "relationship-route-refused",
        "single-line-refused",
        "blank-line-refused",
    }
    batch_missing = batch_required.difference(batch_case_ids)
    if batch_missing:
        fail(f"compact update batch coverage missing: {sorted(batch_missing)}")


def validate_typed_create_golden() -> None:
    typed = load_json(ROOT / "typed-create-golden.json")
    if typed.get("schemaVersion") != 1:
        fail("unsupported typed create golden schema")
    expected_contract = {
        "command": "operon task create",
        "inputFormat": "typed-json",
        "typedCreateVersion": 1,
        "typedCreateFeatures": TYPED_CREATE_FEATURES,
        "lineNumberBase": "zero",
        "linePlacement": "insert-before",
        "fileBodyMaxUtf8Bytes": 65_536,
        "crossSourceParentRelated": "fresh-confirmation",
        "crossSourceDependency": "graph-transaction-gated",
        "graphTransactionVersion": 1,
        "graphTransactionFeatures": GRAPH_TRANSACTION_FEATURES,
    }
    if typed.get("contract") != expected_contract:
        fail("typed create golden contract drifted")
    cases = typed.get("cases")
    if not isinstance(cases, list) or not cases:
        fail("typed create golden requires cases")
    case_ids = [case.get("id") for case in cases if isinstance(case, dict)]
    if case_ids != TYPED_CREATE_CASE_IDS:
        fail("typed create golden case inventory or order drifted")
    assert_unique(case_ids, "typed create case ids")
    for case in cases:
        case_id = case["id"]
        feature = case.get("feature")
        intent = case.get("intent")
        expect = case.get("expect")
        if feature not in TYPED_CREATE_FEATURES:
            fail(f"typed create feature is invalid: {case_id}")
        if not isinstance(intent, dict) or intent.get("contractVersion") != 1:
            fail(f"typed create intent contract is invalid: {case_id}")
        if intent.get("kind") != "mutation-intent":
            fail(f"typed create intent kind is invalid: {case_id}")
        if not isinstance(intent.get("reason"), str) or not intent["reason"]:
            fail(f"typed create intent reason is invalid: {case_id}")
        spec = intent.get("spec")
        if not isinstance(spec, dict):
            fail(f"typed create spec is invalid: {case_id}")
        items = spec.get("items")
        if spec.get("operation") != "create" or not isinstance(items, list) or not items:
            fail(f"typed create spec is invalid: {case_id}")
        item_refs = [item.get("itemRef") for item in items if isinstance(item, dict)]
        if len(item_refs) != len(items) or any(not isinstance(item_ref, str) for item_ref in item_refs):
            fail(f"typed create item refs are invalid: {case_id}")
        assert_unique(item_refs, f"typed create item refs in {case_id}")
        if not isinstance(expect, dict) or expect.get("route") not in {"typed-preview", "error"}:
            fail(f"typed create expectation is invalid: {case_id}")
        candidate = case.get("templateCandidate")
        if candidate is not None:
            if not isinstance(candidate, dict) or candidate.get("kind") not in {
                "builtin-pipeline-minimal",
                "folder",
            }:
                fail(f"typed create template candidate is invalid: {case_id}")
            if "content" in candidate:
                fail(f"typed create template candidate leaks content: {case_id}")
    line_case = cases[TYPED_CREATE_CASE_IDS.index("typed-exact-inline-line")]
    if line_case["expect"] != {
        "route": "typed-preview",
        "representation": "inline",
        "filePath": "20 Projects/Runtime review.md",
        "lineNumber": 7,
        "placement": "insert-before",
        "candidateSource": "placement-candidates",
        "riskLevel": "routine",
    }:
        fail("typed exact-line semantics drifted")
    graph_case = cases[TYPED_CREATE_CASE_IDS.index("typed-cross-source-parent-warning")]
    if graph_case["expect"] != {
        "route": "typed-preview",
        "riskLevel": "elevated",
        "warning": "cross-source-graph-partial-risk",
        "requiredAcknowledgement": "cross-source-graph-partial-risk",
        "requiresConfirmation": True,
        "freshUserTurn": True,
        "requiresGraphTransactionVersion": 1,
        "requiresGraphTransactionFeatures": GRAPH_TRANSACTION_FEATURES,
        "sourceGroupOrder": [
            "20 Projects/A parent source.md",
            "20 Projects/Z child source.md",
        ],
    }:
        fail("typed cross-source parent safety semantics drifted")
    parent_blocker_case = cases[
        TYPED_CREATE_CASE_IDS.index("typed-cross-source-parent-legacy-blocker")
    ]
    if parent_blocker_case["expect"] != {
        "route": "error",
        "code": "capability-unavailable",
        "feature": "vault-wide-graph-transaction",
        "requiresGraphTransactionVersion": 1,
        "safeFallback": None,
    }:
        fail("typed cross-source parent legacy blocker drifted")
    blocker_case = cases[TYPED_CREATE_CASE_IDS.index("typed-cross-source-dependency-blocker")]
    if blocker_case["expect"] != {
        "route": "error",
        "code": "capability-unavailable",
        "feature": "vault-wide-graph-transaction",
        "requiresGraphTransactionVersion": 1,
        "safeFallback": None,
    }:
        fail("typed cross-source dependency blocker drifted")
    transaction_case = cases[
        TYPED_CREATE_CASE_IDS.index("typed-cross-source-dependency-transaction")
    ]
    if transaction_case["expect"] != {
        "route": "typed-preview",
        "riskLevel": "elevated",
        "warning": "cross-source-graph-partial-risk",
        "requiredAcknowledgement": "cross-source-graph-partial-risk",
        "requiresConfirmation": True,
        "freshUserTurn": True,
        "requiresGraphTransactionVersion": 1,
        "requiresGraphTransactionFeatures": GRAPH_TRANSACTION_FEATURES,
        "sourceGroupOrder": [
            "20 Projects/A transaction acceptance.md",
            "20 Projects/Z transaction contract.md",
        ],
        "safeFallback": None,
    }:
        fail("graph-gated cross-source dependency contract drifted")


def validate_graph_transaction_golden() -> None:
    graph = load_json(ROOT / "graph-transaction-golden.json")
    if graph.get("schemaVersion") != 1:
        fail("unsupported graph transaction golden schema")
    if graph.get("contract") != {
        "graphTransactionVersion": 1,
        "graphTransactionFeatures": GRAPH_TRANSACTION_FEATURES,
        "maxJournalUtf8Bytes": 8_388_608,
        "recoveryPlanPolicy": "same-plan-only",
    }:
        fail("graph transaction golden contract drifted")
    cases = graph.get("cases")
    if not isinstance(cases, list) or len(cases) != 7:
        fail("graph transaction golden case inventory drifted")
    assert_unique([case.get("id") for case in cases], "graph transaction case ids")
    valid_results = {"forward-completed", "compensated", "unresolved"}
    for case in cases:
        if case.get("typedCreateCaseId") != "typed-cross-source-dependency-transaction":
            fail(f"graph transaction case has an unknown typed fixture: {case.get('id')}")
        if case.get("expect") not in valid_results:
            fail(f"graph transaction case has an invalid result: {case.get('id')}")


def validate_generated(catalog: dict[str, Any]) -> None:
    manifest_path = GENERATED_ROOT / "manifest.json"
    if not manifest_path.is_file():
        fail("generated legacy manifest is missing")
    manifest = load_json(manifest_path)
    if manifest.get("catalogSha256") != sha256_bytes((ROOT / "legacy-case-catalog.json").read_bytes()):
        fail("generated manifest catalog digest is stale")
    if manifest.get("profileSha256") != sha256_bytes((ROOT / "sanitized-profile.json").read_bytes()):
        fail("generated manifest profile digest is stale")
    if manifest.get("templateSha256") != sha256_bytes((ROOT / "template-fixture-task.md").read_bytes()):
        fail("generated manifest template digest is stale")
    if manifest.get("generatorSha256") != sha256_bytes((ROOT / "generate_legacy_fixtures.py").read_bytes()):
        fail("generated manifest generator digest is stale")
    raw_cases = catalog["cases"]
    case_ids = [str(case["id"]) for case in raw_cases]
    generated_cases = manifest.get("cases")
    if not isinstance(generated_cases, list):
        fail("generated manifest cases are missing")
    generated_ids = [str(case.get("caseId", "")) for case in generated_cases if isinstance(case, dict)]
    if generated_ids != case_ids:
        fail("generated case order does not match catalog")
    if manifest.get("caseCount") != len(case_ids):
        fail("generated case count does not match catalog")

    for execution in generated_cases:
        case_id = str(execution["caseId"])
        case_dir = GENERATED_ROOT / case_id
        stdout_path = case_dir / "stdout.txt"
        stderr_path = case_dir / "stderr.txt"
        request_path = case_dir / "request.json"
        execution_path = case_dir / "execution.json"
        for required in (stdout_path, stderr_path, request_path, execution_path):
            if not required.is_file():
                fail(f"missing generated artifact: {required.relative_to(ROOT)}")
        disk_execution = load_json(execution_path)
        if disk_execution != execution:
            fail(f"manifest execution mismatch for {case_id}")
        if sha256_bytes(request_path.read_bytes()) != execution["requestSha256"]:
            fail(f"request digest mismatch for {case_id}")
        if sha256_bytes(stdout_path.read_bytes()) != execution["stdoutSha256"]:
            fail(f"stdout digest mismatch for {case_id}")
        if sha256_bytes(stderr_path.read_bytes()) != execution["stderrSha256"]:
            fail(f"stderr digest mismatch for {case_id}")
        for relative_path, expected_digest in execution.get("writtenFiles", {}).items():
            written = case_dir / "written" / relative_path
            if not written.is_file():
                fail(f"missing written file for {case_id}: {relative_path}")
            if sha256_bytes(written.read_bytes()) != expected_digest:
                fail(f"written file digest mismatch for {case_id}: {relative_path}")

    def execution(case_id: str) -> dict[str, Any]:
        return load_json(GENERATED_ROOT / case_id / "execution.json")

    for case_id in ("file-collision", "path-guard-absolute", "path-guard-traversal", "path-guard-symlink"):
        if execution(case_id)["exitCode"] == 0:
            fail(f"{case_id} must fail closed in the legacy baseline")
    for case_id in ("target-non-markdown-drift", "target-hidden-drift", "file-overwrite"):
        if execution(case_id)["exitCode"] != 0:
            fail(f"{case_id} must record the legacy permissive behavior")

    caller_stdout = (GENERATED_ROOT / "caller-id-ignored" / "stdout.txt").read_text(encoding="utf-8")
    if "caller1" in caller_stdout:
        fail("caller-provided operonId was not ignored")
    if not re.search(r"\{\{operonId:: [a-z0-9]{7}\}\}", caller_stdout):
        fail("runtime-owned 7-character identity missing from caller-id baseline")

    reminder_stdout = (GENERATED_ROOT / "legacy-reminders-drift" / "stdout.txt").read_text(encoding="utf-8")
    if "{{reminders::" not in reminder_stdout:
        fail("legacy reminder drift case no longer records the retired key")

    dry_execution = execution("output-channels-dry-run")
    write_execution = execution("output-channels-write")
    if dry_execution["stdoutSha256"] == write_execution["stdoutSha256"]:
        fail("dry-run and write stdout contracts unexpectedly match")
    if dry_execution["stderrSha256"] == write_execution["stderrSha256"]:
        fail("dry-run and write stderr contracts unexpectedly match")


def main() -> int:
    catalog, _delta = validate_catalog_and_delta()
    validate_generated(catalog)
    validate_privacy()
    print("Operon Agent Runtime fixtures validated: 22 legacy cases, canonical contracts, privacy clean.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except AssertionError as error:
        print(f"fixture validation failed: {error}", file=sys.stderr)
        sys.exit(1)
