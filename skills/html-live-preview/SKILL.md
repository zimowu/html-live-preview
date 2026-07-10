---
name: html-live-preview
description: Start and use a local live preview while generating or refining single-file HTML, CSS, or JS artifacts. Use when the user wants to see and tune HTML output during generation rather than waiting for a finished file.
---

# HTML Live Preview

Use this skill when building a standalone HTML page, report, prototype, or visual artifact where the user wants live feedback before the final file is complete.

## Workflow

1. Start the preview with the MCP tool `start_html_preview`.
2. Send meaningful draft checkpoints with `update_html_preview` as soon as the page has enough structure to render.
3. Ask the user to enable `Edit mode` in the preview when they want to directly select content. The inspector should change based on the selected element.
4. User edits are local while Edit mode is active. Treat the live HTML file as current only after the user clicks `Done` or `Save`.
5. Use `sync_html_preview` or `read_html_preview_source` after the user finishes editing. Do not continue from an older draft.
6. Read `read_html_preview_state` before finalizing and apply the returned adjustments to the actual HTML/CSS.
7. Continue updating the preview after each substantial layout or content change.

## Output Discipline

- Keep the preview file project-local under `.codex-html-live-preview/` unless the user chooses a real destination file.
- Do not treat the preview adjustments as final source code by themselves. Convert them into explicit CSS decisions in the final HTML.
- Preserve user-edited text from the live preview file. Do not overwrite it with an older draft.
- Preserve inline element edits made in the preview unless the user asks to reset. The preview offers `Reset initial` and `Set baseline`; respect the live file after either action.
- Edit-mode changes are undoable with `Cmd+Z` and redoable with `Cmd+Shift+Z` before sync.
- Prefer `write_html_preview_source` over `update_html_preview` when applying Codex edits after direct user edits, because it makes the source-sync intent explicit.
- Use `reset_html_preview` and `set_html_preview_baseline` for programmatic reset/baseline operations instead of manually editing the state files.
- Use live preview for fast visual loops; still run normal browser or screenshot QA for final delivery when layout quality matters.
