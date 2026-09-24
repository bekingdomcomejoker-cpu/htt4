# `@onlineagent` — local agent command + Forge online brain

**Default model:** `claude-sonnet-4-6` (Claude Sonnet 4.6)  
Best balance for agent-style reasoning, code, and careful ops advice among the website Forge catalog.

## What it does

| Command | Behaviour |
|---------|-----------|
| `@agent` | Unchanged — local `lorna2 --node agent` |
| **`@onlineagent`** / **`@oa`** | Same *agent* role, but inference via Forge chat API |

```text
You type:  @onlineagent summarise omega-wg status and next checks
           │
           ▼
OnlineAgentAdapter  →  POST .../v1/chat/completions
                       model=claude-sonnet-4-6
           │
           ▼
Text returned in Lorna3 TUI
```

## Install on Termux (omega-termux-lorna)

1. Copy adapter:

```bash
cp lorna3/adapters/online_agent.py \
  ~/path/to/omega-termux-lorna/lorna3/adapters/online_agent.py
```

2. Edit `lorna3/router/dispatch.py`:

In `ROUTES`:

```python
"@onlineagent": "onlineagent",
"@oa": "onlineagent",
```

In `_get_adapter`:

```python
elif name == "onlineagent":
    from adapters.online_agent import OnlineAgentAdapter
    _ADAPTERS[name] = OnlineAgentAdapter()
```

3. Configure env (Termux, mode 600 file preferred):

```bash
# ~/.online_agent_env  (chmod 600)
export ONLINE_AGENT_MODEL=claude-sonnet-4-6
export ONLINE_AGENT_BASE_URL="https://YOUR_FORGE_OPENAI_COMPAT_BASE"   # must end before /chat/completions or include /v1
export ONLINE_AGENT_API_KEY="YOUR_FORGE_OR_MANUS_KEY"
```

```bash
# load before TUI
set -a; source ~/.online_agent_env; set +a
```

The `~/bin/lorna3` launcher must source this file automatically before starting the TUI. Add `[ -f "$HOME/.online_agent_env" ] && . "$HOME/.online_agent_env"` immediately after `set -a`; otherwise manually sourced tests may work while a normal `lorna3` session returns HTTP 403.

Alternate env names also accepted: `FORGE_BASE_URL`, `FORGE_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_API_KEY`.

4. Smoke test:

```bash
cd ~/path/to/omega-termux-lorna/lorna3
python -c "
from adapters.online_agent import OnlineAgentAdapter
a = OnlineAgentAdapter()
print(a.health())
print(a.ask('Reply with exactly: onlineagent-ok').text)
"
```

5. Add the TUI dropdown and route. In `integrations/lorna3_tui.py`, add `@onlineagent` and `@oa` to `AT_ROUTES`. The existing `LornaCompleter` uses that registry for the Tab-completion dropdown. In `run_router`, dispatch both aliases through `router.dispatch` with the `omega-termux-lorna/lorna3` root on `sys.path`; the complete verified snippet is recorded in [`LORNA3_TUI_ROUTE_PATCH.md`](./LORNA3_TUI_ROUTE_PATCH.md).

6. From TUI / dispatcher:

```text
@onlineagent Reply with exactly: onlineagent-ok
@oa what is 10.66.66.1 used for on my mesh?
```

## Optional: LORNA2 `--node onlineagent`

If your `lorna2` binary resolves nodes itself, add a node that either:

- shells out to the same Forge call, or  
- invokes `python -c 'from router.dispatch import dispatch; print(dispatch("@onlineagent " + prompt))'`

Until that is wired, use **`@onlineagent`** via Lorna3 only.

## Security

- API key stays on Termux only — never in Git, Drive packages, or the public website.
- Website models list does not need every Lorna adapter; this is one online brain for the agent command.
- Executable shell from the model still goes through your existing authorization gate if you pipe output into the agent/classifier later.

## Change model later

```bash
export ONLINE_AGENT_MODEL=gpt-5.5          # or another Forge id
# restart TUI / shell
```

## Files in this package

| Path | Role |
|------|------|
| `lorna3/adapters/online_agent.py` | Adapter |
| `patches/dispatch_ROUTES_snippet.py` | Copy-paste routes |
| `INSTALL.md` | This guide |

## Local MCP tool loop (LORNA 2 and LORNA 3)

The online-agent package includes `mcp_client.py` and a bounded tool loop in `online_agent.py`. On Termux, install both files into the LORNA 3 package so the Forge adapter can initialize the authenticated local bridge, list the local tool catalog, execute at most four tool rounds, and return the final Forge response. The adapter falls back to ordinary Forge chat if the local bridge is temporarily unavailable; it never exposes the MCP key to Forge or the website.

The LORNA 2 `/node onlineagent` route forwards through the existing `lorna3_route` bridge handler, so no LORNA 2 source change is required. This preserves the existing `/node agent` implementation and its MCP behavior unchanged.

Required phone-local configuration remains:

```bash
set -a; . "$HOME/.online_agent_env"; set +a
export LORNA_MCP_API_KEY="$(cat "$HOME/.config/omega/mcp.token")"
cp "$HOME/.config/omega/mcp.token" "$HOME/.omega_mcp_token"
```

The read-only verification commands are:

```bash
printf '/node onlineagent\nYou MUST call the read-only MCP tool battery_status now with an empty JSON object. After it returns, report the exact result.\n/quit\n' | lorna2
printf '@oa You MUST call the read-only MCP tool battery_status now with an empty JSON object. After it returns, report the exact result.\n/quit\n' | lorna3
```

Both routes must return a live JSON battery record from the connected phone. Do not commit `.online_agent_env`, MCP token files, or Forge credentials.

## Shared LORNA memory

The online-agent route now uses the same LORNA facts backend as the local agent: `~/.lorna_v2/facts.json`, implemented by `Lorna/agents/lorna_memory.py`. The supervised `omega-mcp` bridge exposes three phone-local tools: `lorna_remember`, `lorna_memory_context`, and `lorna_forget`. The Forge adapter is instructed to call these tools for explicit remember, recall, and forget requests; follow-up device requests can then use the recalled preference while still calling the relevant device tool.

After updating `omega_mcp_bridge.py`, restart the supervised service and verify the persisted flow:

```bash
sv restart omega-mcp
printf '/node onlineagent\nRemember exactly this preference: when I say turn it off after turning on the flashlight, turn the flashlight off.\nWhat do you remember about turning it off after the flashlight is on?\n/quit\n' | lorna2
grep -n flashlight "$HOME/.lorna_v2/facts.json"
```

## Device follow-ups

The adapter keeps the last few user and assistant turns in the running LORNA 2/3 process, so a follow-up such as `turn it off` can resolve the immediately preceding flashlight action. Flashlight requests, including common misspellings such as `flashloght`, use the bridge’s bounded `flashlight_control` tool directly instead of routing through a potentially slow language-model path. The bridge invokes `termux-torch` with an eight-second command limit and returns a clear success or failure message.
