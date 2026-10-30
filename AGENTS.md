# TK Dataset Studio

Independent Windows desktop application. No ComfyUI runtime imports, no changes to the Toolkit release repositories. React/TypeScript renderer, isolated Electron IPC, Python coordinator/SQLite and separate inference process. The coordinator owns durable state; the renderer owns only presentation and drafts.

- External network uses explicit Clash HTTP proxy http://127.0.0.1:7890; loopback bypasses proxies. Never silently retry external downloads without the proxy.
- Do not change source images. Sidecars are skipped by default; explicit replacements retain revisions and follow the user's configurable TXT-backup preference (on by default). Preserve manual changes against in-flight inference even when backup is off.
- Default annotation reuses DSH's static API connection and transmits image bytes directly, without creating conversations. The port-bridge transport posts one image to a running DSH host (`dsh-bridge/`, loopback HTTP, no session) so the host's own plugins apply. Optional native Agent execution uses the public Relay and real image attachments and does create a session. 
- Source attribution in THIRD-PARTY-NOTICES.md; do not import OpenWork ee/ or GPL UI code.
- Check with npm run build, npm test, runtime/python.exe -m unittest discover -s tests -p "test_*.py", and packaged Electron browser verification. Changes require accurate limitations in docs/VERIFICATION.md.
