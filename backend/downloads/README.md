# DEPRECATED

`backend/downloads` is no longer part of the FlowCube desktop update chain.

Use the canonical server directory instead:

```text
/var/www/flowcube-downloads
  latest.json
  versions/
  current/
```

Desktop releases must be published with:

```bash
node scripts/release-desktop.js x.x.x --artifact=/path/to/FlowCube-Setup-x.x.x.exe
```

Do not place installers, `latest.json`, or release manifests in this directory.

The public `/downloads/` route is a deprecated compatibility alias for legacy clients only:

- It must only serve GET/HEAD static downloads.
- New manifests must not use `/downloads/...`; use `/versions/...` or `/current/...`.
- Planned removal target: `v0.5.0`, after 30 days with no `/downloads/` access logs and all managed clients upgraded to `>=0.3.72`.
