const { spawn } = require('child_process');

const profile = 'PG';
const dir = 'C:\\le\\andalusia\\pg';
// const apps = ['dashboard', 'auth', 'config', 'transaction', 'settlement', 'uat-local'];
const apps = [
  { name: 'dashboard',   color: '#2E86DE' },
  { name: 'auth',        color: '#10AC84' },
  { name: 'config',      color: '#F39C12' },
  { name: 'transaction', color: '#EE5253' },
  { name: 'settlement',  color: '#8E44AD' },
  // { name: 'uat-local',   color: '#576574' },
];

console.log('🚀 [DEV] Starting all services in Windows Terminal...\n');

const args = [];

apps.forEach((app, i) => {
  if (i !== 0) args.push(';');

  const command = `npx dotenv -v NODE_ENV=development -- nest start ${app.name} --watch`;

  args.push(
    '-p', profile,
    '-d', dir,
    "--title", `DEV ${app.name}`,
    '--suppressApplicationTitle',
    "--tabColor", app.color,
    '--',
    'cmd', '/k', command
  );
});

spawn('wt', args, { stdio: 'inherit' });
