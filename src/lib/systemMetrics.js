// Le uso de CPU/memoria/disco da maquina onde o processo esta rodando.
// Sem dependencia nova: os.loadavg()/os.totalmem() refletem a VPS inteira
// (Docker nao isola isso por padrao sem limite de cgroup configurado, que
// hoje nao existe no Easypanel) - por isso serve pra acompanhar o gasto da
// VPS compartilhada como um todo, nao so do container. Se um dia passar a
// limitar CPU/memoria por servico, esses numeros passam a refletir so o
// container.
'use strict';

const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

async function readDiskUsage() {
  try {
    const { stdout } = await execAsync('df -k /');
    const line = stdout.trim().split('\n')[1];
    const parts = line.split(/\s+/);
    const totalKb = Number(parts[1]);
    const usedKb = Number(parts[2]);
    return {
      diskUsedGb: Math.round((usedKb / 1024 / 1024) * 100) / 100,
      diskTotalGb: Math.round((totalKb / 1024 / 1024) * 100) / 100,
    };
  } catch {
    return { diskUsedGb: null, diskTotalGb: null };
  }
}

async function sampleNow() {
  const [loadAvg1m] = os.loadavg();
  const cpuCores = os.cpus().length;
  const memTotalMb = Math.round(os.totalmem() / 1024 / 1024);
  const memUsedMb = memTotalMb - Math.round(os.freemem() / 1024 / 1024);
  const { diskUsedGb, diskTotalGb } = await readDiskUsage();

  return {
    loadAvg1m: Math.round(loadAvg1m * 100) / 100,
    cpuCores,
    memUsedMb,
    memTotalMb,
    diskUsedGb,
    diskTotalGb,
  };
}

module.exports = { sampleNow };
