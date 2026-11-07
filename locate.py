"""Find the durable seq of one human user message in a DSH session log."""
import json
import os
import sys
from pathlib import Path

import compression.zstd as zstd


def norm(text):
    return " ".join(str(text).split())


def text_of(data):
    content = data.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text") or ""))
        return "\n".join(parts)
    return ""


def frames(data):
    offset = 0
    while offset < len(data):
        size = zstd.get_frame_size(data[offset:])
        if size <= 0:
            break
        yield zstd.decompress(data[offset:offset + size]).decode("utf-8", "replace")
        offset += size


def find_log(home, session_id):
    root = Path(home) / "sessions"
    if not root.is_dir():
        return None
    name = f"{session_id}/session.v4.jsonl.zstd"
    for path in root.rglob("session.v4.jsonl.zstd"):
        if str(path).replace("\\", "/").endswith(name):
            return path
    return None


def main():
    session_id, needle, nth = sys.argv[1], sys.argv[2], int(sys.argv[3])
    home = os.environ.get("DSH_HOME") or str(Path.home() / ".dsh")
    path = find_log(home, session_id)
    if path is None:
        print(json.dumps({"ok": False, "error": "找不到这个会话的记录"}))
        return
    want = norm(needle)
    events = []
    cwd = None
    raw = path.read_bytes()
    for chunk in frames(raw):
        for line in chunk.splitlines():
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if row.get("type") == "session" and isinstance(row.get("cwd"), str):
                cwd = row["cwd"]
            if isinstance(row.get("seq"), int):
                events.append(row)
    humans = []
    for index, row in enumerate(events):
        if row.get("type") != "user/message":
            continue
        data = row.get("data") or {}
        source = data.get("source") or {}
        if source.get("kind") not in (None, "user"):
            continue
        text = text_of(data)
        if norm(text) != want and want not in norm(text) and norm(text) not in want:
            continue
        prev = events[index - 1]["seq"] if index else None
        humans.append({"seq": row["seq"], "prevSeq": prev, "text": text})
    exact = [row for row in humans if norm(row["text"]) == want] or humans
    if not exact:
        print(json.dumps({"ok": False, "error": "记录里没有对上这条消息"}))
        return
    pick = exact[min(max(nth, 0), len(exact) - 1)]
    print(json.dumps({
        "ok": True,
        "seq": pick["seq"],
        "prevSeq": pick["prevSeq"],
        "cwd": cwd,
    }))


if __name__ == "__main__":
    main()
