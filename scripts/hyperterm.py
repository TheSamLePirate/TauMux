"""
HyperTerm Canvas — Python client library.

Usage:
    from hyperterm import ht

    panel_id = ht.show_svg('<svg>...</svg>', x=100, y=50)
    ht.update(panel_id, x=200)
    ht.clear(panel_id)

    for event in ht.events():
        print(event)

When not running inside HyperTerm, all methods are safe no-ops.
"""

import os
import json
import sys

_counter = 0


def _next_id(prefix: str = "ht") -> str:
    global _counter
    _counter += 1
    return f"{prefix}_{os.getpid()}_{_counter}"


class HyperTerm:
    def __init__(self):
        meta_fd = os.environ.get("HYPERTERM_META_FD")
        data_fd = os.environ.get("HYPERTERM_DATA_FD")
        event_fd = os.environ.get("HYPERTERM_EVENT_FD")

        self.available = meta_fd is not None and data_fd is not None

        self._meta = None
        self._data = None
        self._events = None

        if self.available:
            try:
                self._meta = os.fdopen(int(meta_fd), "w", buffering=1)
                self._data = os.fdopen(int(data_fd), "wb", buffering=0)
            except OSError:
                self.available = False
                return

            if event_fd is not None:
                try:
                    self._events = os.fdopen(int(event_fd), "r", buffering=1)
                except OSError:
                    self._events = None

    def _send_meta(self, meta: dict):
        if not self.available:
            return
        self._meta.write(json.dumps(meta) + "\n")
        self._meta.flush()

    def _send_data(self, data: bytes):
        if not self.available:
            return
        self._data.write(data)
        self._data.flush()

    def show_image(
        self,
        path: str,
        x: int = 100,
        y: int = 100,
        width="auto",
        height="auto",
        position: str = "float",
        draggable: bool = True,
        resizable: bool = True,
        interactive: bool = False,
        **kwargs,
    ) -> str:
        """Display an image file as a floating panel. Returns panel id."""
        panel_id = _next_id("img")
        if not self.available:
            return panel_id

        with open(path, "rb") as f:
            data = f.read()

        ext = path.rsplit(".", 1)[-1].lower()
        fmt_map = {
            "png": "png",
            "jpg": "jpeg",
            "jpeg": "jpeg",
            "webp": "webp",
            "gif": "gif",
        }

        meta = {
            "id": panel_id,
            "type": "image",
            "format": fmt_map.get(ext, "png"),
            "position": position,
            "x": x,
            "y": y,
            "width": width,
            "height": height,
            "draggable": draggable,
            "resizable": resizable,
            "interactive": interactive,
            "byteLength": len(data),
            **kwargs,
        }
        self._send_meta(meta)
        self._send_data(data)
        return panel_id

    def show_svg(
        self,
        svg: str,
        x: int = 100,
        y: int = 100,
        width: int = 400,
        height: int = 300,
        position: str = "float",
        **kwargs,
    ) -> str:
        """Display an SVG string as a floating panel. Returns panel id."""
        panel_id = _next_id("svg")
        if not self.available:
            return panel_id

        data = svg.encode("utf-8")
        meta = {
            "id": panel_id,
            "type": "svg",
            "position": position,
            "x": x,
            "y": y,
            "width": width,
            "height": height,
            "draggable": kwargs.pop("draggable", True),
            "resizable": kwargs.pop("resizable", True),
            "byteLength": len(data),
            **kwargs,
        }
        self._send_meta(meta)
        self._send_data(data)
        return panel_id

    def show_html(
        self,
        html: str,
        x: int = 100,
        y: int = 100,
        width: int = 400,
        height: int = 300,
        position: str = "float",
        interactive: bool = False,
        **kwargs,
    ) -> str:
        """Display an HTML string as a floating panel. Returns panel id."""
        panel_id = _next_id("html")
        if not self.available:
            return panel_id

        data = html.encode("utf-8")
        meta = {
            "id": panel_id,
            "type": "html",
            "position": position,
            "x": x,
            "y": y,
            "width": width,
            "height": height,
            "interactive": interactive,
            "draggable": kwargs.pop("draggable", True),
            "resizable": kwargs.pop("resizable", True),
            "byteLength": len(data),
            **kwargs,
        }
        self._send_meta(meta)
        self._send_data(data)
        return panel_id

    def update(self, panel_id: str, **fields):
        """Update an existing panel's properties. Pass data=bytes or data=str for content replacement."""
        if not self.available:
            return

        binary = None
        if "data" in fields:
            raw = fields.pop("data")
            if isinstance(raw, str):
                binary = raw.encode("utf-8")
            elif isinstance(raw, (bytes, bytearray)):
                binary = bytes(raw)
            if binary is not None:
                fields["byteLength"] = len(binary)

        meta = {"id": panel_id, "type": "update", **fields}
        self._send_meta(meta)

        if binary is not None:
            self._send_data(binary)

    def clear(self, panel_id: str):
        """Remove a panel."""
        self._send_meta({"id": panel_id, "type": "clear"})

    def read_event(self) -> dict | None:
        """Read a single event from the terminal. Returns None on EOF."""
        if self._events is None:
            return None
        line = self._events.readline()
        if not line:
            return None
        try:
            return json.loads(line)
        except json.JSONDecodeError:
            return None

    def events(self):
        """Generator that yields events as they arrive."""
        while True:
            event = self.read_event()
            if event is None:
                break
            yield event


# Convenience singleton
ht = HyperTerm()
