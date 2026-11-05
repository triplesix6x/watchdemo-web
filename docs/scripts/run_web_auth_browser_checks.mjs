// Real AuthProvider/client and browser cookie processing; fake loopback HTTP only.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const frontend = path.join(root, 'frontend');
const require = createRequire(path.join(frontend, 'package.json'));
const vitePackage = require.resolve('vite/package.json');
const viteMetadata = JSON.parse(await fs.readFile(vitePackage, 'utf8'));
const { createServer } = await import(pathToFileURL(path.resolve(path.dirname(vitePackage), viteMetadata.exports['.'].import.default)));
const { chromium } = require('playwright-core');
const fixture = path.join(root, 'docs/browser-subscription/auth.jsx').replaceAll('\\', '/');
const origin = 'http://127.0.0.1:55440';
let browser;
const server = await createServer({
  configFile: false, envFile: false, root: frontend, clearScreen: false,
  define: { __MOCK__: 'false' }, esbuild: { jsx: 'automatic' },
  resolve: { dedupe: ['react', 'react-dom'] },
  optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
  plugins: [{ name: 'auth-qa-fixture', configureServer(instance) {
    instance.middlewares.use('/__authqa__', async (_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end(await instance.transformIndexHtml('/__authqa__', `<html lang="en"><head></head><body><div id="app"></div><script type="module" src="/@fs/${fixture}"></script></body></html>`));
    });
  } }],
  server: { host: '127.0.0.1', port: 55440, strictPort: true, hmr: false, watch: null,
    fs: { allow: [path.join(root, 'docs/browser-subscription'), frontend] } },
});
const user = (username) => ({ id: username.startsWith('A') ? '00000000-0000-0000-0000-000000000001' : '00000000-0000-0000-0000-000000000002', username,
  email: `${username}@example.invalid`, role: 'support', is_verified: true, subscription: null });
const token = (username) => `qa.${Buffer.from(JSON.stringify({ type: 'access', sub: user(username).id,
  sid: username === 'A' ? '00000000-0000-0000-0000-000000000011' : username === 'B' ? '00000000-0000-0000-0000-000000000012' : '00000000-0000-0000-0000-000000000013',
  qa_user: username, exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url')}.qa`;
