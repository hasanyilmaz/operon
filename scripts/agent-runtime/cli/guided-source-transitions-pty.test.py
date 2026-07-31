#!/usr/bin/env python3

import json
import os
import pty
import select
import shutil
import sys
import tempfile
import time
from typing import Optional


def read_until(
    fd: int,
    transcript: bytearray,
    expected: bytes,
    offset: int,
    timeout: float = 15.0,
) -> int:
    deadline = time.monotonic() + timeout
    while True:
        found = transcript.find(expected, offset)
        if found >= 0:
            return found + len(expected)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise AssertionError(
                f"Timed out waiting for {expected!r}.\n"
                f"{transcript.decode(errors='replace')}"
            )
        ready, _, _ = select.select([fd], [], [], min(0.25, remaining))
        if not ready:
            continue
        chunk = os.read(fd, 65536)
        if not chunk:
            raise AssertionError(
                f"PTY closed before {expected!r}.\n"
                f"{transcript.decode(errors='replace')}"
            )
        transcript.extend(chunk)


def send(fd: int, value: str) -> None:
    os.write(fd, value.encode())


def wait_for_exit(pid: int, fd: int, transcript: bytearray) -> int:
    deadline = time.monotonic() + 15.0
    while time.monotonic() < deadline:
        finished, status = os.waitpid(pid, os.WNOHANG)
        if finished == pid:
            return os.waitstatus_to_exitcode(status)
        ready, _, _ = select.select([fd], [], [], 0.1)
        if ready:
            try:
                transcript.extend(os.read(fd, 65536))
            except OSError:
                pass
    os.kill(pid, 9)
    os.waitpid(pid, 0)
    raise AssertionError("Guided source-transition PTY did not exit.")


def prepare_vault(root: str) -> tuple[str, str]:
    vault = os.path.join(root, "vault")
    plugin_dir = os.path.join(vault, ".obsidian", "plugins", "operon")
    os.makedirs(plugin_dir)
    with open(
        os.path.join(plugin_dir, "manifest.json"),
        "w",
        encoding="utf-8",
    ) as handle:
        json.dump(
            {
                "id": "operon",
                "name": "Operon",
                "version": "2.6.0",
                "minAppVersion": "1.8.9",
            },
            handle,
        )
    return vault, os.path.join(root, "config")


def run_pty(
    executable: str,
    responder: str,
    root: str,
    scenario: str,
    arguments: list[str],
    steps: list[tuple[bytes, str]],
    expected_exit: Optional[int] = 0,
) -> str:
    transcript = bytearray()
    vault = os.path.join(root, "vault")
    config = os.path.join(root, "config")
    trace = os.path.join(root, "responder-trace.jsonl")
    state = os.path.join(root, "recovery-state")
    target_arguments = [] if arguments[:2] == ["plan", "recover"] else [
        "--vault",
        vault,
    ]
    pid, fd = pty.fork()
    if pid == 0:
        environment = dict(os.environ)
        environment["OPERON_CONFIG_HOME"] = config
        environment["HOME"] = root
        environment["TERM"] = "xterm-256color"
        environment["OPERON_PHASE7_PTY_TRACE"] = trace
        environment["OPERON_PHASE7_PTY_SCENARIO"] = scenario
        environment["OPERON_PHASE7_PTY_STATE"] = state
        os.execve(
            executable,
            [
                executable,
                *arguments,
                *target_arguments,
                "--obsidian-bin",
                responder,
            ],
            environment,
        )
    cursor = 0
    for expected, answer in steps:
        cursor = read_until(fd, transcript, expected, cursor)
        send(fd, answer)
    exit_code = wait_for_exit(pid, fd, transcript)
    rendered = transcript.decode(errors="replace")
    if expected_exit is not None and exit_code != expected_exit:
        raise AssertionError(
            f"{scenario} exited {exit_code}, expected {expected_exit}.\n{rendered}"
        )
    return rendered


def task_picker_steps() -> list[tuple[bytes, str]]:
    return [
        (b"Search (blank shows current open tasks, q cancels): ", "\n"),
        (b"Choose 1-1", "1\n"),
    ]


def placement_steps() -> list[tuple[bytes, str]]:
    return [
        (b"Search target notes (blank lists candidates, q cancels): ", "\n"),
        (b"Target note:", ""),
        (b"> ", "\n"),
        (b"Exact blank target line:", ""),
        (b"> ", "\n"),
    ]


