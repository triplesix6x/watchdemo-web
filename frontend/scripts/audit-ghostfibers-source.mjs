// Compare the operator-provided React Bits source, not a moving package release.
// Usage: node frontend/scripts/audit-ghostfibers-source.mjs reference.txt output.json
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const [referencePath, outputPath] = process.argv.slice(2);
assert(referencePath && outputPath, 'Expected reference source and output JSON paths');
const raw = await readFile(referencePath, 'utf8');
const reference = raw.slice(0, raw.indexOf('export default GhostFibers;') + 'export default GhostFibers;'.length);
assert(reference.startsWith("'use client';") && reference.endsWith('export default GhostFibers;'));
const local = await readFile('frontend/src/features/backgrounds/GhostFibers/GhostFibers.tsx', 'utf8');
const projection = await readFile('frontend/src/features/backgrounds/GhostFibers/projection.ts', 'utf8');
function declarations(source) {
  const javascript = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve,
    removeComments: true,
  }}).outputText;
  const tree = ts.createSourceFile('source.jsx', javascript, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  const result = new Map();
  const printer = ts.createPrinter({ removeComments: true });
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const name = node.name.text;
      // These selected declarations are unique across the component and module.
      if (!result.has(name)) result.set(name, printer.printNode(ts.EmitHint.Expression, node.initializer, tree)
        .replace(/\(([A-Za-z_$][\w$]*)\) =>/g, '$1 =>'));
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return result;
}
const original = declarations(reference);
const current = declarations(local);
const math = declarations(projection);
const equalNames = [
  'MAX_RENDER_DIM', 'BLOOM_LEVELS', 'INTRO_SECONDS', 'CAMERA', 'FOV', 'RIBBON_LENGTH',
  'HOVER_EFFECTS', 'FIBER_STYLES', 'GRADIENTS', 'RIBBON_TINT', 'PLACEMENTS', 'RIBBON_GAIN', 'DEG', 'FOCAL',
  'HEADER', 'SHAPE', 'DOT_VERTEX', 'DUST_VERTEX', 'DOT_FRAGMENT', 'FULLSCREEN',
  'BRIGHT_FRAGMENT', 'DOWN_FRAGMENT', 'UP_FRAGMENT', 'COMPOSITE_FRAGMENT',
  'SHAPE_UNIFORMS', 'DOT_UNIFORMS', 'DUST_UNIFORMS', 'PASS_UNIFORMS', 'COMPOSITE_UNIFORMS',
  'clamp', 'compile', 'link', 'settings', 'allocate', 'makeTarget', 'toRgb', 'resolveColors',
  'centerLocal', 'cameraFor', 'screenOf', 'nearestOnRibbon', 'resize', 'drawPass', 'render',
  'onPointerMove', 'onPointerDown', 'onPointerLeave', 'onVisibility',
];
for (const name of equalNames) {
  assert(original.has(name) && current.has(name), `Missing declaration ${name}`);
  assert.equal(current.get(name), original.get(name), `Changed renderer declaration: ${name}`);
}
for (const name of ['frustum', 'multiply', 'orientation', 'applyMat3']) {
  assert.equal(math.get(name), original.get(name), `Changed extracted projection math: ${name}`);
}
// The only runtime changes inside the component are scheduler routing and cadence.
const stripScheduler = source => source
  .replace('const cadence = createAmbientCadence();', '')
  .replace(/if \(!cadence\.accept\(now\)\) \{\s*raf = requestSharedFrame\(frame\);\s*return;\s*\}/, '')
  .replace('cadence.reset();', '')
  .replaceAll('requestSharedFrame', 'requestAnimationFrame')
  .replaceAll('cancelSharedFrame', 'cancelAnimationFrame')
  .replace(/\s/g, '')
  .replace('if(!raf&&alive&&visible&&!document.hidden){raf=requestAnimationFrame(frame);}',
    'if(!raf&&alive&&visible&&!document.hidden)raf=requestAnimationFrame(frame);');
assert.equal(stripScheduler(current.get('GhostFibers')), stripScheduler(original.get('GhostFibers')),
  'Unexpected component behavior change beyond scheduler/cadence');
const css = raw.slice(raw.indexOf('/* ---- GhostFibers.css ---- */') + '/* ---- GhostFibers.css ---- */'.length);
const localCss = await readFile('frontend/src/features/backgrounds/GhostFibers/GhostFibers.css', 'utf8');
assert(css.replace(/\s/g, '').startsWith(localCss.replace(/\s/g, '')), 'Component CSS differs');
const report = {
  referenceSha256: createHash('sha256').update(reference).digest('hex'),
  localSha256: createHash('sha256').update(local).digest('hex'),
  identicalRendererDeclarations: equalNames, identicalProjectionDeclarations: [...math.keys()],
  componentCssIdentical: true, onlyRuntimeDifferences: ['shared GSAP scheduler', '60 Hz ambient cadence'],
  limit: 'Source equivalence, not runtime or GPU performance acceptance; wrapper and page CSS are separate.',
};
await writeFile(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
