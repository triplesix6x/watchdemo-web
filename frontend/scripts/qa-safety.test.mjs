// Offline only. The SDK may load, but the runner test forbids browser launch.
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { qaTarget, requireRequestURL, guardedRequest, guardContext, freshOutputDirectory } from './qa-safety.mjs'
import { containedPath, decodeRequestPath } from './qa-static-path.mjs'

const mock = qaTarget('http://127.0.0.1:4400', 'mock-browser')
const real = qaTarget('http://127.0.0.1:55440', 'isolated-backend')
const rejected = [
  'http://127.example.com:55440', 'http://172.1.2.3:55440',
  'http://127.0.0.1:55441', 'http://user:pass@127.0.0.1:55440',
  'https://127.0.0.1:55440', 'http://127.0.0.1:55440/path',
  'http://127.0.0.1:55440/', 'http://127.0.0.1:55440?x=1',
  'http://127.0.0.1:55440#x', 'http://localhost:55440', undefined,
]

test('target rejection before any request construction or network', () => {
  let calls = 0
  for (const origin of rejected) {
    assert.throws(() => {
      const target = qaTarget(origin, 'isolated-backend')
      calls++
      guardedRequest({}, target)
    })
  }
  assert.throws(() => qaTarget(real.origin, 'pure'))
  assert.throws(() => qaTarget(mock.origin, 'isolated-backend'))
  assert.equal(calls, 0)
})

test('APIRequestContext rejection makes zero requests; redirects never followed', async () => {
  let calls = 0, disposed = 0
  const api = guardedRequest({ async get(_url, options) {
    calls++
    assert.equal(options.maxRedirects, 0)
    return { status: () => 302, dispose: async () => { disposed++ } }
  } }, real)
  for (const url of rejected.filter(Boolean).filter(url => !url.startsWith(real.origin))) {
    await assert.rejects(api.get(url))
  }
  assert.equal(calls, 0)
  await assert.rejects(api.get(real.origin + '/redirect', { maxRedirects: 20 }))
  assert.equal(calls, 1)
  assert.equal(disposed, 1)
  let mockCalls = 0
  const mockAPI = guardedRequest({ post: async () => { mockCalls++ } }, mock)
  for (const url of ['/api/v1/auth/register', '/%61pi/v1/auth/register']) {
    assert.throws(() => requireRequestURL(mock.origin + url, mock))
    await assert.rejects(mockAPI.post(mock.origin + url))
  }
  assert.equal(mockCalls, 0)
})

test('page route rejection is offline; allowed route cannot follow redirects', async () => {
  let handler, network = 0, aborted = 0, fulfilled = 0
  await guardContext({
    routeWebSocket: async () => {}, request: {},
    route: async (_pattern, callback) => { handler = callback },
  }, real)
  const route = url => ({
    request: () => ({ url: () => url }),
    fetch: async options => {
      network++
      assert.equal(options.maxRedirects, 0)
      return { status: () => 302, dispose: async () => {} }
    },
    abort: async () => { aborted++ }, fulfill: async () => { fulfilled++ },
  })
  await handler(route('http://127.example.com/api'))
  assert.equal(network, 0)
  await handler(route(real.origin + '/redirect'))
  assert.equal(network, 1)
  assert.equal(aborted, 2)
  assert.equal(fulfilled, 0)
  await guardContext({
    routeWebSocket: async () => {}, request: {},
    route: async (_pattern, callback) => { handler = callback },
  }, mock)
  await handler(route(mock.origin + '/api/v1/auth/register'))
  assert.equal(network, 1, 'mock API rejection must not add a network call')
})

test('static paths use true containment and malformed URIs fail', () => {
  const root = path.resolve('dist')
  for (const value of ['/../dist-backup/secret', '/%2e%2e%2fdist-backup/secret']) {
    assert.equal(containedPath(root, decodeRequestPath(value)), null)
  }
  for (const value of ['/%ZZ', '/%E0%A4%A', '/%00', '/%5c..%5csecret']) {
    assert.throws(() => decodeRequestPath(value), URIError)
  }
  assert.equal(containedPath(root, '/assets/app.js'), path.join(root, 'assets/app.js'))
})

test('legacy runners reject an existing output before writing or launching', async () => {
  const { chromium } = await import('playwright-core')
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'watchdemo-runner-output-gate-'))
  const names = ['QA_MODE', 'QA_OUTPUT_DIR', 'FOCUS_SITE_OUTPUT', 'FOCUS_SITE_URL', 'QA_ORIGIN']
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]))
  const mkdir = fs.mkdir
  const launch = chromium.launch
  try {
    Object.assign(process.env, { QA_MODE: 'mock-browser', QA_OUTPUT_DIR: directory,
      FOCUS_SITE_OUTPUT: directory, FOCUS_SITE_URL: mock.origin, QA_ORIGIN: mock.origin })
    chromium.launch = () => { throw Error('Browser launch reached before output rejection') }
    fs.mkdir = (target, ...options) => {
      if (path.resolve(target) !== directory) throw Error('Runner ignored the explicit output directory')
      return mkdir(target, ...options)
    }
    syncBuiltinESMExports()
    for (const runner of ['focus-site-qa.mjs', 'ghostfibers-home-qa.mjs']) {
      await assert.rejects(import(`./${runner}`), error => error.code === 'EEXIST')
    }
  } finally {
    chromium.launch = launch
    fs.mkdir = mkdir
    syncBuiltinESMExports()
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name]
      else process.env[name] = saved[name]
    }
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test('outputs require a new external directory, never historical paths or reuse', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'watchdemo-output-gate-'))
  try {
    const output = path.join(temp, 'new-run')
    assert.equal(await freshOutputDirectory(output), output)
    await assert.rejects(freshOutputDirectory(output))
    await assert.rejects(freshOutputDirectory(path.resolve('docs/qa/existing')))
    await assert.rejects(freshOutputDirectory('relative-output'))
    const dependencyRepo = path.join(temp, 'dependency-repo')
    await fs.mkdir(dependencyRepo)
    const dependencyOutput = path.join(dependencyRepo, '..qa')
    await assert.rejects(freshOutputDirectory(dependencyOutput, [dependencyRepo]))
    await assert.rejects(fs.access(dependencyOutput))
    assert.equal(await freshOutputDirectory(path.join(temp, 'sibling'), [dependencyRepo]), path.join(temp, 'sibling'))
  } finally {
    await fs.rm(temp, { recursive: true, force: true })
  }
})
