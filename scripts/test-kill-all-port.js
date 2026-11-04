const { execSync } = require('child_process');
const os = require('os');

const ports = [3000, 3001, 3002, 3003, 3004, 3010];
const isWin = os.platform() === 'win32';

// Windows: read netstat once, map port -> set of listening PIDs
function listeningPidsWindows() {
  const out = execSync('netstat -ano', { encoding: 'utf8' });
  const byPort = new Map();

  for (const line of out.split(/\r?\n/)) {
    // Proto  Local Address  Foreign Address  State  PID
    const cols = line.trim().split(/\s+/);
    if (cols.length !== 5 || !cols[0].startsWith('TCP') || cols[3] !== 'LISTENING') continue;

    const port = Number(cols[1].slice(cols[1].lastIndexOf(':') + 1)); // exact port, IPv4 and IPv6
    const pid = Number(cols[4]);
    if (!pid) continue;

    if (!byPort.has(port)) byPort.set(port, new Set());
    byPort.get(port).add(pid);
  }
  return byPort;
}

function listeningPidsUnix(port) {
  try {
    const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: 'utf8' });
    return new Set(out.split('\n').filter(Boolean).map(Number));
  } catch {
    return new Set(); // lsof exits 1 when nothing is listening
  }
}

const windowsMap = isWin ? listeningPidsWindows() : null;

for (const port of ports) {
  const pids = isWin ? windowsMap.get(port) ?? new Set() : listeningPidsUnix(port);

  if (pids.size === 0) {
    console.log(`⚪ Port ${port} is free`);
    continue;
  }

  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM'); // on Windows this always terminates immediately
      console.log(`✅ Killed port ${port} (PID ${pid})`);
    } catch (err) {
      console.log(`⚠️  Port ${port}: could not kill PID ${pid} (${err.code})`);
    }
  }
}
