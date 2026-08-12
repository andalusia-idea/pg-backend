const { spawn } = require('child_process');
const path = require('path');

const services = [
  { profile: 'PG', dir: 'C:\\le\\andalusia\\pg', script: 'start:dashboard' },
  { profile: 'PG', dir: 'C:\\le\\andalusia\\pg', script: 'start:auth' },
  { profile: 'PG', dir: 'C:\\le\\andalusia\\pg', script: 'start:config' },
  { profile: 'PG', dir: 'C:\\le\\andalusia\\pg', script: 'start:transaction' },
];

console.log('🚀 Starting all services in Windows Terminal...\n');

let windowsTerminalArgs = ['-p', 'PG', '-d', services[0].dir, '--', 'cmd', '/k', `cd ${services[0].dir} && npm run ${services[0].script}`];

// Add remaining services
for (let i = 1; i < services.length; i++) {
  const service = services[i];
  windowsTerminalArgs.push(';');
  windowsTerminalArgs.push('-p', service.profile, '-d', service.dir, '--', 'cmd', '/k', `cd ${service.dir} && npm run ${service.script}`);
}

// Launch Windows Terminal
spawn('wt', windowsTerminalArgs, { stdio: 'inherit' });
