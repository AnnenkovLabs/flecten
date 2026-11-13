#!/usr/bin/env python3
"""Own a private X11 clipboard until one UTF-8 paste request has been delivered."""
import sys
import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
from gi.repository import Gdk, GLib, Gtk

text = sys.stdin.read(64001)
if len(text) > 16000:
    raise ValueError("Text exceeds the input limit")

owner = Gtk.Invisible()
owner.realize()
clipboard = Gdk.atom_intern("CLIPBOARD", False)


def finish():
    owner.get_display().sync()
    print("DELIVERED", flush=True)
    return False


def provide(_widget, selection_data, _info, _time):
    selection_data.set_text(text, -1)
    GLib.idle_add(finish)


owner.connect("selection-get", provide)
for target in ["UTF8_STRING", "text/plain;charset=utf-8", "TEXT", "STRING"]:
    Gtk.selection_add_target(owner, clipboard, Gdk.atom_intern(target, False), 0)
if not Gtk.selection_owner_set(owner, clipboard, Gdk.CURRENT_TIME):
    raise RuntimeError("Could not own the private clipboard")
owner.get_display().sync()
print("READY", flush=True)
Gtk.main()
