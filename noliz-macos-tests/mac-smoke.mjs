import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packaged = Boolean(process.argv[2]);
const exe = packaged ? path.resolve(process.argv[2]) : path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const bundle = path.resolve(exe, '../../..');
const qa = path.join(root, 'qa'); fs.mkdirSync(qa, {recursive:true});
const log = message => { console.log(message); fs.appendFileSync(path.join(qa, 'mac-smoke-progress.txt'), message + '\n'); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const socket = net.createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
const env = {...process.env, NOLIZ_TEST_DATA_DIR:path.join(qa, packaged ? 'mac-packaged-profile' : 'mac-dev-profile')};
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(exe, [...(packaged ? [] : [root]), '--noliz-smoke-test', '--remote-debugging-port='+port, '--remote-debugging-address=127.0.0.1'], {cwd:root, env, stdio:['ignore','ignore','pipe']});
child.stderr.on('data', bytes => fs.appendFileSync(path.join(qa, 'mac-electron.log'), bytes));
let exited = false, browser;
const exit = new Promise(resolve => child.once('exit', () => {exited=true; resolve();}));
child.once('error', error => log('Launch error: '+error.message));
const watchdog = setTimeout(() => {log('Smoke test exceeded 120 seconds'); child.kill('SIGKILL'); process.exit(1);}, 120000);
try {
 log('Launching isolated macOS application.');
 const deadline = Date.now()+60000;
 while (true) {
  if (exited) throw Error('Application exited before its debugging endpoint was ready');
  try { if ((await fetch('http://127.0.0.1:'+port+'/json/version', {signal:AbortSignal.timeout(1000)})).ok) break; } catch {}
  if (Date.now()>deadline) throw Error('Application startup timed out');
  await delay(250);
 }
 browser = await chromium.connectOverCDP('http://127.0.0.1:'+port, {timeout:15000});
 const context = browser.contexts()[0]; context.setDefaultTimeout(20000);
 const page = context.pages()[0] || await context.waitForEvent('page');
 const errors=[]; page.on('pageerror', error => errors.push(error.message));
 await page.locator('.hero-title').waitFor(); await page.locator('#locale').selectOption('zh');
 await page.locator('#home-listings .site-card').first().waitFor({timeout:25000});
 const home = await page.evaluate(() => ({url:location.href, background:getComputedStyle(document.body).backgroundColor, artwork:document.querySelectorAll('.scene-card').length, nodeAvailable:typeof window.require!=='undefined'||typeof window.process!=='undefined', listings:document.querySelectorAll('#home-listings .site-card').length}));
 if (home.url!=='noliz://app/' || home.nodeAvailable || home.artwork!==2) throw Error('Home or renderer isolation failed: '+JSON.stringify(home));
 log('Home, live directory and renderer isolation passed.');
 if (packaged) await page.screenshot({path:path.join(qa,'packaged-home.png'), timeout:10000}).catch(error => log('Optional screenshot: '+error.message));
 await page.locator('.hero .actions a[href="/search/"]').click(); await page.waitForURL('noliz://app/search/');
 await page.locator('#query').fill('Google'); await page.locator('#query').press('Enter');
 await page.waitForFunction(() => document.querySelector('#directory-results')?.innerText.includes('Google'), null, {timeout:20000});
 await page.locator('#locale').selectOption('en');
 if (await page.locator('html').getAttribute('data-appearance') !== 'dark') await page.locator('[data-action="toggle-appearance"]').click();
 log('Live search and appearance controls passed. Closing the window.');
 await page.close();
 if (exited) throw Error('macOS application quit when its last window closed');
 const nextWindow = context.waitForEvent('page', {timeout:20000});
 execFileSync('/usr/bin/open', ['-a',bundle]);
 const reopened = await nextWindow; await reopened.locator('.hero-title').waitFor();
 await reopened.waitForFunction(() => document.documentElement.lang==='en' && document.documentElement.dataset.appearance==='dark', null, {timeout:15000}).catch(async error => {
  log('Reopened preferences: '+JSON.stringify(await reopened.evaluate(() => ({language:document.documentElement.lang, appearance:document.documentElement.dataset.appearance, storedLanguage:localStorage.getItem('nolix.locale'), storedAppearance:localStorage.getItem('noliz.appearance')}))));
  throw error;
 });
 const persisted = await reopened.evaluate(() => ({language:document.documentElement.lang, appearance:document.documentElement.dataset.appearance}));
 if (persisted.language!=='en'||persisted.appearance!=='dark') throw Error('Preferences were lost when reopening the window: '+JSON.stringify(persisted));
 log('Native application activation and preferences passed.');
 await reopened.locator('#locale').selectOption('zh'); await reopened.locator('[data-action="toggle-appearance"]').click();
 await reopened.locator('a[href="/login/"]').first().click(); await reopened.waitForURL('noliz://app/login/');
 if (!await reopened.locator('#auth-form').isVisible() || errors.length) throw Error('Login form or renderer errors: '+JSON.stringify(errors));
 const result = {executable:packaged?'packaged':'development', home, search:'passed', macOSCloseAndActivation:'passed', persistence:persisted, loginScreen:'passed', rendererExceptions:errors, privateActions:'none'};
 fs.writeFileSync(path.join(qa,packaged?'packaged-results.json':'dev-results.json'),JSON.stringify(result,null,2)+'\n');
 log(JSON.stringify(result));
} catch(error) { log(error.stack || error.message); throw error; }
finally {
 child.kill('SIGTERM'); await Promise.race([exit,delay(3000)]);
 if(!exited) child.kill('SIGKILL');
 if(browser) await Promise.race([browser.close().catch(()=>{}),delay(3000)]);
 clearTimeout(watchdog);
}
