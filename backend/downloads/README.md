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
