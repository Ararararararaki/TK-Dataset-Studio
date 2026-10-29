# Third-party notices

## OpenWork

The small resizable panel adapter in src/components/Resizable.tsx is adapted from OpenWork v0.18.63, commit 9add0d2b8374d79537588c2303be5021e8605d48, apps/app/src/components/ui/resizable.tsx. The workspace navigation and restrained visual hierarchy also reference its desktop UI. No ee/ modules, telemetry, account services or OpenCode engine are included.

Source: https://github.com/different-ai/openwork/tree/v0.18.63

Copyright (c) 2026-present Different AI, Inc. MIT License — Copyright (c) 2026 Different AI.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## WD14 preprocessing

backend/tagger.py adapts EXIF-aware square-padding/BGR preprocessing from ComfyUI-WD14-Tagger, copyright (c) 2024 pythongosssss, MIT License. The same MIT permission and warranty text above applies.

Source: https://github.com/pythongosssss/ComfyUI-WD14-Tagger

## Toolkit compatibility reference

The final-message marker contract and separation of process text from training annotations reference comfyui-anima-toolkit. Its current repository LICENSE is GPL-3.0, not MIT. This project implements a separate envelope parser and does not ship or import services/prompt_agent/native_execution.py or the ComfyUI plugin. The reference is a protocol/behavior reference, not a claim that the Toolkit repository is MIT.

Source: https://github.com/Ararararararaki/comfyui-anima-toolkit

WD14 model weights are not bundled and retain their respective model-card licenses. TagGUI was a behavior reference only; no GPL source was copied. The MOSS pixel-to-centered coordinate adapter is an independent implementation of the published data contract; no unlicensed compiler or GPL editor is bundled.

PyYAML 6.0.3 (MIT, https://github.com/yaml/pyyaml) is used for read-only static connection configuration. Its license is retained with the bundled distribution. Unknown and JavaScript YAML tags are not executed.

Other package licenses are retained in distributed dependencies. Python/NumPy/Pillow/ONNX Runtime/MCP and Electron/Chromium notices are included by their distributions.
