import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const checker = fileURLToPath(new URL('./check-refactor-inventory.mjs', import.meta.url));

function sandbox(run) {
  const root = mkdtempSync(join(tmpdir(), 'watchdemo-inventory-'));
  try {
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, 'docs/refactor'), { recursive: true });
    copyFileSync(checker, join(root, 'scripts/check-refactor-inventory.mjs'));
    writeFileSync(join(root, 'src/module.ts'), 'export const value = 1;\n');
    const init = spawnSync('git', ['init', '--quiet', root], { encoding: 'utf8' });
    assert.equal(init.status, 0, init.stderr);
    const registryPath = join(root, 'docs/refactor/module-registry.json');
    const invoke = (...args) => {
      const result = spawnSync(process.execPath, [join(root, 'scripts/check-refactor-inventory.mjs'), ...args], {
        cwd: root, encoding: 'utf8', timeout: 10_000,
      });
      assert.ifError(result.error);
      return { status: result.status, output: result.stdout + result.stderr };
    };
    const read = () => JSON.parse(readFileSync(registryPath, 'utf8'));
    const write = (value) => writeFileSync(registryPath, `${JSON.stringify(value, null, 2)}\n`);
    run({ root, invoke, read, write, registryPath });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('sync inventories sources without accepting their behavior', () => sandbox(({ invoke, read }) => {
  assert.equal(invoke('--sync').status, 0);
  const registry = read();
  assert.deepEqual(registry.sources.map((entry) => entry.path), ['scripts/check-refactor-inventory.mjs', 'src/module.ts']);
  assert.ok(registry.sources.every((entry) => entry.disposition === 'pending' && entry.evidence.length === 0));
  assert.equal(invoke().status, 0);
  const acceptance = invoke('--require-accepted');
  assert.equal(acceptance.status, 1);
  assert.match(acceptance.output, /Acceptance incomplete: 2/);
}));

test('sync preserves accepted entries while new and removed files require review', () => sandbox(({ root, invoke, read, write }) => {
  assert.equal(invoke('--sync').status, 0);
  const registry = read();
  const accepted = registry.sources.find((entry) => entry.path === 'src/module.ts');
  accepted.module = 'fixture-owned-module';
  accepted.disposition = 'retain';
  accepted.evidence = ['fixture: accepted metadata must survive synchronization'];
  write(registry);
  writeFileSync(join(root, 'src/new.py'), 'value = 1\n');
  assert.match(invoke().output, /Unregistered:\s+src\/new.py/);
  assert.equal(invoke().status, 1);
  assert.equal(invoke('--sync').status, 0);
  assert.equal(read().sources.find((entry) => entry.path === 'src/new.py').disposition, 'pending');
  assert.deepEqual(read().sources.find((entry) => entry.path === 'src/module.ts'), accepted);
  const add = spawnSync('git', ['add', 'src/module.ts'], { cwd: root, encoding: 'utf8' });
  assert.equal(add.status, 0, add.stderr);
  rmSync(join(root, 'src/module.ts'));
  const removed = invoke();
  assert.equal(removed.status, 1);
  assert.match(removed.output, /Removed:\s+src\/module.ts/);
  assert.equal(invoke('--sync').status, 0);
  assert.equal(invoke().status, 0);
}));

test('duplicate paths and malformed metadata are rejected without rewriting', () => sandbox(({ invoke, read, write, registryPath }) => {
  assert.equal(invoke('--sync').status, 0);
  const original = read();
  write({ ...original, sources: [...original.sources, original.sources[0]] });
  assert.equal(invoke().status, 1);
  assert.match(invoke().output, /Invalid or duplicate source entry/);
  for (const evidence of [null, '', [''], [42]]) {
    const malformed = structuredClone(original);
    malformed.sources[0].evidence = evidence;
    write(malformed);
    const before = readFileSync(registryPath, 'utf8');
    const result = invoke('--sync');
    assert.equal(result.status, 1);
    assert.match(result.output, /Malformed inventory metadata/);
    assert.equal(readFileSync(registryPath, 'utf8'), before);
  }
}));

test('accepted metadata requires both a disposition and nonempty evidence', () => sandbox(({ invoke, read, write }) => {
  assert.equal(invoke('--sync').status, 0);
  const registry = read();
  for (const entry of registry.sources) entry.disposition = 'retain';
  write(registry);
  assert.equal(invoke('--require-accepted').status, 1);
  for (const entry of registry.sources) entry.evidence = ['fixture: metadata validation only; not application behavior proof'];
  write(registry);
  assert.equal(invoke('--require-accepted').status, 0);
}));

test('unknown options and sync-as-acceptance fail without modifying the registry', () => sandbox(({ invoke, registryPath }) => {
  assert.equal(invoke('--sync').status, 0);
  const before = readFileSync(registryPath, 'utf8');
  assert.equal(invoke('--sync', '--require-accepted').status, 1);
  assert.equal(invoke('--accept-everything').status, 1);
  assert.equal(readFileSync(registryPath, 'utf8'), before);
}));
