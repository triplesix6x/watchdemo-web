// Real local app: count WebGL work without readback or GPU timing claims.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const output = process.env.QA_OUTPUT_DIR;
assert(output?.startsWith('/home/bigboss/.local/share/watchdemo-ghost-runtime-'));
await mkdir(output);
const container = JSON.parse(execFileSync('docker', ['inspect', 'watchdemo-local-frontend-1'], { encoding: 'utf8' }))[0];
assert.equal(container.Config.Labels['com.docker.compose.project'], 'watchdemo-local');
assert.equal(Object.keys(container.NetworkSettings.Networks).length, 1);
assert(container.HostConfig.Memory > 0 && container.HostConfig.NanoCpus > 0);
assert(Object.values(container.NetworkSettings.Ports ?? {}).every(value => value === null));
const ip = Object.values(container.NetworkSettings.Networks)[0].IPAddress;
assert.match(ip, /^172\.\d+\.\d+\.\d+$/);
const origin = `https://${ip}:8443`;
const browser = await chromium.launch({ headless: false,
  executablePath: '/home/bigboss/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [], rejected = [];
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(origin + '/')) return route.continue();
    rejected.push(new URL(url).origin);
    return route.abort();
  });
  await context.addInitScript(({ gpuTimers }) => {
    const stats = [];
    const contexts = new WeakMap();
    let phase = 'startup';
    window.__ghostStats = stats;
    window.__ghostPhase = name => { phase = name; };
    const prototype = WebGL2RenderingContext.prototype;
    function entry(gl) {
      if (!contexts.has(gl)) {
        const extension = gpuTimers ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
        const item = { canvas: gl.canvas, framebuffer: null, phases: {},
          timer: { extension, active: null, pending: [], started: {}, samples: {}, disjoint: 0 } };
        item.poll = () => {
          if (!extension) return;
          const timer = item.timer;
          if (gl.getParameter(extension.GPU_DISJOINT_EXT)) {
            timer.disjoint++;
            for (const entry of timer.pending) gl.deleteQuery(entry.query);
            timer.pending = [];
            return;
          }
          timer.pending = timer.pending.filter(entry => {
            if (!gl.getQueryParameter(entry.query, gl.QUERY_RESULT_AVAILABLE)) return true;
            (timer.samples[entry.phase] ??= []).push(gl.getQueryParameter(entry.query, gl.QUERY_RESULT) / 1e6);
            gl.deleteQuery(entry.query);
            return false;
          });
        };
        contexts.set(gl, item);
        stats.push(item);
      }
      const item = contexts.get(gl);
      item.phases[phase] ??= { frames: 0, instancedDraws: 0, passes: 0, allocations: [], compiles: 0, size: [] };
      return [item, item.phases[phase]];
    }
    for (const name of ['bindFramebuffer', 'drawArrays', 'drawArraysInstanced', 'texStorage2D', 'compileShader']) {
      const original = prototype[name];
      prototype[name] = function (...args) {
        const [item, counts] = entry(this);
        if (name === 'bindFramebuffer') item.framebuffer = args[1];
        if (name === 'drawArraysInstanced') {
          counts.instancedDraws++;
          const timer = item.timer;
          item.poll();
          if (timer.extension && !timer.active && (timer.started[phase] ?? 0) < 90 && timer.pending.length < 8) {
            const query = this.createQuery();
            if (query) {
              this.beginQuery(timer.extension.TIME_ELAPSED_EXT, query);
              timer.active = { query, phase };
              timer.started[phase] = (timer.started[phase] ?? 0) + 1;
            }
          }
        }
        if (name === 'drawArrays') {
          counts.passes++;
          if (item.framebuffer === null) {
            counts.frames++;
            counts.size = [this.canvas.width, this.canvas.height];
          }
        }
        if (name === 'texStorage2D') counts.allocations.push([args[3], args[4]]);
        if (name === 'compileShader') counts.compiles++;
        const result = original.apply(this, args);
        if (name === 'drawArrays' && item.framebuffer === null && item.timer.active) {
          this.endQuery(item.timer.extension.TIME_ELAPSED_EXT);
          item.timer.pending.push(item.timer.active);
          item.timer.active = null;
        }
        return result;
      };
    }
  }, { gpuTimers: process.env.QA_GPU_TIMERS === '1' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/', { waitUntil: 'networkidle' });
  await page.locator('.ghost-fibers-canvas').waitFor();
  await page.waitForTimeout(1500);
  const measurements = [];
  async function sample(name, action) {
    const start = await page.evaluate(name => { window.__ghostPhase(name); return performance.now(); }, name);
    await action();
    const end = await page.evaluate(() => performance.now());
    measurements.push({ name, elapsedMs: end - start });
  }
  await sample('idle', () => page.waitForTimeout(3000));
  await sample('scroll', async () => {
    for (let index = 0; index < 8; index++) { await page.mouse.wheel(0, 90); await page.waitForTimeout(100); }
    for (let index = 0; index < 8; index++) { await page.mouse.wheel(0, -90); await page.waitForTimeout(100); }
    await page.waitForTimeout(500);
  });
  // Use real input: Lenis owns scroll position and can undo bare scrollTo calls.
  await sample('exit', async () => {
    for (let index = 0; index < 8; index++) {
      if (await page.evaluate(() => document.querySelector('.home-background').getBoundingClientRect().bottom < 0)) break;
      await page.mouse.wheel(0, 700);
      await page.waitForTimeout(300);
    }
    await page.waitForFunction(() => document.querySelector('.home-background').getBoundingClientRect().bottom < 0);
    // The component stays mounted; its own observer pauses the shared-frame loop.
    await page.waitForTimeout(300);
  });
  const offscreenGeometry = await page.evaluate(() => ({ scrollY,
    bottom: document.querySelector('.home-background').getBoundingClientRect().bottom }));
  await sample('offscreen', () => page.waitForTimeout(1000));
  await sample('reentry', async () => {
    for (let index = 0; index < 12; index++) {
      if (await page.evaluate(() => scrollY < 2)) break;
      await page.mouse.wheel(0, -700);
      await page.waitForTimeout(300);
    }
    await page.waitForFunction(() => scrollY < 2 && document.querySelector('.ghost-fibers-canvas'));
    await page.waitForTimeout(1500);
  });
  await sample('idleAfterReentry', () => page.waitForTimeout(3000));
  const captures = await page.evaluate(() => window.__ghostStats.map(item => {
    item.poll();
    return { className: item.canvas.className, connected: item.canvas.isConnected, phases: item.phases,
      gpu: { available: !!item.timer.extension, disjoint: item.timer.disjoint,
        pending: item.timer.pending.length, samplesMs: item.timer.samples } };
  }));
  const ghost = captures.filter(item => item.className === 'ghost-fibers-canvas');
  await writeFile(`${output}/observed.json`, JSON.stringify({ measurements, offscreenGeometry, ghost, errors, rejected }, null, 2));
  console.log(JSON.stringify({ contexts: ghost.map(item => ({ connected: item.connected, phases: item.phases })) }));
  assert.equal(ghost.filter(item => item.connected).length, 1);
  assert.equal(ghost.length, 1, 'Background recreated its WebGL context after an offscreen exit');
  assert.equal(ghost[0].phases.reentry?.compiles ?? 0, 0, 'Recompiled shaders on reentry');
  assert.equal(ghost[0].phases.reentry?.allocations.length ?? 0, 0, 'Reallocated textures on reentry');
  assert(ghost.every(item => (item.phases.offscreen?.frames ?? 0) === 0), 'Hidden background kept drawing');
  for (const name of ['idle', 'scroll', 'idleAfterReentry']) {
    const counts = ghost.flatMap(item => item.phases[name] ? [item.phases[name]] : []);
    assert.equal(counts.length, 1, `Multiple renderers in ${name}`);
    assert.equal(counts[0].compiles, 0, `Recompiled shaders in ${name}`);
    assert.equal(counts[0].allocations.length, 0, `Reallocated texture storage in ${name}`);
    assert.equal(counts[0].instancedDraws, counts[0].frames * 4);
    assert.equal(counts[0].passes, counts[0].frames * 10);
    const seconds = measurements.find(item => item.name === name).elapsedMs / 1000;
    assert(counts[0].frames / seconds <= 65, `Unexpected duplicate render cadence in ${name}`);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(rejected, []);
  const gpu = ghost.map(item => ({ available: item.gpu.available, disjoint: item.gpu.disjoint,
    pending: item.gpu.pending, phases: Object.fromEntries(Object.entries(item.gpu.samplesMs).map(([name, samples]) => {
      const sorted = [...samples].sort((a, b) => a - b);
      return [name, { count: sorted.length, p50Ms: sorted[Math.floor((sorted.length - 1) * .5)],
        p95Ms: sorted[Math.floor((sorted.length - 1) * .95)], maxMs: sorted.at(-1) }];
    })) }));
  const result = { origin, viewport: '1920x1080 DPR1', measurements, offscreenGeometry,
    ghost: ghost.map(({ gpu, ...item }) => item), gpu, errors, rejected,
    limit: process.env.QA_GPU_TIMERS === '1'
      ? 'Async GPU query covers first instanced draw through final composite only; excludes initial clear, browser composition and presented frames. Single instrumented run, not a speedup or smoothness claim.'
      : 'Instrumented workload/correctness census, not GPU timing or proof of smoothness.' };
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
