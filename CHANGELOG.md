# Changelog

## 0.1.0 · 2026-10-29

- New independent Windows desktop shell with persistent dataset sidebar, image/annotation list, virtualized grid, light/dark themes, resizable panes and image previews.
- Folder/file drag-in, native image drag-out, recursive discovery and read-only use of installed WD14 weights. CPU inference is isolated and released after the batch.
- WD14, WD14 + native DSH and LLM-only pipelines; four output presets; editable guidance and saved custom presets; optional local Skill references and character evidence.
- DSH Relay uses real image attachments and an explicit registered workspace. Independent review can inspect overlapping detail crops. Model/run provenance is visible.
- Final-prompt extraction follows the Toolkit node delimiter contract. Caption JSON is compiled to plain training text; process messages and failures do not become TXT annotations.
- Deterministic MOSS source-pixel to centralized yxyx compilation and original-image region overlay.
- Same-name TXT auto-save, skip-existing default, explicit replacement backups, history, optimistic revisions, source/disk-change checks, retry/pause/cancel and restart recovery.
- Local Agent control API and 11 stdio MCP tools, read-only by default, shared state, revision guards and action audit.
- Character references have one owner; disabling lookup is respected, and background public updates retain user-supplied character notes.
- Bundled isolated CPython runtime, pinned dependencies, Windows executable resources, close-time draft flush and owned-process cleanup. Existing DSH/ComfyUI services remain user-managed.
