import puppeteer from 'puppeteer';
import { config } from '../config.js';
import { buildBrowserlessEndpoint } from '../services/WWBClientFactory.js';

async function main() {
  console.log('[Test] Testing Browserless integration configuration...');

  const wsEndpoint = buildBrowserlessEndpoint();
  console.log('[Test] Resolved Browserless WS Endpoint:', wsEndpoint.replace(/token=([^&]+)/, 'token=REDACTED'));

  const wsEndpointWithProxy = buildBrowserlessEndpoint({
    host: 'proxy.example.com',
    port: 8080,
    username: 'user',
    password: 'pass'
  });
  console.log('[Test] Resolved Browserless WS Endpoint with Proxy:', wsEndpointWithProxy.replace(/token=([^&]+)/, 'token=REDACTED'));

  if (!wsEndpoint) {
    console.error('[Test] FAIL: No Browserless WS Endpoint configured.');
    process.exit(1);
  }

  try {
    console.log('[Test] Connecting to Browserless via Puppeteer...');
    const browser = await puppeteer.connect({
      browserWSEndpoint: wsEndpoint,
    });

    console.log('[Test] Connected successfully! Opening new page...');
    const page = await browser.newPage();

    await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
    const title = await page.title();
    console.log('[Test] Page title fetched:', title);

    await page.close();
    await browser.disconnect();

    console.log('[Test] SUCCESS: Browserless connection and session cleanup verified.');
  } catch (err) {
    console.error('[Test] Connection error:', err);
    process.exit(1);
  }
}

main();
