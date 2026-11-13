#!/usr/bin/env python3
"""Bounded AT-SPI context from the private desktop bus. Password values are never read."""
import json
import os
import gi

gi.require_version("Atspi", "2.0")
from gi.repository import Atspi


def snapshot():
    root = Atspi.get_desktop(0)
    queue = [(root, 0)]
    nodes = []
    visited = 0
    truncated = False
    while queue and visited < 400 and len(nodes) < 160:
        node, depth = queue.pop(0)
        visited += 1
        try:
            role = str(node.get_role_name())[:80]
            state = node.get_state_set()
            if state.contains(Atspi.StateType.DEFUNCT):
                continue
            if role not in {"desktop frame", "application"} and not state.contains(Atspi.StateType.SHOWING):
                continue
            # A password control can expose a value as its accessible name in some toolkits.
            protected = node.get_role() == Atspi.Role.PASSWORD_TEXT
            name = "[protected]" if protected else str(node.get_name() or "")[:200]
            record = {"role": role, "name": name, "depth": depth}
            interfaces = node.get_interfaces()
            if role != "desktop frame" and "Component" in interfaces:
                rect = node.get_component_iface().get_extents(Atspi.CoordType.SCREEN)
                if 0 < rect.width <= 100000 and 0 < rect.height <= 100000:
                    if rect.x + rect.width <= 0 or rect.y + rect.height <= 0 or rect.x >= int(os.environ["FLECTEN_DESKTOP_WIDTH"]) or rect.y >= int(os.environ["FLECTEN_DESKTOP_HEIGHT"]):
                        continue
                    record["bounds"] = {"x": rect.x, "y": rect.y, "width": rect.width, "height": rect.height}
            if not protected and "Text" in interfaces:
                content = node.get_text_iface()
                text = str(Atspi.Text.get_text(content, 0, min(Atspi.Text.get_character_count(content), 300)) or "").replace("\ufffc", "")
                if text and text != name:
                    record["text"] = text
            nodes.append(record)
            count = node.get_child_count()
            if depth >= 12:
                truncated = truncated or count > 0
                continue
            for index in range(min(count, 160)):
                child = node.get_child_at_index(index)
                if child is not None:
                    queue.append((child, depth + 1))
            truncated = truncated or count > 160
        except Exception:
            truncated = True
    return {"available": True, "nodes": nodes, "truncated": truncated or bool(queue)}


print(json.dumps(snapshot(), ensure_ascii=False))
