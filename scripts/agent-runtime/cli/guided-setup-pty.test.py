#!/usr/bin/env python3

import json
import os
import pty
import select
import shutil
import sys
import tempfile
import time


def run_case(executable, cwd, config_home, args, exchanges, expected_exit):
    transcript = bytearray()
    pid, fd = pty.fork()
    if pid == 0:
        environment = dict(os.environ)
        environment["OPERON_CONFIG_HOME"] = config_home
        environment["HOME"] = os.path.dirname(config_home)
        environment["TERM"] = "xterm-256color"
        os.chdir(cwd)
        os.execve(executable, [executable, *args], environment)
    try:
        for expected, answer in exchanges:
            read_until(fd, transcript, expected.encode())
            os.write(fd, answer.encode())
        status = wait_for_exit(pid, fd, transcript)
        actual_exit = os.waitstatus_to_exitcode(status)
        if actual_exit != expected_exit:
            raise AssertionError(
                f"Expected exit {expected_exit}, got {actual_exit}.\n"
                + transcript.decode(errors="replace")
            )
        return transcript.decode(errors="replace")
    finally:
        try:
            os.close(fd)
        except OSError:
            pass


def read_until(fd, transcript, expected, timeout=10.0):
    deadline = time.monotonic() + timeout
    while transcript.find(expected) < 0:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise AssertionError(
                f"Timed out waiting for {expected!r}.\n"
                + transcript.decode(errors="replace")
            )
        ready, _, _ = select.select([fd], [], [], min(0.25, remaining))
        if ready:
            transcript.extend(os.read(fd, 65536))


def wait_for_exit(pid, fd, transcript, timeout=15.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        finished, status = os.waitpid(pid, os.WNOHANG)
        if finished == pid:
            return status
        ready, _, _ = select.select([fd], [], [], 0.1)
        if ready:
            try:
                transcript.extend(os.read(fd, 65536))
            except OSError:
                pass
    os.kill(pid, 9)
    os.waitpid(pid, 0)
    raise AssertionError("Guided setup PTY process did not exit.")


def create_vault(root, name):
    vault = os.path.join(root, name)
    plugin = os.path.join(vault, ".obsidian", "plugins", "operon")
    os.makedirs(plugin)
    with open(os.path.join(plugin, "manifest.json"), "w", encoding="utf-8") as handle:
        json.dump(
            {"id": "operon", "name": "Operon", "version": "2.6.0", "minAppVersion": "1.8.9"},
            handle,
        )
    return vault


def read_config(config_home):
    with open(os.path.join(config_home, "config-v1.json"), encoding="utf-8") as handle:
        return json.load(handle)


def main():
    if len(sys.argv) != 2:
        raise AssertionError("Expected the installed Operon executable path.")
    executable = os.path.realpath(sys.argv[1])
    root = tempfile.mkdtemp(prefix="operon-guided-setup-pty-")
    try:
        vault = create_vault(root, "Guided Vault")
        nested = os.path.join(vault, "Projects")
        os.makedirs(nested)

        discovered_config = os.path.join(root, "discovered-config")
        output = run_case(
            executable,
            nested,
            discovered_config,
            ["setup"],
            [
                ("Use this vault? [Y/n]", "\n"),
                ("Verify live Runtime now? [Y/n]", "n\n"),
            ],
            0,
        )
        config = read_config(discovered_config)
        assert config["defaultProfile"] == "guided-vault"
        assert config["profiles"][0]["canonicalPath"] == os.path.realpath(vault)
        assert "Profile saved as default" in output

        cancel_config = os.path.join(root, "cancel-config")
        output = run_case(
            executable,
            root,
            cancel_config,
            ["setup"],
            [("Exact Obsidian vault path, or q to cancel:", "q\n")],
            0,
        )
        assert "Operon setup cancelled" in output
        assert not os.path.exists(os.path.join(cancel_config, "config-v1.json"))

        fake_obsidian = os.path.join(root, "fake-obsidian")
        with open(fake_obsidian, "w", encoding="utf-8") as handle:
            handle.write("#!/bin/sh\nexit 1\n")
        os.chmod(fake_obsidian, 0o755)
        live_config = os.path.join(root, "live-config")
        output = run_case(
            executable,
            vault,
            live_config,
            ["setup", "--obsidian-bin", fake_obsidian],
            [
                ("Use this vault? [Y/n]", "\n"),
                ("Verify live Runtime now? [Y/n]", "\n"),
            ],
            3,
        )
        assert "Local setup saved; live verification incomplete" in output
        assert read_config(live_config)["defaultProfile"] == "guided-vault"
        print("Operon CLI guided setup PTY tests passed.")
        return 0
    finally:
        shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
