"""Online agent adapter — local agent command surface, Forge LLM brain.

Usage (Lorna3):
  @onlineagent <prompt>
  @oa <prompt>

Usage (LORNA2 style, once registered):
  lorna2 --node onlineagent --quiet -p "<prompt>"

Default online model: Claude Sonnet 4.6 (Forge / OpenAI-compatible chat).

Env (Termux only — never commit):
  ONLINE_AGENT_MODEL   default: claude-sonnet-4-6
  ONLINE_AGENT_BASE_URL  OpenAI-compatible base, e.g. https://api.manus.im/.../v1
  ONLINE_AGENT_API_KEY   Bearer token / Forge key
  ONLINE_AGENT_SYSTEM    optional override of system prompt

Optional fallback: if ONLINE_AGENT_* is unset, tries FORGE_* / MANUS_FORGE_* names.
"""
from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from typing import Any

from adapters.base import BrowserReply
from config.errors import (
    EMPTY_PROMPT,
    RESPONSE_TIMEOUT,
    UPSTREAM_ERROR,
    error_reply,
)

ONLINE_AUTH_FAILED = "ONLINE_AGENT_AUTH_FAILED"
ONLINE_BAD_RESPONSE = "ONLINE_AGENT_BAD_RESPONSE"
ONLINE_CONFIG = "ONLINE_AGENT_CONFIG"
ONLINE_RATE_LIMITED = "ONLINE_AGENT_RATE_LIMITED"
ONLINE_REJECTED = "ONLINE_AGENT_REJECTED"

DEFAULT_MODEL = "claude-sonnet-4-6"
DEFAULT_SYSTEM = (
    "You are the operator's local OMEGA / LORNA online agent. "
    "You run on their Termux mesh with access to their home lab context. "
    "Be precise, security-conscious, and practical. "
    "Prefer split-tunnel / read-only steps before destructive network changes. "
    "Persistent memory is available through the local MCP tools. When the user asks to remember or save a fact, you MUST call lorna_remember before replying. When the user asks what is remembered, call lorna_memory_context. When the user asks to forget a named fact, call lorna_forget. Use memory to resolve follow-up references such as turn it off, but still call the relevant device tool. "
    "If you propose shell commands, mark them clearly in fenced bash blocks "
    "and assume the operator must approve execution."
)


def _env(*names: str, default: str = "") -> str:
    for name in names:
        value = (os.environ.get(name) or "").strip()
        if value:
            return value
    return default


