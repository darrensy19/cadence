# cadence

A focus timer with configurable work/rest intervals — 25/5/15, 50/10/30, 52/17
or your own — a session log across categories, and an ambient layer.

**Status: nothing built yet.** The repo currently holds the decisions and the
constraints; the app comes next. See [CLAUDE.md](CLAUDE.md) for the
architecture and the reasoning behind it.

## Running it

No build step, no dependencies, no framework. It is plain HTML, CSS and ES
modules.

It must be **served**, not opened from disk — ES modules are fetched and
`file://` refuses that, so double-clicking `index.html` fails in confusing ways.

    python3 -m http.server 8777

Then open <http://localhost:8777>.

## Browser

Chromium (Chrome or Edge). It uses the File System Access API for import and
export.
