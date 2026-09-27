// One-time setup: Node deps for root/server/client and a Python virtualenv for the engine.
import { execSync } from 'node:child_process';
import { existsSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, cwd = root) => {
  console.log(`\n> ${cmd}  (${path.relative(root, cwd) || '.'})`);
  execSync(cmd, { cwd, stdio: 'inherit' });
};

const findPython = () => {
  for (const cmd of ['python3', 'python', 'py -3']) {
    try {
      const v = execSync(`${cmd} --version`, { stdio: 'pipe' }).toString();
      const [maj, min] = v.match(/(\d+)\.(\d+)/).slice(1).map(Number);
      if (maj === 3 && min >= 10) return cmd;
    } catch { /* try next */ }
  }
  throw new Error('Python 3.10+ is required. Install it from python.org and re-run `npm run setup`.');
};

run('npm install');
run('npm install', path.join(root, 'server'));
run('npm install', path.join(root, 'client'));

const engine = path.join(root, 'engine');
if (!existsSync(path.join(engine, '.venv'))) run(`${findPython()} -m venv .venv`, engine);
const pip = process.platform === 'win32' ? '.venv\Scripts\python -m pip' : '.venv/bin/python -m pip';
run(`${pip} install -r requirements.txt`, engine);

if (!existsSync(path.join(root, '.env'))) {
  copyFileSync(path.join(root, '.env.example'), path.join(root, '.env'));
  console.log('\nCreated .env — add your ANTHROPIC_API_KEY to enable the Claude engine (optional).');
}
console.log('\nSetup complete. Run `npm run dev` and open http://localhost:5173');
