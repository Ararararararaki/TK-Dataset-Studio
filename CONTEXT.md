# TK Dataset Studio · domain and ownership

Version 0.1.4. An independent Windows desktop for image-training annotations, extracted at the behavior boundary from the Toolkit Agent. No ComfyUI imports, Torch installation, shared Python mutation or existing repository deployment.

## Vocabulary

- **Dataset**: one indexed source directory, not a copied or managed image library.
- **Image**: registered source file with EXIF-oriented dimensions, annotation revision, sidecar digest, WD14 evidence and optional native DSH metadata.
- **Preset**: output format, pipeline, guidance and review choice. User presets are durable; built-ins remain available.
- **Batch / job**: persisted configuration snapshot and per-image draft/review/run state. Only one inference batch runs at a time.
- **Annotation**: final training text or MOSS JSON, saved atomically as a sidecar. Process prose is task state, not an annotation.
- **Reference**: fallible character evidence from WD14 candidates, cached public records or a user snapshot; never a spatial detector.

## Module boundaries

| Module | Sole responsibility |
| --- | --- |
| `electron/main.cjs` | Window, dialogs, registered-image protocol, process owner, close handshake |
| `electron/bridge.cjs` | Correlated stdio RPC and owned Python lifecycle |
| `src/App.tsx` | Workspace presentation, virtualization, selection and configuration drafts |
| `src/useBrowserGestures.ts` | Cancellable marquee and Ctrl-wheel gestures, using virtual content geometry; no separate selection state |
| `src/components/ImagePreview.tsx` | Image and Layout overlay share cursor-anchored zoom, bounded panning and fit reset |
| `src/components/ImageEntry.tsx`, `src/drafts.ts` | Serialized editor saves, durable local draft and revision reconciliation |
| `backend/server.py` | One coordinator, public dispatch, settings and service ownership |
| `backend/store.py` | SQLite/WAL, revision checks, sidecars, backups, thumbnail cache |
| `backend/jobs.py` | Batch snapshot, bounded WD14 pool plus LLM concurrency slots, durable save/count, bounded failure, pause/cancel |
| `backend/connections.py` | Read-only static DSH API configuration, live credential resolution and DPAPI manual keys |
| `backend/api_transport.py` | Single API/bridge/Agent routing owner; stateless image request, final-content SSE, no silent fallback |
| `backend/images.py`, `backend/responses.py` | Image attachment budgets and shared final-response/refusal classification |
| `backend/tagger.py` | ONNX + matching CSV preprocessing/inference, isolated in a child process |
| `backend/native.py` | Relay MCP, real image attachments, exact registered workspace, final extraction |
| `backend/host_bridge.py` | Loopback HTTP client for the in-DSH bridge plugin: one model call per image, no session, plugin tools callable |
| `dsh-bridge/` | DSH plugin exposing `/tk-annotate/{status,run,tool}` through `ctx.webServer` and `ctx.llm.stream`, with an offline harness |
| `backend/presets.py` | Task format contracts and deterministic source-pixel Layout compilation |
| `backend/references.py` | Cache/snapshot evidence, bounded daily maintenance, missing-record lookup |
| `backend/agent_api.py`, `backend/agent_mcp.py` | Authenticated loopback and stdio adapters over the same coordinator |

GUI and Agent mutations share the same store and task owner. No separate Agent database. The renderer has no Node/file-system access; preload exposes a method allowlist. Source images remain external. Runtime and model process ownership are independent of ComfyUI.

## Persistence and recovery

SQLite owns datasets, versions, presets, batch state and settings. TXT is checked by digest before write; generated content cannot silently overwrite manual/external edits. Backups and unsaved draft recovery supplement the atomic file write. A batch snapshots provider/model and guidance; changing the UI affects the next batch. On restart, unfinished work is paused; stored native IDs avoid blind resubmission.

## Known seams for future work

Large-folder import cancellation, richer history diff, direct region editing and provider-independent native adapters can be added without changing sidecar ownership. Current Layout preview is an inspection overlay; it is not a box drawing editor. Semantic accuracy remains dependent on the selected vision model and requires visual review on dense collages.
