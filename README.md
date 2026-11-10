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

## License

Vovis is distributed under the [MIT License](LICENSE). UI components adapted from shadcn/ui carry the [upstream MIT notice](licenses/shadcn-ui.txt).
