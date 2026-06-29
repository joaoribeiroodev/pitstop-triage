/**
 * Pre-dev: libera as portas usadas pelo `npm run dev` matando
 * processos pendurados de execucoes anteriores. Cross-platform.
 */
import { execSync } from 'node:child_process';
import { platform } from 'node:os';

const PORTS = [Number(process.env.API_DEV_PORT ?? 3000), 4200];

function ansi(c, t) {
  return `\x1b[${c}m${t}\x1b[0m`;
}
const tag = ansi('90', '[predev]');

function kill(port) {
  const isWin = platform() === 'win32';
  try {
    if (isWin) {
      // PowerShell: lista PIDs ouvindo na porta e mata.
      const cmd = `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue; Write-Output $_ }"`;
      const out = execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      if (out) console.log(`${tag} porta ${port}: liberados PID(s) ${out.split(/\s+/).join(',')}`);
    } else {
      const out = execSync(`lsof -ti tcp:${port} 2>/dev/null || true`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      if (out) {
        execSync(`kill -9 ${out.split('\n').join(' ')}`, { stdio: 'ignore' });
        console.log(`${tag} porta ${port}: liberados PID(s) ${out.split('\n').join(',')}`);
      }
    }
  } catch {
    /* sem processos para matar */
  }
}

for (const p of PORTS) kill(p);
