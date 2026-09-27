// Starts the Python engine from its virtualenv on any OS.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engineDir = path.join(root, 'engine');
const venvPython = process.platform === 'win32'
  ? path.join(engineDir, '.venv', 'Scripts', 'python.exe')
  : path.join(engineDir, '.venv', 'bin', 'python');

if (!existsSync(venvPython)) {
  console.error('Python virtualenv not found — run `npm run setup` first.');
  process.exit(1);
}

const args = ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', process.env.ENGINE_PORT || '8001'];
// WatchFiles reload hangs on some Windows setups, so hot reload is POSIX-only.
if (process.argv.includes('--reload') && process.platform !== 'win32') args.push('--reload', '--reload-dir', 'app', '--timeout-graceful-shutdown', '1');

const child = spawn(venvPython, args, { cwd: engineDir, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
