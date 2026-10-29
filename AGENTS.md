# TK Dataset Studio

Independent Windows desktop application. No ComfyUI runtime imports, no changes to the Toolkit release repositories. React/TypeScript renderer, isolated Electron IPC, Python coordinator/SQLite and separate inference process. The coordinator owns durable state; the renderer owns only presentation and drafts.

- External network uses explicit Clash HTTP proxy http://127.0.0.1:7890; loopback bypasses proxies. Never silently retry external downloads without the proxy.
- Do not change source images. Sidecars are skipped by default; explicit replacements have a revision and backup. Preserve manual changes against in-flight inference.
- DSH uses its public native Relay and actual image attachments. Keep native permission enforcement and installed plugin configuration. Never implement policy bypasses or copy dsh-purge internals.
- Source attribution in THIRD-PARTY-NOTICES.md; do not import OpenWork ee/ or GPL UI code.
- Check with npm run build, npm test, runtime/python.exe -m unittest discover -s tests -p "test_*.py", and packaged Electron browser verification. Changes require accurate limitations in docs/VERIFICATION.md.
