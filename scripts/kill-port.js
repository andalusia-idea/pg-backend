const { execSync } = require('child_process');
const os = require('os');

const port = process.argv[2];

if (!port) {
  console.error('Usage: npm run kill-port <port>');
  process.exit(1);
}

try {
  if (os.platform() === 'win32') {
    execSync(`for /f "tokens=5" %a in ('netstat -ano ^| findstr :${port}') do taskkill /PID %a /F`, { stdio: 'inherit' });
  } else {
    execSync(`lsof -ti:${port} | xargs kill -9`, { stdio: 'inherit' });
  }
  console.log(`✅ Killed port ${port}`);
} catch (error) {
  console.log(`Port ${port} is free or no process found`);
}
