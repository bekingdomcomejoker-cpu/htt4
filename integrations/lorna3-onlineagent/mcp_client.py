"""Small authenticated MCP JSON-RPC client for the OMEGA bridge."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
import uuid


class MCPError(RuntimeError):
    pass


class OmegaMCPClient:
    def __init__(self):
        self.url = os.environ.get("LORNA_MCP_URL", "http://127.0.0.1:8787/mcp")
        self.key = os.environ.get("LORNA_MCP_API_KEY") or os.environ.get("OMEGA_MCP_API_KEY", "")
        self.bearer = self._read_token()

    @staticmethod
    def _read_token() -> str:
        for path in (
            os.path.expanduser("~/.config/omega/mcp.token"),
            os.path.expanduser("~/.omega_mcp_token"),
        ):
            try:
                with open(path, encoding="utf-8") as fh:
                    token = fh.read().strip()
                if token:
                    return token
            except OSError:
                continue
        return ""

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if self.key:
            headers["X-API-Key"] = self.key
        if self.bearer:
            headers["Authorization"] = "Bearer " + self.bearer
        return headers

    def rpc(self, method: str, params: dict | None = None, timeout: int = 30) -> dict:
        payload = json.dumps({
            "jsonrpc": "2.0",
            "id": str(uuid.uuid4()),
            "method": method,
            "params": params or {},
        }).encode("utf-8")
        request = urllib.request.Request(self.url, data=payload, headers=self._headers(), method="POST")
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                result = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403):
                raise MCPError("MCP authentication failed") from exc
            raise MCPError(f"MCP HTTP {exc.code}") from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise MCPError(f"MCP unavailable: {exc}") from exc
        if "error" in result:
            raise MCPError(str(result["error"]))
        return result

    def initialize(self) -> dict:
        return self.rpc("initialize", {"protocolVersion": "2025-03-26", "capabilities": {}})

    def list_tools(self) -> dict:
        return self.rpc("tools/list", {})

    def call(self, name: str, arguments: dict | None = None, timeout: int = 120) -> str:
        result = self.rpc("tools/call", {"name": name, "arguments": arguments or {}}, timeout=timeout + 10)
        try:
            return "\n".join(
                item.get("text", "")
                for item in result["result"]["content"]
                if item.get("type") == "text"
            )
        except (KeyError, TypeError):
            raise MCPError("MCP malformed tool response")

    def health(self) -> dict:
        try:
            self.initialize()
            data = self.list_tools()
            return {"ok": True, "url": self.url, "tool_count": len(data.get("result", {}).get("tools", []))}
        except MCPError as exc:
            return {"ok": False, "url": self.url, "error": str(exc)}


__all__ = ["MCPError", "OmegaMCPClient"]
