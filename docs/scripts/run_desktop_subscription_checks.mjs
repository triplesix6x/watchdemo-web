// Run actual dependency-free desktop subscription behavior tests, not the app.
// Invoke through run_limited_check_windows.py. Uses existing desktop TypeScript.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import net from 'node:net';

const root = resolve(process.argv[2] ?? 'D:/demo-manager');
const require = createRequire(import.meta.url);
const ts = require(join(root, 'node_modules/typescript'));
const temp = mkdtempSync(join(tmpdir(), 'watchdemo-subscription-tests-'));
try {
  writeFileSync(join(temp, 'package.json'), '{"type":"commonjs"}');
  for (const name of ['subscription', 'importController', 'subscription.test', 'featureOwnership', 'featureOwnership.test', 'noteEditor', 'noteEditor.test']) {
    const source = readFileSync(join(root, 'src/lib', `${name}.ts`), 'utf8');
    const result = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      reportDiagnostics: true,
      fileName: `${name}.ts`,
    });
    const errors = result.diagnostics?.filter((d) => d.category === ts.DiagnosticCategory.Error) ?? [];
    if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
      getCanonicalFileName: (f) => f, getCurrentDirectory: () => root, getNewLine: () => '\n',
    }));
    writeFileSync(join(temp, `${name}.js`), result.outputText);
  }
  // No app/Tauri imports, server or test network. Fail rather than send anything.
  net.Socket.prototype.connect = function () { throw new Error('Network forbidden in subscription behavior checks'); };
  globalThis.fetch = async function () { throw new Error('Network forbidden in subscription behavior checks'); };
  if (typeof globalThis.crypto?.randomUUID !== 'function') throw new Error('Node crypto.randomUUID is required');
  const load = createRequire(join(temp, 'entry.cjs'));
  let total = 0;
  for (const [file, entry] of [
    ['subscription.test', 'runSubscriptionBehaviorTests'],
    ['featureOwnership.test', 'runFeatureOwnershipBehaviorTests'],
    ['noteEditor.test', 'runNoteEditorBehaviorTests'],
  ]) {
    const suite = load(`./${file}.js`);
    if (typeof suite[entry] !== 'function') throw new Error(`Behavior suite export missing: ${entry}`);
    const passed = await suite[entry]();
    if (!Array.isArray(passed) || passed.length === 0) throw new Error(`No behavior cases executed: ${entry}`);
    for (const name of passed) console.log(`PASS ${name}`);
    total += passed.length;
  }
  console.log(`${total} desktop subscription behavior groups passed (not browser/Tauri proof).`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
