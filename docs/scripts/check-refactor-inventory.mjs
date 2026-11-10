import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: scriptDir, encoding: 'utf8' }).trim();
const args = process.argv.slice(2);
const allowed = new Set(['--sync', '--require-accepted']);
const registryArg = args.find((arg) => arg.startsWith('--registry='));
if (args.some((arg) => !allowed.has(arg) && arg !== registryArg)) throw new Error('Unknown inventory argument');
if (args.includes('--sync') && args.includes('--require-accepted')) throw new Error('Sync is not an acceptance check');
const registryPath = registryArg ? registryArg.slice('--registry='.length) : join(root, 'docs/refactor/module-registry.json');
const code = /\.(?:rs|svelte|[cm]?js|jsx|ts|tsx|py|ps1|sh|css|sql|glsl|vert|frag|html)$/;
const manifests = /(?:^|\/)(?:Cargo\.toml|package\.json|tauri\.conf\.json|pyproject\.toml|Dockerfile|docker-compose[^/]*\.ya?ml|nginx\.conf)$/;
const paths = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0'))]
  .filter((path) => path && !/^(?:\.pi|\.claude)\//.test(path) && (code.test(path) || manifests.test(path)) && existsSync(join(root, path))).sort();
let registry;
try { registry = JSON.parse(readFileSync(registryPath, 'utf8')); }
catch (error) {
  if (!args.includes('--sync') || error.code !== 'ENOENT') throw error;
  registry = { version: 1, contractMatrix: 'module-contracts.md', sources: [] };
}
if (registry.version !== 1 || !Array.isArray(registry.sources)) throw new Error('Unsupported inventory schema');
const entries = new Map();
for (const entry of registry.sources) {
  if (!entry || typeof entry.path !== 'string' || entries.has(entry.path)) throw new Error('Invalid or duplicate source entry');
  if (typeof entry.module !== 'string' || !entry.module.trim()
    || !['pending', 'retain', 'refactor', 'approved-fix', 'historical'].includes(entry.disposition)
    || !Array.isArray(entry.evidence) || entry.evidence.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`Malformed inventory metadata: ${entry.path}`);
  }
  entries.set(entry.path, entry);
}
if (args.includes('--sync')) {
  registry.sources = paths.map((path) => entries.get(path) ?? {
    path,
    module: path.replace(/\.(?:test|check)(?=\.)/, '').replace(/\.[^.\/]+$/, ''),
    disposition: 'pending',
    evidence: [],
  });
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
  console.log(`Synchronized ${paths.length} source entries; new entries remain pending. Review removals in Git diff.`);
} else {
  const current = new Set(paths);
  const missing = paths.filter((path) => !entries.has(path));
  const stale = [...entries.keys()].filter((path) => !current.has(path));
  const pending = registry.sources.filter((entry) => entry.disposition === 'pending' || entry.evidence.length === 0);
  for (const [label, items] of [['Unregistered', missing], ['Removed', stale]]) {
    if (items.length) console.error(`${label}:\n${items.join('\n')}`);
  }
  if (missing.length || stale.length) process.exitCode = 1;
  if (args.includes('--require-accepted') && pending.length) {
    console.error(`Acceptance incomplete: ${pending.length} entries lack a disposition or evidence.`);
    process.exitCode = 1;
  }
  console.log(`${relative(root, registryPath)}: ${paths.length} sources; ${pending.length} pending. Inventory completeness is not behavioral acceptance.`);
}
