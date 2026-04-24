# DEPRECATED: Electron Embedded Backend

This directory is a legacy implementation of the FlowCube desktop client.

It bundled and started the backend process from Electron (`../backend/index.js`) and served the UI from `localhost:3000`. That architecture is no longer the production desktop chain.

Current desktop entrypoint:

- Source: `/desktop`
- Main process: `/desktop/main.js`
- Build output: `/desktop/release`
- Release script: `/scripts/release-desktop.js`
- Update/download root: `/var/www/flowcube-downloads`

Do not build or publish packages from this directory. It is retained only for historical reference while the project finishes legacy cleanup.
