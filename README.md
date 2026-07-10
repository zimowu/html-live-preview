# HTML Live Preview

HTML Live Preview is a local Codex plugin prototype for generating standalone HTML with a visible feedback loop.

It provides MCP tools to:

- start a local preview server,
- write draft HTML into a project-local live file,
- enter edit mode and freely click page elements,
- dynamically show text, media, typography, appearance, spacing, sizing, or layout controls based on the selected element,
- keep edits local during edit mode and sync them only when the user clicks Done or Save,
- undo or redo unsynced edit-mode changes with `Cmd+Z` / `Cmd+Shift+Z`,
- read and write the live HTML source after direct preview edits,
- reset to the initial preview snapshot or set the current page as the new baseline,
- read visual adjustment settings from the preview UI,
- set adjustment settings programmatically.

The preview page lives at `http://127.0.0.1:45731` by default and stores state in `.codex-html-live-preview/` inside the active workspace.

## Development

```bash
npm run start:mcp
node scripts/live-preview-server.js --root /path/to/workspace --file /path/to/workspace/.codex-html-live-preview/live.html
```
