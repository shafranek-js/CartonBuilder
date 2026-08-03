import { spawnSync } from 'node:child_process';

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(command, ['playwright', 'test', '--workers=1'], {
  env: { ...process.env, PLAYWRIGHT_BROWSER: 'edge' },
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
