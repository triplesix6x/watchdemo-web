import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import net from 'node:net'
const output = process.env.FIREFOX_QA_OUTPUT
assert(output?.startsWith('/home/bigboss/.local/share/watchdemo-firefox-profile-'))
const variant = process.env.FIREFOX_QA_VARIANT ?? 'normal'
const surfaceMode = variant.startsWith('surface-') ? variant.slice('surface-'.length) : null
assert(['normal', 'radar-block-off', 'radar-mask-off', 'radar-layers', 'radar-webgl', 'help', 'surface-original', 'surface-flat'].includes(variant))
const info = JSON.parse(execFileSync('docker', ['inspect', 'watchdemo-local-frontend-1'], { encoding: 'utf8' }))[0]
assert.equal(info.Config.Labels['com.docker.compose.project'], 'watchdemo-local')
assert.equal(Object.keys(info.NetworkSettings.Networks).length, 1)
assert(Object.values(info.NetworkSettings.Ports ?? {}).every(v => v === null))
const ip = Object.values(info.NetworkSettings.Networks)[0].IPAddress
assert.match(ip, /^172\.\d+\.\d+\.\d+$/)
const origin = `https://${ip}:8443`
const paths = { 'radar-webgl': '/__home-diagnostic-20261113-webgl/radar-webgl/index.html', 'radar-layers': '/__home-diagnostic-20261113-layers-v2/radar-layers/index.html', help: '/help', normal: '/', 'radar-block-off': '/__home-diagnostic-20261112-block-off/radar-block-off/index.html', 'radar-mask-off': '/__home-diagnostic-20261112-mask-off/radar-mask-off/index.html' }
if (surfaceMode) paths[variant] = '/__home-diagnostic-20261113-surface/surface/index.html'
const url = origin + paths[variant] + (surfaceMode ? `?surface=${surfaceMode}` : '')
await mkdir(output)
const profile = `${output}/browser-profile`
await mkdir(profile)
await writeFile(`${profile}/user.js`, [
  ['browser.shell.checkDefaultBrowser', false], ['browser.startup.page', 0], ['browser.startup.homepage', 'about:blank'],
  ['browser.startup.homepage_override.mstone', 'ignore'], ['datareporting.policy.dataSubmissionEnabled', false],
  ['toolkit.telemetry.enabled', false], ['app.update.auto', false], ['dom.ipc.processCount', 1],
  ['browser.newtabpage.enabled', false], ['browser.newtabpage.activity-stream.feeds.telemetry', false],
].map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`).join('\n'))
const port = 19223
await new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(port, '127.0.0.1', () => s.close(resolve)) })
const firefox = spawn('/usr/bin/firefox', ['--no-remote', '--new-instance', '--profile', profile, '--remote-debugging-port', String(port), 'about:blank'], { env: { ...process.env,
  MOZ_PROFILER_STARTUP: '1', MOZ_PROFILER_STARTUP_ENTRIES: '1000000', MOZ_PROFILER_STARTUP_INTERVAL: '1',
  MOZ_PROFILER_STARTUP_FILTERS: 'GeckoMain,Compositor,Renderer,RenderBackend,SceneBuilder', MOZ_PROFILER_STARTUP_FEATURES: 'js,stackwalk', MOZ_PROFILER_SHUTDOWN: `${output}/profile.json`,
}, stdio: ['ignore', 'pipe', 'pipe'] })
let log = '', ws, seq = 0
const pending = new Map(), blocked = []
firefox.stdout.on('data', chunk => { log = (log + chunk).slice(-20000) })
firefox.stderr.on('data', chunk => { log = (log + chunk).slice(-20000) })
const command = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(Error(`BiDi timeout ${method}`)) }, 15000)
  pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }))
})
try {
  for (let i = 0; i < 100; i++) {
    if (log.includes('WebDriver BiDi listening')) break
    if (firefox.exitCode !== null) throw Error(`Firefox exited ${firefox.exitCode}: ${log}`)
    await delay(100)
  }
  const address = log.match(/WebDriver BiDi listening on (ws:\/\/[^\s]+)/)?.[1]
  assert(address, `No BiDi endpoint: ${log}`)
  assert(new URL(address).hostname === '127.0.0.1')
  ws = new WebSocket(address.endsWith('/session') ? address : address.replace(/\/$/, '') + '/session')
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id !== undefined) {
      const item = pending.get(message.id); if (!item) return
      clearTimeout(item.timer); pending.delete(message.id)
      if (message.type === 'error') item.reject(Error(JSON.stringify(message))); else item.resolve(message.result)
    } else if (message.method === 'network.beforeRequestSent' && message.params.isBlocked) {
      const { request } = message.params
      if (request.url.startsWith(origin + '/') || request.url.startsWith('data:') || request.url === 'about:blank') command('network.continueRequest', { request: request.request }).catch(() => {})
      else { blocked.push(request.url); command('network.failRequest', { request: request.request }).catch(() => {}) }
    }
  })
  const session = await command('session.new', { capabilities: { alwaysMatch: { acceptInsecureCerts: true } } })
  await command('session.subscribe', { events: ['network.beforeRequestSent'] })
  await command('network.addIntercept', { phases: ['beforeRequestSent'] })
  const tree = await command('browsingContext.getTree', {})
  const context = tree.contexts[0].context
  await command('browsingContext.setViewport', { context, viewport: { width: 1920, height: 1080 }, devicePixelRatio: 1 })
  await command('browsingContext.navigate', { context, url, wait: 'complete' })
  await delay(3500)
  const evaluate = expression => command('script.evaluate', { expression, target: { context }, awaitPromise: true, resultOwnership: 'none' })
  let reloadProof = null
  if (surfaceMode) {
    const inspect = async () => {
      const response = await evaluate(`JSON.stringify({path:location.pathname,search:location.search,skin:document.documentElement.dataset.localSurface,module:document.querySelector('script[type="module"][src]')?.getAttribute('src'),badge:document.querySelector('[data-diagnostic-badge]')?.textContent,blur:getComputedStyle(document.querySelector('.story-stage')).backdropFilter,mask:getComputedStyle(document.querySelector('.home-background')).maskImage})`)
      const value = JSON.parse(response.result.value)
      assert.equal(value.path, paths[variant])
      assert.equal(value.search, `?surface=${surfaceMode}`)
      assert.equal(value.skin, surfaceMode)
      assert.equal(value.module, '/__home-diagnostic-20261113-surface/surface/assets/index-BPmdQLJC.js')
      assert(value.badge.includes(`skin=${surfaceMode}`))
      assert.equal(value.blur === 'none', surfaceMode === 'flat')
      assert.equal(value.mask === 'none', surfaceMode === 'flat')
      return value
    }
    const before = await inspect()
    await command('browsingContext.reload', { context, wait: 'complete' })
    await delay(3500)
    reloadProof = { before, after: await inspect() }
  }
  if (variant === 'radar-layers' || variant === 'radar-webgl') {
    const inspect = async () => {
      const response = await evaluate(`JSON.stringify({path:location.pathname,layers:document.querySelectorAll('.story-stage canvas.radar-layer').length,badge:!!document.querySelector('[data-diagnostic-badge="${variant}"]'),backend:document.querySelector('.story-stage canvas.radar-canvas')?.dataset.localRadarBackend,module:document.querySelector('script[type="module"][src]')?.getAttribute('src')})`)
      const value = JSON.parse(response.result.value)
      assert.equal(value.path, paths[variant])
      assert.equal(value.layers, variant === 'radar-layers' ? 37 : 0)
      if (variant === 'radar-webgl') assert.equal(value.backend, 'webgl2')
      assert.equal(value.badge, true)
      assert(value.module.startsWith(paths[variant].slice(0, paths[variant].indexOf(`/${variant}/`)) + '/'))
      return value
    }
    const before = await inspect()
    await command('browsingContext.reload', { context, wait: 'complete' })
    await delay(3500)
    reloadProof = { before, after: await inspect() }
  }
  const geometry = await evaluate(`JSON.stringify({width:innerWidth,height:innerHeight,radar:!!document.querySelector('.story-stage'),userAgent:navigator.userAgent,renderer:(()=>{let c=document.createElement('canvas'),g=c.getContext('webgl');if(!g)return null;let d=g.getExtension('WEBGL_debug_renderer_info');return d?g.getParameter(d.UNMASKED_RENDERER_WEBGL):'unavailable'})()})`)
  await evaluate(`performance.mark('qa-idle-start')`)
  await delay(2000)
  await evaluate(`performance.mark('qa-scroll-start')`)
  for (let i = 0; i < 35; i++) {
    await command('input.performActions', { context, actions: [{ type: 'wheel', id: 'wheel', actions: [{ type: 'scroll', x: 400, y: 500, deltaX: 0, deltaY: 130, duration: 80 }] }] })
  }
  await evaluate(`performance.mark('qa-scroll-end');JSON.stringify({y:scrollY,height:document.documentElement.scrollHeight})`)
  await delay(1000)
  for (let i = 0; i < 35; i++) await command('input.performActions', { context, actions: [{ type: 'wheel', id: 'wheel', actions: [{ type: 'scroll', x: 400, y: 500, deltaX: 0, deltaY: -130, duration: 80 }] }] })
  await evaluate(`performance.mark('qa-up-end')`)
  await writeFile(`${output}/scenario.json`, JSON.stringify({ acceptingPerformance: false, variant, url, session, geometry, reloadProof, blocked }, null, 2))
  await command('browser.close')
  await Promise.race([new Promise(resolve => firefox.once('exit', resolve)), delay(15000)])
  assert(firefox.exitCode !== null, 'Firefox did not close cleanly')
  const size = (await stat(`${output}/profile.json`)).size
  assert(size > 1000)
  console.log(JSON.stringify({ variant, output, profileBytes: size, blocked }))
} finally {
  ws?.close()
  if (firefox.exitCode === null) { firefox.kill('SIGTERM'); await Promise.race([new Promise(resolve => firefox.once('exit', resolve)), delay(5000)]); if (firefox.exitCode === null) firefox.kill('SIGKILL') }
  await writeFile(`${output}/firefox.log`, log)
}
