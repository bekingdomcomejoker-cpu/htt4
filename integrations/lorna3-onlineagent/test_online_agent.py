"""Offline regression coverage for the Termux-only Online Agent adapter.

The test harness supplies lightweight stand-ins for LORNA's runtime modules and
the authenticated MCP client. No phone, token, or Forge request is needed.
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import types
import unittest
from pathlib import Path
from typing import Any


ADAPTER_PATH = Path(__file__).with_name("online_agent.py")
MODULE_NAMES = ("adapters", "adapters.base", "config", "config.errors", "mcp_client", "online_agent_under_test")


class BrowserReply:
    def __init__(self, node: int, provider: str, text: str, source: str, elapsed_ms: int, code: str | None = None):
        self.node = node
        self.provider = provider
        self.text = text
        self.source = source
        self.elapsed_ms = elapsed_ms
        self.code = code


class FakeOmegaMCPClient:
    calls: list[tuple[str, dict[str, Any]]] = []

    def initialize(self) -> dict[str, Any]:
        return {"result": {}}

    def list_tools(self) -> dict[str, Any]:
        return {
            "result": {
                "tools": [
                    {
                        "name": "lorna_remember",
                        "description": "Save a shared LORNA fact",
                        "inputSchema": {"type": "object", "properties": {"fact": {"type": "string"}}},
                    },
                    {
                        "name": "flashlight_control",
                        "description": "Control the device flashlight",
                        "inputSchema": {"type": "object", "properties": {"state": {"type": "string"}}},
                    },
                ]
            }
        }

    def call(self, name: str, arguments: dict[str, Any] | None = None, timeout: int = 120) -> str:
        del timeout
        type(self).calls.append((name, arguments or {}))
        if name == "flashlight_control":
            return f"Flashlight turned {arguments['state']}."
        if name == "lorna_remember":
            return "Shared LORNA memory saved."
        return f"{name} completed."


def load_adapter() -> tuple[types.ModuleType, dict[str, types.ModuleType | None]]:
    previous = {name: sys.modules.get(name) for name in MODULE_NAMES}

    adapters = types.ModuleType("adapters")
    adapters.__path__ = []  # type: ignore[attr-defined]
    adapters_base = types.ModuleType("adapters.base")
    adapters_base.BrowserReply = BrowserReply
    adapters.base = adapters_base  # type: ignore[attr-defined]

    config = types.ModuleType("config")
    config.__path__ = []  # type: ignore[attr-defined]
    config_errors = types.ModuleType("config.errors")
    config_errors.EMPTY_PROMPT = "EMPTY_PROMPT"
    config_errors.RESPONSE_TIMEOUT = "RESPONSE_TIMEOUT"
    config_errors.UPSTREAM_ERROR = "UPSTREAM_ERROR"
    config_errors.error_reply = lambda node, provider, code: BrowserReply(node, provider, f"[{code}]", "", 0, code)
    config.errors = config_errors  # type: ignore[attr-defined]

    mcp_client = types.ModuleType("mcp_client")
    mcp_client.OmegaMCPClient = FakeOmegaMCPClient
    sys.modules.update(
        {
            "adapters": adapters,
            "adapters.base": adapters_base,
            "config": config,
            "config.errors": config_errors,
            "mcp_client": mcp_client,
        }
    )

    spec = importlib.util.spec_from_file_location("online_agent_under_test", ADAPTER_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["online_agent_under_test"] = module
    spec.loader.exec_module(module)
    return module, previous


def restore_modules(previous: dict[str, types.ModuleType | None]) -> None:
    for name, module in previous.items():
        if module is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = module


class OnlineAgentAdapterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.environment = {name: os.environ.get(name) for name in ("ONLINE_AGENT_BASE_URL", "ONLINE_AGENT_API_KEY")}
        os.environ["ONLINE_AGENT_BASE_URL"] = "https://forge.example.test"
        os.environ["ONLINE_AGENT_API_KEY"] = "test-only-key"
        FakeOmegaMCPClient.calls = []
        self.module, self.previous_modules = load_adapter()

    def tearDown(self) -> None:
        restore_modules(self.previous_modules)
        for name, value in self.environment.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    def test_memory_request_uses_the_shared_lorna_memory_tool(self) -> None:
        adapter = self.module.OnlineAgentAdapter()
        responses = [
            (
                200,
                json.dumps(
                    {
                        "choices": [
                            {
                                "message": {
                                    "role": "assistant",
                                    "content": None,
                                    "tool_calls": [
                                        {
                                            "id": "remember-1",
                                            "type": "function",
                                            "function": {
                                                "name": "lorna_remember",
                                                "arguments": json.dumps({"fact": "Turn the flashlight off after the follow-up."}),
                                            },
                                        }
                                    ],
                                }
                            }
                        ]
                    }
                ),
                None,
            ),
            (200, json.dumps({"choices": [{"message": {"role": "assistant", "content": "Memory saved."}}]}), None),
        ]
        adapter._request = lambda _payload, _timeout: responses.pop(0)

        reply = adapter.ask("Remember the flashlight follow-up preference.")

        self.assertEqual(reply.text, "Memory saved.")
        self.assertEqual(
            FakeOmegaMCPClient.calls,
            [("lorna_remember", {"fact": "Turn the flashlight off after the follow-up."})],
        )

    def test_typo_then_turn_it_off_uses_direct_flashlight_control(self) -> None:
        adapter = self.module.OnlineAgentAdapter()

        on_reply = adapter.ask("turn rhe flashloght on")
        off_reply = adapter.ask("turn it off")

        self.assertEqual(on_reply.text, "Flashlight turned on.")
        self.assertEqual(off_reply.text, "Flashlight turned off.")
        self.assertEqual(
            FakeOmegaMCPClient.calls,
            [("flashlight_control", {"state": "on"}), ("flashlight_control", {"state": "off"})],
        )


if __name__ == "__main__":
    unittest.main()
