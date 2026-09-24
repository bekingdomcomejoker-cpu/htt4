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
