import {createRequire} from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.CODEX_NODE_MODULES ? path.join(process.env.CODEX_NODE_MODULES, 'playwright') : 'playwright');
const extension = path.resolve('extension');
const context = await chromium.launchPersistentContext(path.resolve('test-output/native-edge-profile'), {channel: 'msedge', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const status = await worker.evaluate(() => new Promise((resolve, reject) => {
    const port = chrome.runtime.connectNative('com.mediadock.downloader');
    port.onMessage.addListener(reply => { resolve(reply); port.disconnect(); });
    port.onDisconnect.addListener(() => { const error = chrome.runtime.lastError; if (error) reject(new Error(error.message)); });
    port.postMessage({id: 'edge-smoke', action: 'status'});
  }));
  assert.equal(status.ok, true); assert.equal(status.data.ready, true);
  console.log('PASS: real Edge native messaging registration, host launch and framed status reply.');
} finally { await context.close(); }