def assert_safe_semantic_transcript(rendered: str, word: str) -> None:
    for secret in ("receiptTargetDigest", "confirmationToken"):
        if secret in rendered:
            raise AssertionError(f"Guided output exposed {secret!r}.\n{rendered}")
    if "current-plan" in rendered:
        raise AssertionError(f"Guided output exposed a fake plan reference.\n{rendered}")
    if rendered.count("Operon mutation plan") != 1:
        raise AssertionError(f"Guided output must render one reviewed plan.\n{rendered}")
    if f"Type {word} to confirm this exact reviewed plan:" not in rendered:
        raise AssertionError(f"Guided output did not request {word}.\n{rendered}")


def assert_no_plans(root: str) -> None:
    plans_root = os.path.join(root, "config", "plans")
    plan_names = os.listdir(plans_root) if os.path.isdir(plans_root) else []
    if plan_names:
        raise AssertionError(f"Expected no retained plans, received {plan_names!r}.")


def assert_terminal_tombstone(root: str) -> None:
    plans_root = os.path.join(root, "config", "plans")
    plan_names = os.listdir(plans_root) if os.path.isdir(plans_root) else []
    if len(plan_names) != 1:
        raise AssertionError(
            f"Expected one terminal recovery tombstone, received {plan_names!r}."
        )
    with open(os.path.join(plans_root, plan_names[0]), encoding="utf-8") as handle:
        record = json.load(handle)
    terminal = record.get("terminalResult")
    if not isinstance(terminal, dict) or terminal.get("status") not in (
        "applied",
        "already-applied",
    ):
        raise AssertionError(f"Expected a terminal applied receipt, received {terminal!r}.")
    if not isinstance(record.get("applyRequest"), dict):
        raise AssertionError("Terminal recovery tombstone did not retain the apply request.")


def assert_request_cleanup(requests_before: set[str]) -> None:
    request_root = os.path.join(
        tempfile.gettempdir(),
        f"operon-agent-runtime-uid-{os.getuid()}",
    )
    leftovers = [
        name
        for name in os.listdir(request_root)
        if name.endswith(".request.json") and name not in requests_before
    ] if os.path.isdir(request_root) else []
    if leftovers:
        raise AssertionError(f"Guided PTY left request files: {leftovers!r}.")


def run_applied_flows(executable: str, responder: str, outer_root: str) -> None:
    same_root = os.path.join(outer_root, "relocate-same")
    prepare_vault(same_root)
    same = run_pty(
        executable,
        responder,
        same_root,
        "relocate-same",
        ["task", "relocate"],
        [
            *task_picker_steps(),
            *placement_steps(),
            (b"Preview this move? [Y/n] ", "\n"),
            (b"Apply this unchanged plan? [y/N] ", "y\n"),
            (b"Status: applied", ""),
        ],
    )
    if "Type MOVE" in same:
        raise AssertionError(f"Routine same-file relocation requested MOVE.\n{same}")
    assert_terminal_tombstone(same_root)

    cross_root = os.path.join(outer_root, "relocate-cross")
    prepare_vault(cross_root)
    cross = run_pty(
        executable,
        responder,
        cross_root,
        "relocate-cross",
        ["task", "relocate"],
        [
            *task_picker_steps(),
            *placement_steps(),
            (b"Preview this move? [Y/n] ", "\n"),
            (b"Type MOVE to confirm this exact reviewed plan: ", "MOVE\n"),
            (b"Status: applied", ""),
        ],
    )
    assert_safe_semantic_transcript(cross, "MOVE")
    assert_terminal_tombstone(cross_root)

    inline_root = os.path.join(outer_root, "convert-inline")
    prepare_vault(inline_root)
    inline = run_pty(
        executable,
        responder,
        inline_root,
        "convert-inline",
        ["task", "convert"],
        [
            *task_picker_steps(),
            (b"File Task template:", ""),
            (b"> ", "\n"),
            (b"Use the configured File Task target and generated name? [Y/n] ", "\n"),
            (b"Preview this conversion? [Y/n] ", "\n"),
            (b"Apply this unchanged plan? [y/N] ", "y\n"),
            (b"Status: applied", ""),
        ],
    )
    if "Type CONVERT" in inline:
        raise AssertionError(f"Routine inline-to-file conversion requested CONVERT.\n{inline}")
    assert_terminal_tombstone(inline_root)

    file_root = os.path.join(outer_root, "convert-file")
    prepare_vault(file_root)
    file_to_inline = run_pty(
        executable,
        responder,
        file_root,
        "convert-file",
        ["task", "convert"],
        [
            *task_picker_steps(),
            *placement_steps(),
            (b"Create a destructive preview? [y/N] ", "y\n"),
            (b"Type CONVERT to confirm this exact reviewed plan: ", "CONVERT\n"),
            (b"Status: applied", ""),
        ],
    )
    assert_safe_semantic_transcript(file_to_inline, "CONVERT")
    assert_terminal_tombstone(file_root)

    delete_root = os.path.join(outer_root, "delete")
    prepare_vault(delete_root)
    deleted = run_pty(
        executable,
        responder,
        delete_root,
        "delete",
        ["task", "delete"],
        [
            *task_picker_steps(),
            (b"Preview this exact deletion? [y/N] ", "y\n"),
            (b"Type DELETE to confirm this exact reviewed plan: ", "DELETE\n"),
            (b"Status: applied", ""),
        ],
    )
    assert_safe_semantic_transcript(deleted, "DELETE")
    assert_terminal_tombstone(delete_root)

    timer_root = os.path.join(outer_root, "timer-session-remove")
    prepare_vault(timer_root)
    removed_session = run_pty(
        executable,
        responder,
        timer_root,
        "timer-session-remove",
        [
            "timer",
            "session",
            "remove",
            "--id",
            "abc1234",
            "--session",
            "1",
        ],
        [
            (b"Type REMOVE to confirm this exact reviewed plan: ", "REMOVE\n"),
            (b"Status: applied", ""),
        ],
    )
    assert_safe_semantic_transcript(removed_session, "REMOVE")
    assert_terminal_tombstone(timer_root)


