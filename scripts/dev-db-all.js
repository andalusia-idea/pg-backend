const { spawn } = require('child_process');

const profile = "PG";
const dir = 'C:\\le\\andalusia\\pg';
// const apps = ['auth', "config", "transaction"];
const apps = [
  { name: 'auth',        color: '#10AC84' },
  { name: 'config',      color: '#F39C12' },
  { name: 'transaction', color: '#EE5253' },
]

console.log('🚀 [TEST] Reset, migrate and seed in Windows Terminal...\n');

const args = [];

apps.forEach((app, i) => {
  if (i !== 0) args.push(';');

  const command = [
    `npx dotenv -e apps/${app.name}/.env.local -- prisma migrate reset --force --config apps/${app.name}/prisma.config.ts`,
    // `npx dotenv -e apps/${app}/.env.test -- prisma db seed --config apps/${app}/prisma.config.ts -- --dev`,
    `npx dotenv -e apps/${app.name}/.env.local -- prisma db seed --config apps/${app.name}/prisma.config.ts`,
  ].join(' && ');

  args.push(
    '-p', profile,
    '-d', dir,
    "--title", `Reset DEV ${app.name}`,
    '--suppressApplicationTitle',
    "--tabColor", app.color,
    '--',
    'cmd', '/k', command
  );
});

spawn('wt', args, { stdio: 'inherit' });