class OnlineAgentAdapter:
    """Forge-backed inference for the local agent node surface."""

    name = "onlineagent"
    node = 11

    def __init__(self) -> None:
        self.model = _env("ONLINE_AGENT_MODEL", "FORGE_MODEL", default=DEFAULT_MODEL)
        self.base_url = _env(
            "ONLINE_AGENT_BASE_URL",
            "FORGE_BASE_URL",
            "MANUS_FORGE_BASE_URL",
            "OPENAI_BASE_URL",
            default="",
        ).rstrip("/")
        self.api_key = _env(
            "ONLINE_AGENT_API_KEY",
            "FORGE_API_KEY",
            "MANUS_FORGE_API_KEY",
            "OPENAI_API_KEY",
            default="",
        )
        self.system = _env("ONLINE_AGENT_SYSTEM", default=DEFAULT_SYSTEM)
        self.history: list[dict[str, str]] = []

    def health(self) -> dict:
        configured = bool(self.base_url and self.api_key)
        return {
            "ok": configured,
            "node": self.node,
            "provider": self.name,
            "model": self.model,
            "base_url_set": bool(self.base_url),
            "api_key_set": bool(self.api_key),
            "backend": "forge-chat-completions",
        }

    def _chat_url(self) -> str:
        base = self.base_url
        if base.endswith("/chat/completions"):
            return base
        if base.endswith("/v1"):
            return f"{base}/chat/completions"
        return f"{base}/v1/chat/completions"

    def _request(self, payload: dict[str, Any], timeout_s: int) -> tuple[int | None, str, Exception | None]:
        body = json.dumps(payload).encode("utf-8")
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }
        req = urllib.request.Request(
            self._chat_url(),
            data=body,
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout_s) as response:
                raw = response.read().decode("utf-8", "replace")
                return response.status, raw, None
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", "replace")[:2000]
            return exc.code, raw, None
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            return None, "", exc

    def ask(self, prompt: str, *, timeout_s: int = 120) -> BrowserReply:
        """Run Forge with the authenticated local MCP catalog, bounded to four rounds."""
        started = time.time()
        if not (prompt or "").strip():
            return error_reply(self.node, self.name, EMPTY_PROMPT)
        if not self.base_url or not self.api_key:
            return BrowserReply(
                self.node, self.name,
                f"[{ONLINE_CONFIG}] Set ONLINE_AGENT_BASE_URL and ONLINE_AGENT_API_KEY (model={self.model}). Keys stay on Termux only.",
                "", int((time.time() - started) * 1000), ONLINE_CONFIG,
            )
        original_prompt = prompt.strip()
        normalized_prompt = original_prompt.casefold().replace("flashloght", "flashlight")
        recent_user_text = " ".join(item["content"] for item in self.history[-6:] if item.get("role") == "user").casefold().replace("flashloght", "flashlight")
        flashlight_follow_up = bool(re.search(r"\b(off|turn it off|switch it off)\b", normalized_prompt) and "flashlight" in recent_user_text and re.search(r"\b(on|turned on|turn it on)\b", recent_user_text))
        flashlight_request = ("flashlight" in normalized_prompt or "torch" in normalized_prompt or flashlight_follow_up) and bool(re.search(r"\b(on|off|turn it on|turn it off|switch it on|switch it off)\b", normalized_prompt))
        if flashlight_request:
            state = "off" if re.search(r"\b(off|turn it off|switch it off)\b", normalized_prompt) else "on"
            try:
                from mcp_client import OmegaMCPClient
                client = OmegaMCPClient()
                client.initialize()
                result = client.call("flashlight_control", {"state": state}, timeout=10)
                self.history.extend([{"role": "user", "content": original_prompt}, {"role": "assistant", "content": result}])
                return BrowserReply(self.node, self.name, result, "local-mcp://flashlight_control", int((time.time() - started) * 1000))
            except Exception as exc:
                return BrowserReply(self.node, self.name, f"Flashlight control failed: {exc}", "local-mcp://flashlight_control", int((time.time() - started) * 1000), ONLINE_REJECTED)
        try:
            from mcp_client import OmegaMCPClient
            client = OmegaMCPClient()
            client.initialize()
            raw_tools = client.list_tools().get("result", {}).get("tools", [])
            tools = [{"type": "function", "function": {
                "name": item.get("name"),
                "description": item.get("description", ""),
                "parameters": item.get("inputSchema", {"type": "object", "properties": {}}),
            }} for item in raw_tools if item.get("name")]
        except Exception:
            # Ordinary Forge chat remains available if the local bridge is down.
            return self._ask_plain(prompt, timeout_s=timeout_s)
        messages = [
            {"role": "system", "content": self.system + " You have access to the authenticated local OMEGA MCP tools. Use them when needed; prefer read-only checks and never claim a tool result you did not receive."},
            *self.history[-6:],
            {"role": "user", "content": original_prompt},
        ]
        seen = set()
        for _ in range(4):
            payload = {"model": self.model, "messages": messages, "temperature": 0.3, "tools": tools, "tool_choice": "auto"}
            status, raw, exc = self._request(payload, max(5, min(int(timeout_s), 600)))
            if exc is not None or status is None or status >= 400:
                return self._ask_plain(prompt, timeout_s=timeout_s)
            try:
                data = json.loads(raw)
                message = (data.get("choices") or [])[0].get("message") or {}
            except (ValueError, IndexError, AttributeError):
                return self._ask_plain(prompt, timeout_s=timeout_s)
            calls = message.get("tool_calls") or []
            content = (message.get("content") or "").strip()
            if not calls:
                if content:
                    self.history.extend([{"role": "user", "content": original_prompt}, {"role": "assistant", "content": content}])
                    return BrowserReply(self.node, self.name, content, self._chat_url(), int((time.time() - started) * 1000))
                return self._ask_plain(prompt, timeout_s=timeout_s)
            messages.append({"role": "assistant", "content": message.get("content") or "", "tool_calls": calls})
            for call in calls:
                fn = call.get("function") or {}
                name = fn.get("name")
                args = fn.get("arguments") or {}
                if isinstance(args, str):
                    try:
                        args = json.loads(args)
                    except ValueError:
                        args = {}
                signature = json.dumps([name, args], sort_keys=True, default=str)
                if not name or signature in seen:
                    return BrowserReply(self.node, self.name, "Agent repeated an MCP call; stopping safely.", self._chat_url(), int((time.time() - started) * 1000))
                seen.add(signature)
                try:
                    result = client.call(name, args, timeout=min(int(timeout_s), 120))
                except Exception as tool_exc:
                    result = f"MCP tool error: {tool_exc}"
                item = {"role": "tool", "content": str(result), "name": name}
                if call.get("id"):
                    item["tool_call_id"] = call["id"]
                messages.append(item)
        return BrowserReply(self.node, self.name, "Agent stopped after the maximum MCP tool rounds.", self._chat_url(), int((time.time() - started) * 1000))

    def _ask_plain(self, prompt: str, *, timeout_s: int = 120) -> BrowserReply:
        started = time.time()
        if not (prompt or "").strip():
            return error_reply(self.node, self.name, EMPTY_PROMPT)

        if not self.base_url or not self.api_key:
            return BrowserReply(
                self.node,
                self.name,
                (
                    f"[{ONLINE_CONFIG}] Set ONLINE_AGENT_BASE_URL and ONLINE_AGENT_API_KEY "
                    f"(model={self.model}). Keys stay on Termux only."
                ),
                "",
                int((time.time() - started) * 1000),
                ONLINE_CONFIG,
            )

        timeout = max(5, min(int(timeout_s), 600))
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": self.system},
                {"role": "user", "content": prompt.strip()},
            ],
            "temperature": 0.3,
        }

        status, raw, exc = self._request(payload, timeout)
        elapsed = int((time.time() - started) * 1000)

        if exc is not None:
            reason = str(getattr(exc, "reason", exc))
            code = RESPONSE_TIMEOUT if "timed out" in reason.lower() else UPSTREAM_ERROR
            return BrowserReply(
                self.node,
                self.name,
                f"[{code}] {reason}",
                self._chat_url(),
                elapsed,
                code,
            )

        if status in (401, 403):
            return BrowserReply(
                self.node,
                self.name,
                f"[{ONLINE_AUTH_FAILED}] status={status}",
                self._chat_url(),
                elapsed,
                ONLINE_AUTH_FAILED,
            )
        if status == 429:
            return BrowserReply(
                self.node,
                self.name,
                f"[{ONLINE_RATE_LIMITED}] {raw[:400]}",
                self._chat_url(),
                elapsed,
                ONLINE_RATE_LIMITED,
            )
        if status is None or status >= 400:
            return BrowserReply(
                self.node,
                self.name,
                f"[{ONLINE_REJECTED}] status={status} {raw[:500]}",
                self._chat_url(),
                elapsed,
                ONLINE_REJECTED,
            )

        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return BrowserReply(
                self.node,
                self.name,
                f"[{ONLINE_BAD_RESPONSE}] non-JSON body",
                self._chat_url(),
                elapsed,
                ONLINE_BAD_RESPONSE,
            )

        text = ""
        choices = data.get("choices") or []
        if choices:
            message = choices[0].get("message") or {}
            text = (message.get("content") or "").strip()
        if not text:
            text = (data.get("output_text") or data.get("content") or "").strip()
        if not text:
            return BrowserReply(
                self.node,
                self.name,
                f"[{ONLINE_BAD_RESPONSE}] empty completion; keys={sorted(data.keys())}",
                self._chat_url(),
                elapsed,
                ONLINE_BAD_RESPONSE,
            )

        return BrowserReply(self.node, self.name, text, self._chat_url(), elapsed)


__all__ = ["OnlineAgentAdapter", "DEFAULT_MODEL"]
