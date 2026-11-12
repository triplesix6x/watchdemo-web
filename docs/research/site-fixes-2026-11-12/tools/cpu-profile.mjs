import {createServer} from 'node:http'
import {createRequire} from 'node:module'
import fs from 'node:fs/promises'
import {staticHandler} from '/home/bigboss/PycharmProjects/watchdemo-web/frontend/scripts/refactor-web-qa-static.mjs'
import {guardContext} from '/home/bigboss/PycharmProjects/watchdemo-web/frontend/scripts/qa-safety.mjs'
const require=createRequire('/home/bigboss/PycharmProjects/watchdemo-web/frontend/package.json')
const {chromium}=require('playwright-core')
const server=createServer(staticHandler('/home/bigboss/.local/share/watchdemo-scroll-diag-attribution-mobile-01/baseline-normal/site'))
let browser
const ledger=[]
try {
 await new Promise(r=>server.listen(55450,'127.0.0.1',r))
 browser=await chromium.launch({headless:false,executablePath:'/home/bigboss/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',args:['--disable-background-networking','--disable-component-update','--no-first-run']})
 const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1,serviceWorkers:'block'})
 await guardContext(context,{origin:'http://127.0.0.1:55450',mode:'mock-browser'},url=>ledger.push(url))
 const page=await context.newPage(); await page.goto('http://127.0.0.1:55450');await page.locator('.home-background canvas').waitFor();await page.waitForTimeout(2000)
 const cdp=await context.newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.start')
 await page.waitForTimeout(2000)
 for(let i=0;i<24;i++){await page.mouse.wheel(0,i<12?300:-300);await page.waitForTimeout(85)}
 const {profile}=await cdp.send('Profiler.stop')
 await fs.writeFile('/home/bigboss/.cache/watchdemo-web/research-20261112/baseline-desktop.cpuprofile',JSON.stringify({profile,ledger}))
 if(ledger.length)throw Error('Unexpected network ledger')
 console.log('Profile saved (instrumented, not performance acceptance)')
} finally {await browser?.close();await new Promise(r=>server.close(r))}
