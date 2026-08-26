#!/usr/bin/env python3
"""Driver for the local genskill-mcp server (stdio JSON-RPC).

Usage:
  python scripts/genskill.py list
  python scripts/genskill.py call <tool_name> [json_args]
  python scripts/genskill.py resource <resource_uri>
"""
import json
import subprocess
import sys

SERVER = r"C:\Vibecode\genskill-mcp\dist\cli.js"


def rpc(payloads):
    lines = [
        json.dumps({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "roast-build", "version": "0.1.0"},
            },
        }),
        json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}),
    ]
    lines.extend(json.dumps(p) for p in payloads)
    stdin = "\n".join(lines) + "\n"
    proc = subprocess.run(
        ["node", SERVER], input=stdin, capture_output=True, text=True,
        encoding="utf-8", errors="replace", timeout=300,
    )
    out = []
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(msg.get("id"), int) and msg["id"] >= 2:
            out.append(msg)
    return proc, out


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    mode = sys.argv[1]
    if mode == "list":
        _, msgs = rpc([{"jsonrpc": "2.0", "id": 2, "method": "tools/list"}])
        for m in msgs:
            for t in m["result"]["tools"]:
                print(f"- {t['name']}: {t.get('description', '')[:100]}")
        return 0
    if mode == "call":
        name = sys.argv[2]
        args = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
        _, msgs = rpc([{"jsonrpc": "2.0", "id": 2,
                        "method": "tools/call",
                        "params": {"name": name, "arguments": args}}])
        for m in msgs:
            if "error" in m:
                print("RPC ERROR:", json.dumps(m["error"])[:500])
            res = m.get("result", {})
            for item in res.get("content", []):
                if item.get("type") == "text":
                    print(item["text"])
            if res.get("isError"):
                print("[tool reported error]")
        return 0
    if mode == "resource":
        uri = sys.argv[2]
        _, msgs = rpc([{"jsonrpc": "2.0", "id": 2,
                        "method": "resources/read",
                        "params": {"uri": uri}}])
        for m in msgs:
            if "error" in m:
                print("RPC ERROR:", json.dumps(m["error"])[:500])
                continue
            for item in m.get("result", {}).get("contents", []):
                print(item.get("text", ""))
        return 0
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main())
