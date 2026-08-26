#!/usr/bin/env python3
"""Lint a GenLayer contract file through genskill-mcp.

Usage:
  python scripts/lint_contract.py contracts/roast_jury.py
"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from genskill import rpc


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        return 1
    path = pathlib.Path(sys.argv[1])
    code = path.read_text(encoding="utf-8")
    _, msgs = rpc([{
        "jsonrpc": "2.0", "id": 2, "method": "tools/call",
        "params": {
            "name": "genlayer_lint_contract",
            "arguments": {"code": code},
        },
    }])
    ok = True
    for m in msgs:
        if "error" in m:
            print("RPC ERROR:", json.dumps(m["error"])[:500])
            return 1
        for item in m.get("result", {}).get("content", []):
            if item.get("type") == "text":
                print(item["text"])
                try:
                    data = json.loads(item["text"])
                    result = data.get("data", {}).get("result", {})
                    ok = bool(result.get("ok"))
                except json.JSONDecodeError:
                    pass
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
