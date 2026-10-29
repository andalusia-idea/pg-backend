const { spawn } = require('child_process');

const profile = "PG";
const dir = 'C:\\le\\andalusia\\pg';
const apps = ['auth', "config", "transaction"]; // add 'config', 'transaction', 'settlement' as needed

console.log('🚀 [TEST] Reset, migrate and seed in Windows Terminal...\n');

const args = [];

apps.forEach((app, i) => {
  if (i !== 0) args.push(';');

  const command = [
    `npx dotenv -e apps/${app}/.env.test -- prisma migrate reset --force --config apps/${app}/prisma.config.ts`,
    `npx dotenv -e apps/${app}/.env.test -- prisma db seed --config apps/${app}/prisma.config.ts -- --dev`,
  ].join(' && ');

  args.push('-p', profile, '-d', dir, '--', 'cmd', '/k', command);
});

spawn('wt', args, { stdio: 'inherit' });
