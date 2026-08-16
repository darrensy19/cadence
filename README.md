# cadence

A focus timer with configurable work/rest intervals — 25/5/15, 50/10/30, 52/17
or your own — a session log across categories, and an ambient layer.

The engine, storage and log are built and live at
<https://darrensy19.github.io/cadence/>. Music and custom wallpapers are not
built yet. See [CLAUDE.md](CLAUDE.md) for the architecture and the reasoning
behind it.

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

## Typeface

The clock and wordmark use [Martian Mono](https://github.com/evilmartians/mono)
by The Martian Mono Project Authors, self-hosted under the SIL Open Font
License — see `fonts/OFL.txt`.
