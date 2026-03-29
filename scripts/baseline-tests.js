#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const reportsDir = path.join(rootDir, 'reports', 'baseline');
const npmCmd = process.platform === 'win32' ? 'npm' : 'npm';

function runStep(name, args) {
  const startedAt = Date.now();
  const command = `${npmCmd} ${args.join(' ')}`;
  const result = spawnSync(command, {
    cwd: rootDir,
    encoding: 'utf-8',
    stdio: 'pipe',
    shell: true
  });
  const endedAt = Date.now();

  return {
    name,
    command,
    status: result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status,
    durationMs: endedAt - startedAt,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error ? String(result.error) : null
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeReport(report) {
  ensureDir(reportsDir);
  const outPath = path.join(reportsDir, 'test-baseline.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
  return outPath;
}

function main() {
  const startedAt = new Date().toISOString();
  const steps = [
    runStep('lint:js', ['run', 'lint:js']),
    runStep('test:js', ['run', 'test:js']),
    runStep('test:py', ['run', 'test:py'])
  ];

  const report = {
    generatedAt: startedAt,
    nodeVersion: process.version,
    platform: process.platform,
    steps,
    summary: {
      total: steps.length,
      passed: steps.filter((s) => s.status === 'passed').length,
      failed: steps.filter((s) => s.status === 'failed').length,
      durationMs: steps.reduce((acc, s) => acc + s.durationMs, 0)
    }
  };

  const outPath = writeReport(report);

  console.log(`Wrote baseline test report: ${outPath}`);
  console.log(`Passed: ${report.summary.passed}/${report.summary.total}`);

  if (report.summary.failed > 0) {
    process.exit(1);
  }
}

main();
