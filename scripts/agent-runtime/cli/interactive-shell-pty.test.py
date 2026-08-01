#!/usr/bin/env python3

import os
import pty
import json
import select
import shutil
import subprocess
import sys
import tempfile
import time


def read_until(
    fd: int,
    transcript: bytearray,
    expected: bytes,
    offset: int,
    timeout: float = 10.0,
) -> int:
    deadline = time.monotonic() + timeout
    while True:
        found = transcript.find(expected, offset)
        if found >= 0:
            return found + len(expected)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise AssertionError(f"Timed out waiting for {expected!r}.\n{transcript.decode(errors='replace')}")
        ready, _, _ = select.select([fd], [], [], min(0.25, remaining))
        if not ready:
            continue
        chunk = os.read(fd, 65536)
        if not chunk:
            raise AssertionError(f"PTY closed before {expected!r}.\n{transcript.decode(errors='replace')}")
        transcript.extend(chunk)


def send(fd: int, value: bytes) -> None:
    os.write(fd, value)


def main() -> int:
    if len(sys.argv) != 2:
        raise AssertionError("Expected the built Operon CLI executable path.")
    executable = os.path.realpath(sys.argv[1])
    version_result = subprocess.run(
        [executable, "version", "--json"],
        check=True,
        capture_output=True,
        text=True,
    )
    expected_version = json.loads(version_result.stdout)["result"]["version"]
    root = tempfile.mkdtemp(prefix="operon-shell-pty-")
    transcript = bytearray()
    try:
        vault = os.path.join(root, "vault")
        plugin_dir = os.path.join(vault, ".obsidian", "plugins", "operon")
        os.makedirs(plugin_dir)
        with open(os.path.join(plugin_dir, "manifest.json"), "w", encoding="utf-8") as handle:
            json.dump({"id": "operon", "name": "Operon", "version": "2.6.0"}, handle)
        marker = os.path.join(root, "fake-obsidian-invocation.json")
        fake_obsidian = os.path.join(root, "fake-obsidian.mjs")
        with open(fake_obsidian, "w", encoding="utf-8") as handle:
            handle.write(
                "#!/usr/bin/env node\n"
                "import { writeFileSync } from 'node:fs';\n"
                "writeFileSync(process.env.OPERON_SHELL_PTY_MARKER, JSON.stringify(process.argv.slice(2)));\n"
                "process.on('SIGTERM', () => process.exit(0));\n"
                "setInterval(() => undefined, 1000);\n"
            )
        os.chmod(fake_obsidian, 0o755)
        config_root = os.path.join(root, "config")
        os.makedirs(config_root, mode=0o700)
        update_cache = os.path.join(config_root, "update-check-v1.json")
        with open(update_cache, "w", encoding="utf-8") as handle:
            json.dump(
                {
                    "version": 1,
                    "checkedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "status": "success",
                    "distTags": {"latest": "999.0.0"},
                },
                handle,
            )
        os.chmod(update_cache, 0o600)
        pid, fd = pty.fork()
        if pid == 0:
            environment = dict(os.environ)
            environment["OPERON_CONFIG_HOME"] = config_root
            environment["OPERON_SHELL_PTY_MARKER"] = marker
            environment["HOME"] = root
            environment["TERM"] = "xterm-256color"
            os.execve(executable, [executable], environment)

        prompt = b"operon[unresolved]> "
        cursor = read_until(
            fd,
            transcript,
            f"Update available! {expected_version} ".encode(),
            0,
        )
        cursor = read_until(fd, transcript, b"npm install --global @stratejya/operon-cli", cursor)
        cursor = read_until(fd, transcript, f"Operon CLI {expected_version}".encode(), cursor)
        cursor = read_until(fd, transcript, prompt, cursor)

        send(fd, b"help\n")
        cursor = read_until(fd, transcript, b"System and setup:", cursor)
        cursor = read_until(fd, transcript, prompt, cursor)

        send(fd, b"unknown phase4-secret\n")
        cursor = read_until(fd, transcript, b'Unknown command "unknown"', cursor)
        cursor = read_until(fd, transcript, prompt, cursor)

        send(fd, b"\x1b[A\n")
        cursor = read_until(fd, transcript, b"System and setup:", cursor)
        cursor = read_until(fd, transcript, prompt, cursor)

        send(fd, b"ta")
        time.sleep(0.1)
        send(fd, b"\t")
        time.sleep(0.2)
        send(fd, b"\n")
        cursor = read_until(fd, transcript, b"Operon task commands", cursor)
        cursor = read_until(fd, transcript, prompt, cursor)

        send(fd, b"task ")
        send(fd, b"\t\t")
        cursor = read_until(fd, transcript, b"create", cursor)
        cursor = read_until(fd, transcript, b"update", cursor)
        send(fd, b"\x15\n")
        time.sleep(0.2)

        send(fd, b"query --input -\n")
        cursor = read_until(
            fd,
            transcript,
            b"stdin input is unavailable inside the Operon shell.",
            cursor,
        )
        cursor = read_until(fd, transcript, prompt, cursor)

        send(fd, b"partial")
        send(fd, b"\x03")
        cursor = read_until(fd, transcript, prompt, cursor)
        send(fd, b"version\n")
        cursor = read_until(fd, transcript, f"operon-cli {expected_version}".encode(), cursor)
        cursor = read_until(fd, transcript, prompt, cursor)

        send(
            fd,
            f"health --vault {vault} --obsidian-bin {fake_obsidian}\n".encode(),
        )
        deadline = time.monotonic() + 5.0
        while not os.path.exists(marker) and time.monotonic() < deadline:
            time.sleep(0.02)
        if not os.path.exists(marker):
            raise AssertionError("The active shell command never reached the fake Obsidian process.")
        with open(marker, encoding="utf-8") as handle:
            arguments = json.load(handle)
        request_token = next(
            value.removeprefix("requestToken=")
            for value in arguments
            if value.startswith("requestToken=")
        )
        send(fd, b"stale-edit-buffer")
        send(fd, b"\x03")
        cursor = read_until(fd, transcript, b"Command cancelled.", cursor)
        cursor = read_until(fd, transcript, prompt, cursor)
        request_root = os.path.join(
            tempfile.gettempdir(),
            f"operon-agent-runtime-uid-{os.getuid()}",
        )
        request_path = os.path.join(request_root, f"{request_token}.request.json")
        if os.path.exists(request_path):
            raise AssertionError(f"Interrupted shell command left a request file: {request_path}")
        send(fd, b"version\n")
        cursor = read_until(fd, transcript, f"operon-cli {expected_version}".encode(), cursor)
        cursor = read_until(fd, transcript, prompt, cursor)

        send(fd, b"\x04")
        deadline = time.monotonic() + 10.0
        status = None
        while time.monotonic() < deadline:
            finished, candidate = os.waitpid(pid, os.WNOHANG)
            if finished == pid:
                status = candidate
                break
            ready, _, _ = select.select([fd], [], [], 0.1)
            if ready:
                try:
                    transcript.extend(os.read(fd, 65536))
                except OSError:
                    pass
        if status is None:
            os.kill(pid, 9)
            os.waitpid(pid, 0)
            raise AssertionError("Interactive shell did not exit after Ctrl+D.")
        if os.waitstatus_to_exitcode(status) != 0:
            raise AssertionError(f"Interactive shell exited with {status}.\n{transcript.decode(errors='replace')}")

        rendered = transcript.decode(errors="replace")
        if rendered.count("phase4-secret") != 1:
            raise AssertionError(f"Sensitive history entry was recalled.\n{rendered}")
        created_files = [
            os.path.join(directory, name)
            for directory, _, names in os.walk(root)
            for name in names
        ]
        expected_fixture_files = {
            marker,
            fake_obsidian,
            update_cache,
            os.path.join(plugin_dir, "manifest.json"),
        }
        unexpected_files = sorted(set(created_files) - expected_fixture_files)
        if unexpected_files:
            raise AssertionError(f"Interactive shell persisted unexpected files: {unexpected_files}")
        print("Operon CLI interactive shell PTY test passed.")
        return 0
    finally:
        shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
