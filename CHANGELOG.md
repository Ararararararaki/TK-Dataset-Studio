# Changelog

## 0.2.0 · 2026-10-30

- Add a DSH port bridge channel that runs one model call inside the already-running Harness over HTTP, so the host's loaded plugins and provider credentials apply while no DSH conversation, session or task file is created. Ship the bridge as an installable plugin (`dsh-bridge/`) exposing `GET /tk-annotate/status`, `POST /tk-annotate/run`, `POST /tk-annotate/tool` and `GET /tk-annotate/models`; accept loopback callers only. Verified on a real host: 471 registered tools including `purge_status` / `purge_apply` / `purge_revert`, and images reach the model.
- Make the bridge channel the recommended path when plugins must actually run. Read the host's provider and model catalog and its reasoning levels from the bridge instead of typing them; keep the API channel for direct stateless requests and describe the native Agent channel as the only one that creates a conversation.
- Run WD14 tagging in a bounded process pool and gate LLM requests with their own concurrency slots, so one image can be tagged while another is already under review. Default both to 2, clamp to 1–8, and pause the batch after three consecutive failures or an authentication error.
- Rewrite the natural-language caption guidance to match the reference dataset's measured shape: one paragraph, 44–59 words, 250–335 characters, at most two sentences, main subject first, scene anchor clause as the usual close, no finite copula, no per-body-part inventory, no colon attribute lists. Raise the default WD14 threshold from 0.35 to 0.6 so weak background tags stop crowding the annotation.
- Deep-merge the WD14 settings block and validate both thresholds against their real ranges, so saving one field no longer discards the model, device, character threshold and exclusion list, and a boolean or out-of-range value is rejected instead of stored.
- Add regression tests for the bridge client, the concurrency contracts and the caption presets, plus an offline harness that exercises the plugin's three routes without a live host. Document the measured throughput, the reasoning-token budget that starves visible output, and the upstream content refusals in docs/VERIFICATION.md and docs/CAPTION-QA.md.

## 0.1.4 · 2026-10-30

- Split overwrite and TXT backup into two persistent controls. Disabling backup affects automatic batches, manual edits and Agent saves; revision history and conflict checks remain. Retag confirmation reflects the selected backup behavior. Existing backups are not deleted.
- Add thumbnail-grid hover previews for complete saved annotations, with scrolling, copying, keyboard focus and Escape dismissal. Preview one image on demand, cache at most 128 revisions, constrain the popup to the window and dismiss on browser scrolling. No LLM calls or bulk caption loading.
- First public Windows portable release, including 0.1.3 fixes. Source, third-party notices, setup instructions and checksums are published separately from user data, models and credentials.

## 0.1.3 · 2026-10-30

- Fix invisible Skill names: the expanded-section full-width input rule also stretched checkboxes, pushing names outside the inspector. Restrict it to non-checkbox inputs and wrap long names inside their row. Show selected Skill count and preserve selection after reload.
- Add API / native DSH Agent channel buttons directly above the model selector, with selected-state feedback and a persistent toolbar channel label. Show the active batch's saved channel while running; switching settings affects the next batch. API mode is clearly described as not creating DSH conversations.
- Reject recognizable pure tag lists in natural-language and hybrid caption output, including legacy caption JSON, before saving or incrementing completed counts. Preserve proper prose with commas and short captions; tags mode remains available. Do not manufacture prose by wrapping tags in a sentence.

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
