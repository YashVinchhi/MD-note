const { spawnSync } = require('child_process');
const { readdirSync, statSync } = require('fs');
const { join } = require('path');

const ROOT = process.cwd();
const IGNORE_DIRS = new Set(['node_modules', '.git', '__pycache__', 'mcp-server.disabled']);

function walk(dir, files = []) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), files);
      continue;
    }
    if (entry.name.endsWith('.js')) {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}

const files = walk(ROOT);
let hasError = false;

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    hasError = true;
    console.error(`\nSyntax check failed: ${file}`);
    if (result.stderr) console.error(result.stderr);
    if (result.stdout) console.error(result.stdout);
  }
}

if (hasError) {
  process.exit(1);
}

console.log(`Checked ${files.length} JS files.`);
