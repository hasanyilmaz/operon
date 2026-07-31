#!/usr/bin/env python3
"""Generate deterministic, sanitized goldens from the current operon-task renderer."""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import random
import shutil
import sys
import tempfile
from argparse import Namespace
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
GENERATOR_PATH = Path(__file__).resolve()
CATALOG_PATH = ROOT / "legacy-case-catalog.json"
PROFILE_PATH = ROOT / "sanitized-profile.json"
TEMPLATE_PATH = ROOT / "template-fixture-task.md"
GENERATED_ROOT = ROOT / "generated" / "legacy"
FIXTURE_VAULT_TOKEN = "<FIXTURE_VAULT>"
FIXTURE_ROOT_TOKEN = "<FIXTURE_ROOT>"


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"expected JSON object: {path}")
    return value


def import_legacy_renderer(path: Path) -> Any:
    spec = importlib.util.spec_from_file_location("operon_phase1_legacy_renderer", path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot import legacy renderer: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def replace_tokens(value: Any, vault: Path, fixture_root: Path, outside_dir: Path) -> Any:
    if isinstance(value, dict):
        return {key: replace_tokens(item, vault, fixture_root, outside_dir) for key, item in value.items()}
    if isinstance(value, list):
        return [replace_tokens(item, vault, fixture_root, outside_dir) for item in value]
    if not isinstance(value, str):
        return value
    replacements = {
        "__ABSOLUTE_TARGET__": str(fixture_root / "absolute-target.md"),
        "__OUTSIDE_DIRECTORY__": str(outside_dir),
    }
    result = value
    for token, replacement in replacements.items():
        result = result.replace(token, replacement)
    return result


def normalize_machine_text(value: str, vault: Path, fixture_root: Path) -> str:
    normalized = value.replace(str(vault), FIXTURE_VAULT_TOKEN)
    normalized = normalized.replace(str(fixture_root), FIXTURE_ROOT_TOKEN)
    return normalized


def collect_regular_files(root: Path) -> dict[str, bytes]:
    files: dict[str, bytes] = {}
    if not root.exists():
        return files
    for path in sorted(root.rglob("*")):
        if path.is_symlink() or not path.is_file():
            continue
        files[path.relative_to(root).as_posix()] = path.read_bytes()
    return files


def run_case(
    renderer: Any,
    raw_case: dict[str, Any],
    index: int,
    base_seed: int,
    fixture_root: Path,
) -> dict[str, Any]:
    case_id = str(raw_case["id"])
    vault = (fixture_root / f"vault-{index:02d}").resolve()
    outside_dir = (fixture_root / "outside").resolve()
    vault.mkdir(parents=True, exist_ok=True)
    outside_dir.mkdir(parents=True, exist_ok=True)
    (vault / "Templates").mkdir(parents=True, exist_ok=True)
    shutil.copyfile(TEMPLATE_PATH, vault / "Templates" / "Fixture Task.md")

    prepared_files = replace_tokens(raw_case.get("prepareFiles", {}), vault, fixture_root, outside_dir)
    for relative_path, content in prepared_files.items():
        target = vault / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(str(content), encoding="utf-8")

    prepared_symlinks = replace_tokens(raw_case.get("prepareSymlinks", {}), vault, fixture_root, outside_dir)
    for relative_path, link_target in prepared_symlinks.items():
        target = vault / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        os.symlink(str(link_target), target)

    spec = replace_tokens(raw_case["spec"], vault, fixture_root, outside_dir)
    spec_path = fixture_root / f"{case_id}.json"
    spec_path.write_text(stable_json(spec), encoding="utf-8")
    before = collect_regular_files(vault)

    stdout = io.StringIO()
    stderr = io.StringIO()
    exit_code = 0
    renderer.random.seed(base_seed + index)
    arguments = Namespace(
        vault=str(vault),
        profile_file=str(PROFILE_PATH),
        spec=str(spec_path),
        write=raw_case.get("write") is True,
        overwrite=raw_case.get("overwrite") is True,
    )
    try:
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            renderer.command_create(arguments)
    except SystemExit as error:
        exit_code = error.code if isinstance(error.code, int) else 1
        if error.code and not isinstance(error.code, int):
            stderr.write(f"{error.code}\n")
    except Exception as error:  # pragma: no cover - evidence captures unexpected renderer failures
        exit_code = 1
        stderr.write(f"{type(error).__name__}: {error}\n")

    after = collect_regular_files(vault)
    changed_files: dict[str, str] = {}
    for relative_path, content in after.items():
        if before.get(relative_path) == content:
            continue
        changed_files[relative_path] = content.decode("utf-8")

    normalized_stdout = normalize_machine_text(stdout.getvalue(), vault, fixture_root)
    normalized_stderr = normalize_machine_text(stderr.getvalue(), vault, fixture_root)
    normalized_spec = replace_tokens(raw_case["spec"], Path(FIXTURE_VAULT_TOKEN), Path(FIXTURE_ROOT_TOKEN), Path(FIXTURE_ROOT_TOKEN) / "outside")

    return {
        "id": case_id,
        "seed": base_seed + index,
        "request": normalized_spec,
        "invocation": {
            "write": raw_case.get("write") is True,
            "overwrite": raw_case.get("overwrite") is True,
        },
        "exitCode": exit_code,
        "stdout": normalized_stdout,
        "stderr": normalized_stderr,
        "writtenFiles": changed_files,
    }


def replace_generated_root() -> None:
    if GENERATED_ROOT.exists():
        shutil.rmtree(GENERATED_ROOT)
    GENERATED_ROOT.mkdir(parents=True, exist_ok=True)


def write_case(case: dict[str, Any]) -> dict[str, Any]:
    case_dir = GENERATED_ROOT / case["id"]
    case_dir.mkdir(parents=True, exist_ok=True)
    (case_dir / "request.json").write_text(stable_json(case["request"]), encoding="utf-8")
    (case_dir / "stdout.txt").write_text(case["stdout"], encoding="utf-8")
    (case_dir / "stderr.txt").write_text(case["stderr"], encoding="utf-8")

    written_digests: dict[str, str] = {}
    for relative_path, content in case["writtenFiles"].items():
        target = case_dir / "written" / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        written_digests[relative_path] = sha256_bytes(content.encode("utf-8"))

    execution = {
        "fixtureSchemaVersion": 1,
        "caseId": case["id"],
        "seed": case["seed"],
        "invocation": case["invocation"],
        "exitCode": case["exitCode"],
        "requestSha256": sha256_bytes(stable_json(case["request"]).encode("utf-8")),
        "stdoutSha256": sha256_bytes(case["stdout"].encode("utf-8")),
        "stderrSha256": sha256_bytes(case["stderr"].encode("utf-8")),
        "writtenFiles": written_digests,
    }
    (case_dir / "execution.json").write_text(stable_json(execution), encoding="utf-8")
    return execution


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--legacy-script", required=True, type=Path)
    args = parser.parse_args()
    legacy_script = args.legacy_script.expanduser().resolve()
    if not legacy_script.is_file():
        raise SystemExit(f"legacy renderer not found: {legacy_script}")

    catalog = load_json(CATALOG_PATH)
    cases = catalog.get("cases")
    if not isinstance(cases, list) or not cases:
        raise SystemExit("legacy case catalog has no cases")
    base_seed = int(catalog["seed"])
    renderer = import_legacy_renderer(legacy_script)

    replace_generated_root()
    executions: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory(prefix="operon-phase1-fixtures-") as temp:
        fixture_root = Path(temp).resolve()
        for index, raw_case in enumerate(cases):
            if not isinstance(raw_case, dict):
                raise SystemExit(f"case {index} is not an object")
            executions.append(write_case(run_case(renderer, raw_case, index, base_seed, fixture_root)))

    manifest = {
        "fixtureSchemaVersion": 1,
        "generator": "generate_legacy_fixtures.py",
        "generatorSha256": sha256_file(GENERATOR_PATH),
        "legacyRendererSha256": sha256_file(legacy_script),
        "profileSha256": sha256_file(PROFILE_PATH),
        "catalogSha256": sha256_file(CATALOG_PATH),
        "templateSha256": sha256_file(TEMPLATE_PATH),
        "fixedTimestamp": catalog["fixedTimestamp"],
        "caseCount": len(executions),
        "cases": executions,
    }
    (GENERATED_ROOT / "manifest.json").write_text(stable_json(manifest), encoding="utf-8")
    print(f"Generated {len(executions)} sanitized legacy cases in {GENERATED_ROOT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
