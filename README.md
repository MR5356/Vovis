# Vovis

Vovis is a desktop app for presenting PDF slides with AI narration. Prepare speaker notes, rehearse, and present in a separate audience window. During a talk, Vovis can review Feishu meeting questions, answer them using the presentation material, and resume at the interrupted sentence. Session records support replay and video export.

## Development

Prerequisites: Node.js 22+, current stable Rust, and the platform prerequisites from [Tauri](https://v2.tauri.app/start/prerequisites/).

```sh
npm ci
npm run desktop:dev
```

`npm run tauri dev` is also supported. The project launcher prioritizes rustup from `$CARGO_HOME/bin` or `~/.cargo/bin`, avoiding older Cargo binaries earlier on the shell PATH without changing global shell settings.

`desktop:dev` starts Vite on port 5173. Stop a separately started Vite server first. Browser-only UX preview remains available with `npm run dev`.

```sh
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run desktop:build
```

## Architecture

- `src/domain`: shared types, runtime workspace validation, and prompt construction.
- `src/infrastructure`: typed Tauri bridge; initial hydration and serialized writes.
- `src/components`: native window drag region, audience window, real model generation / TTS preview, and error boundary.
- `src-tauri/src/commands.rs`: window-scoped IPC boundary; blocking persistence runs in a worker.
- `src-tauri/src/storage.rs`: versioned SQLite workspace, immutable PDF files, atomic local credential file writes. No OS keychain.
- `src-tauri/src/providers`: provider protocol implementations, bounded responses, timeouts, and credential handling within Rust.
- `src-tauri/src/window`: native OS controls and audience window lifecycle. macOS uses overlay titlebar and native traffic lights; Windows DWM and Linux GTK use platform modules.

The native renderer hydrates SQLite before mounting. Invalid saved data produces an error screen instead of overwriting it. PDF resources use immutable IDs so later imports do not replace historical assets. Credentials are separate from project data and exports. Browser preview does not accept real credentials.

## GitHub releases and updates

Push a stable version tag to build the desktop release. The tag sets the bundled application version, so pushing `v0.2.1` produces version `0.2.1` even if the development version is older.

```sh
git tag v0.2.1
git push origin v0.2.1
```

The release includes macOS DMGs for Apple silicon and Intel, Windows NSIS installers for x64 and ARM64, and Linux AppImages for x64 and ARM64. The workflow verifies every update package with the public key embedded in Vovis before publishing the installers and `latest.json` together.

Before the first tag, add the matching private key as the repository Actions secret `TAURI_SIGNING_PRIVATE_KEY`. If the key is encrypted, also set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Keep a private backup of this key for future updates. For an independent fork, generate a separate key with `npm run tauri -- signer generate -w <private-key-path>`, set the public key and release endpoint in `src-tauri/tauri.conf.json`, and configure the fork's own secrets.

The desktop project list checks for updates at startup. An available version can be downloaded, verified and installed from the sidebar. Settings also provides a manual check. For Linux in-app updates, run the downloaded AppImage from a writable location.

## License

Vovis is distributed under the [MIT License](LICENSE). UI components adapted from shadcn/ui carry the [upstream MIT notice](licenses/shadcn-ui.txt).
