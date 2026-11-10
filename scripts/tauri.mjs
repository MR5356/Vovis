import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Prefer rustup proxies over an older Cargo installed by a version manager.
// Keep the user's global shell configuration unchanged.
const env = { ...process.env };
const executable = process.platform === 'win32' ? 'rustup.exe' : 'rustup';
const candidates = [
  env.CARGO_HOME && join(env.CARGO_HOME, 'bin'),
  join(homedir(), '.cargo', 'bin'),
].filter(Boolean);
const rustupBin = candidates.find((directory) => existsSync(join(directory, executable)));
if (rustupBin) env.PATH = `${rustupBin}${delimiter}${env.PATH ?? ''}`;
const cargo = spawnSync('cargo', ['--version'], { env, encoding: 'utf8' });
if (cargo.error || cargo.status !== 0) {
  console.error('Rust toolchain unavailable. Install stable Rust with rustup before starting Tauri.');
  process.exit(1);
}
console.log(`Using ${cargo.stdout.trim()}`);
const cli = fileURLToPath(new URL('../node_modules/@tauri-apps/cli/tauri.js', import.meta.url));
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], { env, stdio: 'inherit' });
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
