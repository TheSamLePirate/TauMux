"""
τ-mux — Python client library.

Usage:
    from hyperterm import ht

    panel_id = ht.show_svg('<svg>...</svg>', x=100, y=50)
    ht.update(panel_id, x=200)
    ht.clear(panel_id)

    # Typed event handlers
    ht.on_click(panel_id, lambda data: print(f"Clicked at {data['x']},{data['y']}"))
    ht.on_close(panel_id, lambda: print("Closed!"))
    ht.run_event_loop()  # blocks until event fd closes

When not running inside τ-mux, all methods are safe no-ops.
"""

import os
import json
import sys

_counter = 0


def _next_id(prefix: str = "ht") -> str:
    global _counter
    _counter += 1
    return f"{prefix}_{os.getpid()}_{_counter}"


class TauMux:
    def __init__(self):
        self.debug = os.environ.get("HYPERTERM_DEBUG", "") != ""
        self.protocol_version = int(
            os.environ.get("HYPERTERM_PROTOCOL_VERSION", "1")
        )

        # Parse structured channel map if available
        self.channel_map = None
        channels_json = os.environ.get("HYPERTERM_CHANNELS")
        if channels_json:
            try:
                self.channel_map = json.loads(channels_json)
            except json.JSONDecodeError:
                if self.debug:
                    print(
                        "[hyperterm] Failed to parse HYPERTERM_CHANNELS",
                        file=sys.stderr,
                    )

        # Resolve fds: prefer channel map, fall back to legacy env vars
        if self.channel_map:
            channels = self.channel_map.get("channels", [])
            meta_fd = next(
                (c["fd"] for c in channels if c["name"] == "meta"), None
            )
            data_fd = next(
                (c["fd"] for c in channels if c["name"] == "data"), None
            )
            event_fd = next(
                (c["fd"] for c in channels if c["name"] == "events"), None
            )
        else:
            meta_fd_str = os.environ.get("HYPERTERM_META_FD")
            data_fd_str = os.environ.get("HYPERTERM_DATA_FD")
            event_fd_str = os.environ.get("HYPERTERM_EVENT_FD")
            meta_fd = int(meta_fd_str) if meta_fd_str else None
            data_fd = int(data_fd_str) if data_fd_str else None
            event_fd = int(event_fd_str) if event_fd_str else None

        self.available = meta_fd is not None and data_fd is not None

        self._meta = None
        self._data = None
        self._events = None

        # Event dispatch tables
        self._global_listeners = []
        self._panel_listeners = {}  # {panel_id: {event_type: [callbacks]}}
        # Per-panel data-channel and format memory. update() reads these so
        # binary replacements route to the same channel the panel was created
        # on, and image updates preserve their original PNG/JPEG/WebP format.
        self._panel_channels = {}  # {panel_id: channel_name}
        self._panel_formats = {}  # {panel_id: format_string}
        self._terminal_resize_listeners = []
        self._error_listeners = []
        self._close_callbacks = {}  # {panel_id: [callbacks]}

        if self.available:
            try:
                self._meta = os.fdopen(int(meta_fd), "w", buffering=1)
                self._data = os.fdopen(int(data_fd), "wb", buffering=0)
            except OSError as e:
                self.available = False
                if self.debug:
                    print(
                        f"[hyperterm] Failed to open fds: {e}", file=sys.stderr
                    )
                return

            if event_fd is not None:
                try:
                    self._events = os.fdopen(
                        int(event_fd), "r", buffering=1
                    )
                except OSError as e:
                    self._events = None
                    if self.debug:
                        print(
                            f"[hyperterm] Failed to open event fd: {e}",
                            file=sys.stderr,
                        )

    # ── Low-level protocol ──

    def get_channel_fd(self, name: str) -> int | None:
        """Get the fd for a named channel from the channel map."""
        if not self.channel_map:
            return None
        for ch in self.channel_map.get("channels", []):
            if ch["name"] == name:
                return ch["fd"]
        return None

    def send_meta(self, meta: dict):
        """Send raw metadata JSON to fd3."""
        if not self.available:
            return
        try:
            self._meta.write(json.dumps(meta) + "\n")
            self._meta.flush()
        except OSError as e:
            if self.debug:
                print(f"[hyperterm] send_meta: {e}", file=sys.stderr)

    def send_data(self, data: bytes, channel_name: str | None = None):
        """Send raw binary data to a data channel (default: fd4 / "data")."""
        if not self.available:
            return
        target = self._data
        if channel_name is not None and channel_name != "data":
            fd = self.get_channel_fd(channel_name)
            if fd is None:
                if self.debug:
                    print(
                        f"[hyperterm] send_data: unknown channel {channel_name}",
                        file=sys.stderr,
                    )
                return
            # Open lazily; cache on the instance for reuse.
            cache_key = f"_channel_{channel_name}_writer"
            target = getattr(self, cache_key, None)
            if target is None:
                target = os.fdopen(fd, "wb", buffering=0)
                setattr(self, cache_key, target)
        try:
            target.write(data)
            target.flush()
        except OSError as e:
            if self.debug:
                print(f"[hyperterm] send_data: {e}", file=sys.stderr)

    def flush(self, channel_name: str = "data"):
        """Flush a data channel — abort in-flight reads, discard leftover bytes."""
        self.send_meta(
            {"id": "__system__", "type": "flush", "dataChannel": channel_name}
        )

    # ── Panel creation ──

    # Inline data: URIs are used for SVG / HTML payloads under this size.
    # Below ~2KB, the meta round-trip cost dominates the binary read; inline
    # keeps latency low. Above it, we push to fd4 so the meta line stays
    # short and the sideband-parser's per-line budget isn't stressed.
    _INLINE_DATA_MAX = 2048

    def show_image(
        self,
        path: str,
        x: int = 100,
        y: int = 100,
        width="auto",
        height="auto",
        position: str = "float",
        format: str | None = None,
        draggable: bool = True,
        resizable: bool = True,
        interactive: bool = False,
        timeout: int | None = None,
        data_channel: str | None = None,
        **kwargs,
    ) -> str:
        """Display an image file (PNG, JPEG, WebP, GIF). Returns panel id.

        `timeout` (ms) overrides the parent-side 5s binary-read timeout —
        raise it for very large frames or slow disks. `data_channel` routes
        the binary payload to an extra channel declared on the bun side.
        """
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
        fmt = format or fmt_map.get(ext, "png")

        meta = {
            "id": panel_id,
            "type": "image",
            "format": fmt,
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
        if timeout is not None:
            meta["timeout"] = timeout
        if data_channel is not None:
            meta["dataChannel"] = data_channel
        self.send_meta(meta)
        self.send_data(data, channel_name=data_channel)
        # Remember channel + format so update() can route / re-emit correctly.
        if data_channel is not None:
            self._panel_channels[panel_id] = data_channel
        self._panel_formats[panel_id] = fmt
        return panel_id

    def show_svg(
        self,
        svg: str,
        x: int = 100,
        y: int = 100,
        width: int = 400,
        height: int = 300,
        position: str = "float",
        interactive: bool = False,
        timeout: int | None = None,
        data_channel: str | None = None,
        **kwargs,
    ) -> str:
        """Display an SVG string as a floating panel. Returns panel id.

        Small SVGs (<2KB) are sent inline via `data:` in the meta line —
        skips the fd4 round-trip for latency-sensitive updates.
        """
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
            "interactive": interactive,
            "draggable": kwargs.pop("draggable", True),
            "resizable": kwargs.pop("resizable", True),
            **kwargs,
        }
        if timeout is not None:
            meta["timeout"] = timeout
        if data_channel is not None:
            meta["dataChannel"] = data_channel
        if len(data) <= self._INLINE_DATA_MAX and data_channel is None:
            meta["data"] = svg
            self.send_meta(meta)
        else:
            meta["byteLength"] = len(data)
            self.send_meta(meta)
            self.send_data(data, channel_name=data_channel)
        if data_channel is not None:
            self._panel_channels[panel_id] = data_channel
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
        timeout: int | None = None,
        data_channel: str | None = None,
        **kwargs,
    ) -> str:
        """Display an HTML string as a floating panel. Returns panel id.

        Small fragments (<2KB) are sent inline via `data:` in the meta line.
        """
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
            **kwargs,
        }
        if timeout is not None:
            meta["timeout"] = timeout
        if data_channel is not None:
            meta["dataChannel"] = data_channel
        if len(data) <= self._INLINE_DATA_MAX and data_channel is None:
            meta["data"] = html
            self.send_meta(meta)
        else:
            meta["byteLength"] = len(data)
            self.send_meta(meta)
            self.send_data(data, channel_name=data_channel)
        if data_channel is not None:
            self._panel_channels[panel_id] = data_channel
        return panel_id

    def show_canvas(
        self,
        png_data: bytes,
        x: int = 100,
        y: int = 100,
        width="auto",
        height="auto",
        position: str = "float",
        draggable: bool = True,
        resizable: bool = True,
        interactive: bool = False,
        timeout: int | None = None,
        data_channel: str | None = None,
        **kwargs,
    ) -> str:
        """Display PNG bytes on an HTML5 canvas panel. Returns panel id.

        Canvas frames tend to be larger than the 5s default read timeout
        tolerates under load; pass `timeout=20000` on high-FPS streams.
        """
        panel_id = _next_id("canvas")
        if not self.available:
            return panel_id

        meta = {
            "id": panel_id,
            "type": "canvas2d",
            "position": position,
            "x": x,
            "y": y,
            "width": width,
            "height": height,
            "draggable": draggable,
            "resizable": resizable,
            "interactive": interactive,
            "byteLength": len(png_data),
            **kwargs,
        }
        if timeout is not None:
            meta["timeout"] = timeout
        if data_channel is not None:
            meta["dataChannel"] = data_channel
        self.send_meta(meta)
        self.send_data(png_data, channel_name=data_channel)
        if data_channel is not None:
            self._panel_channels[panel_id] = data_channel
        return panel_id

    def show_canvas_file(self, path: str, **kwargs) -> str:
        """Display a PNG file on an HTML5 canvas panel. Returns panel id."""
        with open(path, "rb") as f:
            data = f.read()
        return self.show_canvas(data, **kwargs)

    # ── Panel manipulation ──

    def update(self, panel_id: str, **fields):
        """Update panel properties.

        Pass `data=bytes` or `data=str` to replace the panel's content.
        Binary replacements are routed to the panel's original
        `data_channel` (stored at creation time) so a panel created on
        an alternate channel keeps using it for updates.
        """
        if not self.available:
            return

        # An explicit data_channel in the kwargs wins over the remembered
        # one — lets callers re-route mid-stream if they need to.
        channel = fields.pop("data_channel", None)
        if channel is None:
            channel = self._panel_channels.get(panel_id)

        binary = None
        inline_data = None
        if "data" in fields:
            raw = fields.pop("data")
            if isinstance(raw, str):
                encoded = raw.encode("utf-8")
                # Small string updates skip the fd4 hop.
                if len(encoded) <= self._INLINE_DATA_MAX and channel is None:
                    inline_data = raw
                else:
                    binary = encoded
            elif isinstance(raw, (bytes, bytearray)):
                binary = bytes(raw)

        if binary is not None:
            fields["byteLength"] = len(binary)
        if inline_data is not None:
            fields["data"] = inline_data

        meta = {"id": panel_id, "type": "update", **fields}
        if channel is not None and binary is not None:
            meta["dataChannel"] = channel
        self.send_meta(meta)

        if binary is not None:
            self.send_data(binary, channel_name=channel)

    def move(self, panel_id: str, x: int, y: int):
        """Move a panel to a new position."""
        self.update(panel_id, x=x, y=y)

    def resize(self, panel_id: str, width: int, height: int):
        """Resize a panel."""
        self.update(panel_id, width=width, height=height)

    def set_opacity(self, panel_id: str, opacity: float):
        """Set panel opacity (0.0 - 1.0)."""
        self.update(panel_id, opacity=opacity)

    def set_z_index(self, panel_id: str, z_index: int):
        """Set panel z-index stacking order."""
        self.update(panel_id, zIndex=z_index)

    def set_interactive(self, panel_id: str, interactive: bool):
        """Enable or disable interactivity on a panel."""
        self.update(panel_id, interactive=interactive)

    def clear(self, panel_id: str):
        """Remove a panel."""
        self.send_meta({"id": panel_id, "type": "clear"})
        # Drop per-panel memory so long-running scripts that create/clear
        # many panels don't accumulate dangling entries.
        self._panel_channels.pop(panel_id, None)
        self._panel_formats.pop(panel_id, None)
        self._panel_listeners.pop(panel_id, None)

    # ── Raw events ──

    def read_event(self) -> dict | None:
        """Read a single event from fd5. Returns None on EOF."""
        if self._events is None:
            return None
        line = self._events.readline()
        if not line:
            return None
        try:
            return json.loads(line)
        except json.JSONDecodeError:
            if self.debug:
                print(
                    f"[hyperterm] Invalid event JSON: {line.strip()}",
                    file=sys.stderr,
                )
            return None

    def events(self):
        """Generator that yields raw events as dicts."""
        while True:
            event = self.read_event()
            if event is None:
                break
            yield event

    # ── Typed event handlers ──

    def on_event(self, callback):
        """Register a raw event listener (receives all events)."""
        self._global_listeners.append(callback)

    def on_click(self, panel_id: str, callback):
        """Listen for click events. callback(data) where data has x, y, button, buttons."""
        self._add_panel_listener(panel_id, "click", callback)

    def on_mouse_down(self, panel_id: str, callback):
        """Listen for mousedown events. callback(data) with x, y, button, buttons."""
        self._add_panel_listener(panel_id, "mousedown", callback)

    def on_mouse_up(self, panel_id: str, callback):
        """Listen for mouseup events. callback(data) with x, y, button, buttons."""
        self._add_panel_listener(panel_id, "mouseup", callback)

    def on_mouse_move(self, panel_id: str, callback):
        """Listen for mousemove events (~60fps throttled). callback(data) with x, y, buttons."""
        self._add_panel_listener(panel_id, "mousemove", callback)

    def on_mouse_enter(self, panel_id: str, callback):
        """Listen for mouseenter events. callback(data) with x, y."""
        self._add_panel_listener(panel_id, "mouseenter", callback)

    def on_mouse_leave(self, panel_id: str, callback):
        """Listen for mouseleave events. callback(data) with x, y."""
        self._add_panel_listener(panel_id, "mouseleave", callback)

    def on_wheel(self, panel_id: str, callback):
        """Listen for wheel/scroll events. callback(data) with x, y, deltaX, deltaY."""
        self._add_panel_listener(panel_id, "wheel", callback)

    def on_drag(self, panel_id: str, callback):
        """Listen for dragend events (panel moved). callback(data) with x, y."""
        self._add_panel_listener(panel_id, "dragend", callback)

    def on_panel_resize(self, panel_id: str, callback):
        """Listen for resize events (panel resized). callback(data) with width, height."""
        self._add_panel_listener(panel_id, "resize", callback)

    def on_close(self, panel_id: str, callback):
        """Listen for close events (user clicked X). callback() with no args."""
        cbs = self._close_callbacks.setdefault(panel_id, [])
        cbs.append(callback)

    def on_terminal_resize(self, callback):
        """Listen for terminal resize events. callback(data) with cols, rows, pxWidth, pxHeight."""
        self._terminal_resize_listeners.append(callback)

    def on_error(self, callback):
        """Listen for protocol error events. callback(code, message, ref)."""
        self._error_listeners.append(callback)

    # ── Event loop ──

    def run_event_loop(self):
        """Process events and dispatch to registered handlers. Blocks until fd5 closes."""
        for event in self.events():
            self._dispatch(event)

    def poll_events(self):
        """Non-blocking: read and dispatch all currently available events.
        Useful when running your own loop with sleep()."""
        if self._events is None:
            return
        import select

        while select.select([self._events], [], [], 0)[0]:
            event = self.read_event()
            if event is None:
                break
            self._dispatch(event)

    # ── Internal ──

    def _add_panel_listener(self, panel_id, event_type, callback):
        panel = self._panel_listeners.setdefault(panel_id, {})
        cbs = panel.setdefault(event_type, [])
        cbs.append(callback)

    def _dispatch(self, event: dict):
        # Global listeners
        for cb in self._global_listeners:
            cb(event)

        eid = event.get("id", "")
        evt = event.get("event", "")

        # System events
        if eid == "__system__" and evt == "error":
            for cb in self._error_listeners:
                cb(
                    event.get("code", "unknown"),
                    event.get("message", ""),
                    event.get("ref"),
                )
            return

        # Terminal resize
        if eid == "__terminal__" and evt == "resize":
            data = {
                "cols": event.get("cols", 0),
                "rows": event.get("rows", 0),
                "pxWidth": event.get("pxWidth", 0),
                "pxHeight": event.get("pxHeight", 0),
            }
            for cb in self._terminal_resize_listeners:
                cb(data)
            return

        # Panel-specific listeners
        panel = self._panel_listeners.get(eid)
        if panel:
            cbs = panel.get(evt)
            if cbs:
                # Build typed data dict
                data = {
                    "id": eid,
                    "event": evt,
                    "x": event.get("x", 0),
                    "y": event.get("y", 0),
                    "button": event.get("button", 0),
                    "buttons": event.get("buttons", 0),
                    "width": event.get("width", 0),
                    "height": event.get("height", 0),
                    "deltaX": event.get("deltaX", 0),
                    "deltaY": event.get("deltaY", 0),
                }
                for cb in cbs:
                    cb(data)

        # Close callbacks
        if evt == "close":
            cbs = self._close_callbacks.get(eid)
            if cbs:
                for cb in cbs:
                    cb()
                del self._close_callbacks[eid]


# Convenience singleton
ht = TauMux()
