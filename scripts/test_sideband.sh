#!/bin/bash
# Integration test: writes metadata + binary data through the sideband protocol.
# Run this INSIDE HyperTerm Canvas to test fd3/fd4/fd5 channels.
#
# fd3 = metadata (this script writes JSONL)
# fd4 = binary data (this script writes raw bytes)
# fd5 = events (this script reads JSONL from terminal)

META_FD=${HYPERTERM_META_FD:-3}
DATA_FD=${HYPERTERM_DATA_FD:-4}

echo "=== HyperTerm Sideband Test ==="
echo "META_FD=$META_FD  DATA_FD=$DATA_FD"

# Test 1: SVG panel
echo "--- Test 1: SVG panel ---"
SVG='<svg width="200" height="120" xmlns="http://www.w3.org/2000/svg">
  <rect width="200" height="120" rx="8" fill="#313244"/>
  <text x="100" y="45" text-anchor="middle" fill="#cdd6f4" font-size="16" font-family="sans-serif">Hello HyperTerm!</text>
  <text x="100" y="75" text-anchor="middle" fill="#a6e3a1" font-size="12" font-family="sans-serif">SVG Panel Working</text>
  <circle cx="100" cy="100" r="10" fill="#f38ba8"/>
</svg>'
SVG_LEN=${#SVG}
echo "{\"id\":\"svg-test\",\"type\":\"svg\",\"position\":\"float\",\"x\":50,\"y\":50,\"width\":220,\"height\":140,\"byteLength\":$SVG_LEN}" >&$META_FD
printf '%s' "$SVG" >&$DATA_FD
echo "Sent SVG panel"

sleep 1

# Test 2: HTML panel
echo "--- Test 2: HTML panel ---"
HTML='<div style="padding:16px;font-family:sans-serif;color:#cdd6f4;background:#1e1e2e;">
  <h3 style="margin:0 0 8px;color:#89b4fa;">HTML Panel</h3>
  <p style="margin:0 0 8px;font-size:13px;">This is rendered HTML from fd4.</p>
  <div style="display:flex;gap:8px;">
    <span style="padding:4px 12px;background:#a6e3a1;color:#1e1e2e;border-radius:4px;font-size:12px;">Green</span>
    <span style="padding:4px 12px;background:#f38ba8;color:#1e1e2e;border-radius:4px;font-size:12px;">Red</span>
    <span style="padding:4px 12px;background:#89b4fa;color:#1e1e2e;border-radius:4px;font-size:12px;">Blue</span>
  </div>
</div>'
HTML_LEN=${#HTML}
echo "{\"id\":\"html-test\",\"type\":\"html\",\"position\":\"float\",\"x\":300,\"y\":80,\"width\":300,\"height\":150,\"byteLength\":$HTML_LEN}" >&$META_FD
printf '%s' "$HTML" >&$DATA_FD
echo "Sent HTML panel"

sleep 1

# Test 3: Update position of SVG panel
echo "--- Test 3: Move SVG panel ---"
echo '{"id":"svg-test","type":"update","x":200,"y":200}' >&$META_FD
echo "Moved SVG panel to (200, 200)"

sleep 1

# Test 4: Clear SVG panel
echo "--- Test 4: Clear SVG panel ---"
echo '{"id":"svg-test","type":"clear"}' >&$META_FD
echo "Cleared SVG panel"

echo ""
echo "=== Done! HTML panel should still be visible. ==="
echo "Try dragging it, resizing it, or clicking the X to close."
