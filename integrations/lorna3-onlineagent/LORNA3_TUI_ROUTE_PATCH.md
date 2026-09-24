# LORNA 3 TUI route patch

This patch records the phone-side changes verified on 2026-09-24. The website does not access the phone MCP directly; the changes are installed in the Termux `omega-unified` workspace.

## Route palette

Add these entries to `integrations/lorna3_tui.py` in `AT_ROUTES`:

```python
("@onlineagent", "Online agent — Forge route"),
("@oa", "Alias → @onlineagent"),
```

`LornaCompleter` already derives its Tab-completion dropdown from `AT_ROUTES`, so these entries make both aliases appear when the operator types `@o` and presses Tab.

## TUI route execution

In `run_router`, before the existing provider-specific branches, dispatch these aliases through the LORNA 3 dispatcher:

```python
provider = trigger_line.split(None, 1)[0].lower() if trigger_line.strip() else ""
if provider in {"@onlineagent", "@oa"}:
    try:
        import sys
        l3_root = Path.home() / "omega-termux-lorna" / "lorna3"
        if str(l3_root) not in sys.path:
            sys.path.insert(0, str(l3_root))
        from router.dispatch import dispatch
        return dispatch(trigger_line)
    except Exception as e:
        return f"[ERROR] online-agent route: {e}"
```

The explicit `sys.path` insertion is required because the dispatcher imports its sibling `config` package when launched from the standalone `omega-unified` TUI.

## Verification

The phone-side checks passed:

```text
DROPDOWN_ROUTES=['@onlineagent', '@oa']
DROPDOWN_MATCHES=['@onlineagent', '@oa']
@oa Reply with exactly: l3-tui-oa-ok
l3-tui-oa-ok
```

LORNA 2 was not changed in this patch and remains operational through `/node onlineagent`.
