const { spawn } = require('child_process');

const profile = 'PG';
const dir = 'C:\\le\\andalusia\\pg';
const apps = ['auth', 'config', 'transaction', 'settlement'];

console.log('🚀 [TEST] Starting all services in Windows Terminal...\n');

const args = [];

apps.forEach((app, i) => {
  if (i !== 0) args.push(';');

  const command = `npx dotenv -v NODE_ENV=test -- nest start ${app} --watch`;

  args.push('-p', profile, '-d', dir, '--', 'cmd', '/k', command);
});

spawn('wt', args, { stdio: 'inherit' });
