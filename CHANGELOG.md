# Changelog

## 0.1.3 · 2026-10-30

- Fix invisible Skill names: the expanded-section full-width input rule also stretched checkboxes, pushing names outside the inspector. Restrict it to non-checkbox inputs and wrap long names inside their row. Show selected Skill count and preserve selection after reload.
- Add API / native DSH Agent channel buttons directly above the model selector, with selected-state feedback and a persistent toolbar channel label. Show the active batch's saved channel while running; switching settings affects the next batch. API mode is clearly described as not creating DSH conversations.
- Reject recognizable pure tag lists in natural-language and hybrid caption output, including legacy caption JSON, before saving or incrementing completed counts. Preserve proper prose with commas and short captions; tags mode remains available. Do not manufacture prose by wrapping tags in a sentence.
- First public Windows portable release. Source, third-party notices, setup instructions and checksums are published separately from user data, models and credentials.

## 0.1.2 · 2026-10-29

- Default to direct image API tagging using a read-only DSH static connection or a manually configured OpenAI-compatible endpoint. No DSH conversations or task files are created by this mode. Keep optional native DSH Agent execution and explicitly describe its conversation/plugin behavior.
- Use one draft request per image by default; independent review is optional. Do not resubmit API failures automatically; pause after three consecutive failed images. Preserve paused legacy batches without resuming their old sessions.
- Save completed final content before incrementing the image count. Accept plain captions and legacy caption JSON; distinguish model refusals, process prose, missing final content and token truncation. None becomes a TXT annotation.
- Bound native image attachment payloads to avoid Relay HTTP 413. Keep the larger image budget for API requests. Do not change source images.
- Resolve DSH credentials using the documented managed-store precedence; encrypt manually entered keys with Windows DPAPI. Do not expose keys in job snapshots, renderer settings or gateway errors.
- Prevent a retained native reasoning level from blocking API model selection. Preserve native settings for switching back.
- Verified one real WD14 + WorkBuddy image API job through TXT save; isolated desktop tests verify two images/two API requests/two saved annotations and process/port release. Detailed results and limits are in docs/VERIFICATION.md.

## 0.1.1 · 2026-10-29

- Drag from blank browser space or card edges to marquee-select in both list and grid. Edge holding auto-scrolls across virtual rows; Shift adds, Ctrl toggles, Alt subtracts, and Esc restores the selection from before the gesture.
- Ctrl + wheel adjusts browser image size, with visible percentage/reset and +/- controls. Grid columns respond to available width; size survives reload and selection survives resizing.
- Full preview supports cursor-anchored Ctrl-wheel zoom, drag-to-pan, fit button and double-click reset. Layout boxes transform together with the image.
- Preserve native image drag-out and annotation editing. Suppress the trailing click after marquee selection; modal keyboard navigation no longer changes the dataset selection behind the preview.
- Verified in isolated desktop instances with 1000 indexed images; source images and existing annotations remain untouched.

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
