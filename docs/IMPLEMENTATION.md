# Implementation decisions — 2026-10-29

Create a new directory only. Existing Toolkit development, release and ComfyUI directories are read-only sources; no synchronization or publishing to them. Original images and installed models are borrowed read-only. New application state is under the OS user-data directory, never a source dataset.

User-approved scope: training datasets; four output presets; WD14 plus image-aware native DSH; sidecar auto-save with skip-existing default; retries leave explicit failures; collapsible assistant; a distilled OpenWork-style shell. Windows x64, Chinese interface, independent Python runtime and CPU WD14 by default. Custom presets and connection settings persist. DSH remains the native execution owner, including plugins and tools, with explicit model/run evidence. Native refusal or permission failures remain failures, not retry or prompt-bypass targets.

Implementation order: independent runtime + durable store; native desktop shell and folder import; inference, native DSH and format compilation; retry/overwrite/close lifecycle; actual browser and end-to-end verification; portable distribution and documentation. No GitHub repository is created in this task.