def create_uncertain_plan(
    executable: str,
    responder: str,
    root: str,
    scenario: str,
) -> str:
    prepare_vault(root)
    rendered = run_pty(
        executable,
        responder,
        root,
        scenario,
        ["task", "delete"],
        [
            *task_picker_steps(),
            (b"Preview this exact deletion? [y/N] ", "y\n"),
            (b"Type DELETE to confirm this exact reviewed plan: ", "DELETE\n"),
            (b"operon plan recover ", ""),
        ],
        expected_exit=None,
    )
    plans_root = os.path.join(root, "config", "plans")
    plans = os.listdir(plans_root)
    if len(plans) != 1:
        raise AssertionError(f"Expected one uncertain plan, received {plans!r}.")
    return rendered


def run_recovery_flows(executable: str, responder: str, outer_root: str) -> None:
    recover_root = os.path.join(outer_root, "recover")
    create_uncertain_plan(executable, responder, recover_root, "recovery-recover")
    recovered = run_pty(
        executable,
        responder,
        recover_root,
        "recovery-recover",
        ["plan", "recover"],
        [
            (b"Select a plan number, or q to cancel: ", "1\n"),
            (
                b"Enter r to recover the same idempotent apply, a to abandon recovery, or q to cancel: ",
                "r\n",
            ),
            (b"Status: applied", ""),
        ],
    )
    if "Type DELETE" in recovered:
        raise AssertionError(f"Same-plan recovery requested new mutation confirmation.\n{recovered}")
    assert_terminal_tombstone(recover_root)

    abandon_root = os.path.join(outer_root, "abandon")
    create_uncertain_plan(executable, responder, abandon_root, "recovery-abandon")
    abandoned = run_pty(
        executable,
        responder,
        abandon_root,
        "recovery-abandon",
        ["plan", "recover"],
        [
            (b"Select a plan number, or q to cancel: ", "1\n"),
            (
                b"Enter r to recover the same idempotent apply, a to abandon recovery, or q to cancel: ",
                "a\n",
            ),
            (b"Type ABANDON to remove this recovery record: ", "ABANDON\n"),
            (b"Abandoned recovery for Operon plan", ""),
        ],
    )
    if "even if the mutation may have applied" not in abandoned:
        raise AssertionError(f"ABANDON did not preserve uncertainty warning.\n{abandoned}")
    assert_no_plans(abandon_root)


def main() -> int:
    if len(sys.argv) != 3:
        raise AssertionError("Expected built Operon CLI and responder paths.")
    executable = os.path.realpath(sys.argv[1])
    responder = os.path.realpath(sys.argv[2])
    outer_root = tempfile.mkdtemp(prefix="operon-phase7-guided-pty-")
    request_root = os.path.join(
        tempfile.gettempdir(),
        f"operon-agent-runtime-uid-{os.getuid()}",
    )
    requests_before = set(os.listdir(request_root)) if os.path.isdir(request_root) else set()
    try:
        run_applied_flows(executable, responder, outer_root)
        run_recovery_flows(executable, responder, outer_root)
        assert_request_cleanup(requests_before)
        print("Operon CLI guided source-transition PTY tests passed.")
        return 0
    except Exception as error:
        traces = []
        for directory, _, names in os.walk(outer_root):
            if "responder-trace.jsonl" in names:
                path = os.path.join(directory, "responder-trace.jsonl")
                with open(path, encoding="utf-8") as handle:
                    traces.append(f"{path}: {handle.read()}")
        if traces:
            raise AssertionError(f"{error}\nResponder traces:\n" + "\n".join(traces)) from error
        raise
    finally:
        shutil.rmtree(outer_root, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
