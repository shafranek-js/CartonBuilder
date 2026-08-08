import { spawnSync } from 'node:child_process';
import path from 'node:path';

// Calling npx.cmd through spawnSync is rejected with EINVAL on Windows
// runners. Invoke Playwright's checked-in CLI with the active Node runtime so
// the Edge job behaves consistently on local Windows and GitHub Actions.
const playwrightCli = path.resolve('node_modules/playwright/cli.js');
const result = spawnSync(process.execPath, [playwrightCli, 'test', '--workers=1'], {
  env: { ...process.env, PLAYWRIGHT_BROWSER: 'edge' },
  stdio: 'inherit',
});

if (result.error) console.error(result.error);
process.exit(result.status ?? 1);
