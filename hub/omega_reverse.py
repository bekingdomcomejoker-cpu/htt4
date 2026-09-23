#!/usr/bin/env python3
"""Reverse-connect this Termux node to the Omega VPS hub."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

HUB_URL = os.environ.get("OMEGA_HUB_URL", "").rstrip("/")
HUB_KEY = os.environ.get("OMEGA_HUB_KEY", "")
NODE = os.environ.get("OMEGA_NODE_ID", "termux")
LOG = os.environ.get("OMEGA_REVERSE_LOG", os.path.expanduser("~/.omega-reverse.log"))

TERMUX_TOOLS = [
    {
        "name": "termux_exec",
        "description": "Run a short shell command on the connected Termux phone.",
        "inputSchema": {
            "type": "object",
            "properties": {"command": {"type": "string"}, "timeout": {"type": "integer"}},
            "required": ["command"],
        },
    },
    {
        "name": "battery_status",
        "description": "Read the Termux phone battery status.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "connector_health",
        "description": "Read Termux connector health.",
        "inputSchema": {"type": "object", "properties": {}},
    },
]


def die(msg: str) -> None:
    print(f"[omega-reverse] {msg}", file=sys.stderr)
    sys.exit(1)


def daemonize() -> None:
    try:
        if os.fork() > 0:
            os._exit(0)
    except OSError:
        return
    os.setsid()
    try:
        if os.fork() > 0:
            os._exit(0)
    except OSError:
        return
    sys.stdout.flush()
    sys.stderr.flush()
    log = open(LOG, "ab", buffering=0)
    os.dup2(log.fileno(), 1)
    os.dup2(log.fileno(), 2)
    devnull = os.open("/dev/null", os.O_RDONLY)
    os.dup2(devnull, 0)


def req(method: str, path: str, payload: dict | None = None, timeout: int = 30):
    url = f"{HUB_URL}{path}"
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-API-Key": HUB_KEY,
        "ngrok-skip-browser-warning": "true",
        "User-Agent": "omega-reverse/1.0",
    }
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8") or "{}"
        return json.loads(raw)


def run_cmd(command: str, timeout: int = 20) -> dict:
    try:
        p = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return {
            "ok": p.returncode == 0,
            "code": p.returncode,
            "stdout": (p.stdout or "")[:24000],
            "stderr": (p.stderr or "")[:4000],
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def handle_job(job: dict) -> dict:
    tool = job.get("tool") or ""
    args = job.get("args") or {}
    if tool in ("termux_exec", "sandbox_exec", "exec"):
        return run_cmd(str(args.get("command") or "uname -a"), int(args.get("timeout") or 20))
    if tool in ("hub_echo", "echo"):
        return {"echoed": args.get("message"), "node": NODE}
    if tool == "battery_status":
        return run_cmd("termux-battery-status || echo '{}'")
    if tool in ("ping", "hub_ping"):
        return {"pong": True, "node": NODE, "pid": os.getpid()}
    return run_cmd(str(args.get("command") or "echo reverse-ok"))


def main() -> None:
    if not HUB_URL or not HUB_KEY:
        die("OMEGA_HUB_URL and OMEGA_HUB_KEY are required")
    if "--daemon" in sys.argv:
        daemonize()
    print(f"[omega-reverse] connecting {NODE} -> {HUB_URL}", flush=True)
    hello = req(
        "POST",
        "/v1/reverse/hello",
        {"node": NODE, "role": "phone", "tools": TERMUX_TOOLS},
    )
    print("[omega-reverse] hub accepted", json.dumps(hello.get("hub", {}))[:500], flush=True)
    echoed = req(
        "POST",
        "/mcp",
        {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": "hub_echo",
                "arguments": {
                    "message": f"{NODE} reverse-connected pid={os.getpid()}"
                },
            },
        },
    )
    print("[omega-reverse] hub_echo", json.dumps(echoed)[:400], flush=True)
    while True:
        try:
            req("POST", "/v1/reverse/heartbeat", {"node": NODE}, timeout=10)
            waited = req("POST", "/v1/reverse/wait", {"node": NODE}, timeout=25)
            for job in waited.get("jobs") or []:
                print("[omega-reverse] job", job.get("id"), job.get("tool"), flush=True)
                result = handle_job(job)
                req(
                    "POST",
                    "/v1/reverse/result",
                    {"node": NODE, "jobId": job.get("id"), "result": result},
                    timeout=10,
                )
        except urllib.error.HTTPError as exc:
            print("[omega-reverse] http", exc.code, exc.reason, flush=True)
            time.sleep(2)
        except Exception as exc:
            print("[omega-reverse] retry:", exc, flush=True)
            time.sleep(3)


if __name__ == "__main__":
    main()
