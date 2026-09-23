# Merge into lorna3/router/dispatch.py ROUTES dict:

    "@onlineagent": "onlineagent",
    "@oa": "onlineagent",

# Merge into _get_adapter():

        elif name == "onlineagent":
            from adapters.online_agent import OnlineAgentAdapter
            _ADAPTERS[name] = OnlineAgentAdapter()