let rejectMeFor = null;
let logoutCalls = 0;
let holdLogout = true;
let heldLogout;
let resolveLogout;
const logoutReached = new Promise(resolve => { resolveLogout = resolve; });
let holdMe = false;
let heldMe;
let resolveMe;
const meReached = new Promise(resolve => { resolveMe = resolve; });
const loginRequests = [];
const external = [];
const errors = [];
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true,
    chromiumSandbox: true, args: ['--disable-background-networking', '--disable-component-update', '--no-first-run'] });
  const context = await browser.newContext({ locale: 'en-US' });
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) { external.push(url.origin); return route.abort(); }
    const json = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    if (url.pathname === '/api/v1/auth/refresh') {
      const cookie = (await request.allHeaders()).cookie ?? '';
      const login = /(?:^|;\s*)qa_rt=([A-Za-z0-9-]+)/.exec(cookie)?.[1];
      return login ? json({ access_token: token(login) }) : route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
    }
    if (url.pathname === '/api/v1/auth/login') {
      const { login } = request.postDataJSON();
      loginRequests.push(login);
      return route.fulfill({ status: 200, contentType: 'application/json',
        headers: { 'Set-Cookie': `qa_rt=${login}; HttpOnly; SameSite=Strict; Path=/` },
        body: JSON.stringify({ access_token: token(login), user: user(login) }) });
    }
    if (url.pathname === '/api/v1/auth/logout') {
      logoutCalls += 1;
      if (holdLogout) { heldLogout = route; resolveLogout(); return; }
      return route.fulfill({ status: 204, headers: { 'Set-Cookie': 'qa_rt=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/' } });
    }
    if (url.pathname === '/api/v1/users/me') {
      if (holdMe) { heldMe = route; resolveMe(); return; }
      const authorization = request.headers().authorization ?? '';
      const claims = JSON.parse(Buffer.from(authorization.split('.')[1], 'base64url').toString());
      if (claims.qa_user === rejectMeFor) return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
      return json(user(claims.qa_user));
    }
    if (url.pathname.startsWith('/api/')) throw new Error(`Unexpected QA API request ${request.method()} ${url.pathname}`);
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/__authqa__`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('#identity').textContent === 'anonymous');
  await page.evaluate(() => window.qaAuth.login('A', 'test-only'));
  await page.waitForFunction(() => document.querySelector('#identity').textContent === 'A');
  await page.evaluate(() => { window.logoutFinished = window.qaAuth.logout(); });
  await page.waitForFunction(() => document.querySelector('#identity').textContent === 'anonymous');
  await logoutReached;
  assert.ok(heldLogout, 'old logout reached the real browser HTTP boundary');
  await page.evaluate(() => { window.loginFinished = window.qaAuth.login('B', 'test-only'); });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual(loginRequests, ['A'], 'replacement login must not pass the unsettled logout cookie response');
  holdLogout = false;
  await heldLogout.fulfill({ status: 204, headers: { 'Set-Cookie': 'qa_rt=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/' } });
  await page.evaluate(() => Promise.all([window.logoutFinished, window.loginFinished]));
  await page.waitForFunction(() => document.querySelector('#identity').textContent === 'B');
  assert.equal((await context.cookies()).find(cookie => cookie.name === 'qa_rt')?.value, 'B');
  console.log('PASS mounted AuthProvider: old logout cookie settles before replacement login, final identity/cookie agree');

  holdMe = true;
  await page.evaluate(() => { window.oldMeFinished = window.qaAuth.refreshUser(); });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await meReached;
  assert.ok(heldMe, 'profile refresh reached browser HTTP boundary');
  await page.evaluate(() => window.qaAuth.logout());
  await page.evaluate(() => window.qaAuth.login('B2', 'test-only'));
  await page.waitForFunction(() => document.querySelector('#identity').textContent === 'B2');
  await heldMe.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user('B-STALE')) });
  await page.evaluate(() => window.oldMeFinished);
  assert.equal(await page.locator('#identity').textContent(), 'B2');
  assert.equal((await context.cookies()).find(cookie => cookie.name === 'qa_rt')?.value, 'B2');
  console.log('PASS mounted AuthProvider: delayed /me cannot overwrite same-account reactivation');

  await page.close();
  await context.clearCookies();
  holdMe = false;
  const tabA = await context.newPage();
  const tabB = await context.newPage();
  for (const tab of [tabA, tabB]) tab.on('pageerror', error => errors.push(error.message));
  await tabA.goto(`${origin}/__authqa__`, { waitUntil: 'networkidle' });
  await tabA.waitForFunction(() => document.querySelector('#identity').textContent === 'anonymous');
  await tabA.evaluate(() => window.qaAuth.login('A', 'test-only'));
  await tabA.waitForFunction(() => document.querySelector('#identity').textContent === 'A');
  await tabB.goto(`${origin}/__authqa__`, { waitUntil: 'networkidle' });
  await tabB.waitForFunction(() => document.querySelector('#identity').textContent === 'A');
  await tabB.evaluate(() => window.qaAuth.login('B', 'test-only'));
  await tabB.waitForFunction(() => document.querySelector('#identity').textContent === 'B');
  assert.equal(await tabA.locator('#identity').textContent(), 'A');
  rejectMeFor = 'A';
  const beforeRejectedRefresh = logoutCalls;
  const retired = await tabA.evaluate(async () => {
    try { await window.qaAuth.refreshUser(); return { status: null }; }
    catch (error) { return { status: error.status }; }
  });
  assert.equal(retired.status, 401, 'replacement refresh rejects the original action');
  await tabA.waitForFunction(() => document.querySelector('#identity').textContent === 'anonymous');
  assert.equal(await tabB.locator('#identity').textContent(), 'B');
  assert.equal((await context.cookies()).find(cookie => cookie.name === 'qa_rt')?.value, 'B');
  assert.equal(logoutCalls, beforeRejectedRefresh, 'rejecting a replacement refresh must not logout the other tab');
  console.log('PASS two mounted AuthProviders: shared-cookie refresh cannot switch A to B or clear B cookie');
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  const artifacts = path.join(root, 'docs/qa/subscription-browser');
  await fs.mkdir(artifacts, { recursive: true });
  await fs.writeFile(path.join(artifacts, 'web-auth-result.json'), JSON.stringify({
    passed: ['logout-login-cookie-order', 'same-account-profile-retirement', 'cross-tab-refresh-identity-binding'], pageErrors: errors, externalRequests: external,
    scope: 'Actual React AuthProvider/client and shared browser cookies across two tabs, fake loopback API. Not live auth, staff reset DOM, or global cross-tab request serialization.',
  }, null, 2) + '\n');
} finally {
  if (browser) await browser.close();
  await server.close();
}
