const { execSync } = require('child_process');
const os = require('os');

let currentPort = 3000;
try {
  const ports = [3000, 3001, 3002, 3003, 3004, 3010];
  for (const port of ports){
    currentPort = port;
    if (os.platform() === 'win32') {
      execSync(`for /f "tokens=5" %a in ('netstat -ano ^| findstr :${port}') do taskkill /PID %a /F`, { stdio: 'inherit' });
    } else {
      execSync(`lsof -ti:${port} | xargs kill -9`, { stdio: 'inherit' });
    }
    console.log(`✅ Killed port ${port}`);
  }

} catch (error) {
  console.log(`Port ${currentPort} is free or no process found`);
  console.log(error);
}
