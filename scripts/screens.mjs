// Viewport screenshots of the running app (dev server on :5173) through headless Chrome, driven over
// the DevTools protocol with Node's built-in WebSocket: no extra dependency.
//
//   node scripts/screens.mjs <outDir> <name>=<email>@<path>[,<lang>,<theme>,<w>x<h>] ...
//   e.g. node scripts/screens.mjs docs/screens/17c dash=director@showcase.test@/app/dashboard,ar,dark
//
// The password comes from SHOWCASE_PASSWORD (or DEMO_PASSWORD) in the environment.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = process.env.SCREENS_BASE ?? 'http://localhost:5173';
const CHROME =
  process.env.CHROME ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(Boolean);
const PASSWORD = process.env.SHOWCASE_PASSWORD ?? process.env.DEMO_PASSWORD;
const [outDir, ...jobs] = process.argv.slice(2);
if (!outDir || !jobs.length || !PASSWORD) {
  console.error(
    'usage: SHOWCASE_PASSWORD=… node scripts/screens.mjs <outDir> name=email@path[,lang,theme,WxH]…',
  );
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${port}`,
    '--headless=new',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--user-data-dir=${process.env.TEMP ?? '/tmp'}/screens-profile-${port}`,
    '--no-first-run',
    'about:blank',
  ],
  { stdio: 'ignore' },
);
process.on('exit', () => chrome.kill());

async function endpoint() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((entry) => entry.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error('Chrome did not start');
}

const socket = new WebSocket(await endpoint());
await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
let counter = 0;
const waiting = new Map();
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (message.id && waiting.has(message.id)) {
    waiting.get(message.id)(message);
    waiting.delete(message.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++counter;
    waiting.set(id, (message) =>
      message.error
        ? reject(new Error(`${method}: ${message.error.message}`))
        : resolve(message.result),
    );
    socket.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const { result, exceptionDetails } = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails)
    throw new Error(exceptionDetails.exception?.description ?? 'evaluate failed');
  return result.value;
};
async function waitFor(expression, label, tries = 80) {
  for (let i = 0; i < tries; i++) {
    if (await evaluate(expression).catch(() => false)) return;
    await sleep(250);
  }
  throw new Error('timeout waiting for ' + label);
}
const navigate = async (url) => {
  await send('Page.navigate', { url });
  await sleep(400);
  await waitFor("document.readyState === 'complete'", 'load');
};

await send('Page.enable');
// SCREENS_TIME_OFFSET_HOURS=12 shifts the page clock forward, so relative times ("12 min ago") read
// naturally when the showcase data was generated for a later time of day than it is now.
const offsetMs = Number(process.env.SCREENS_TIME_OFFSET_HOURS ?? 0) * 3_600_000;
if (offsetMs) {
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => { const RealDate = Date; const offset = ${offsetMs};
      class FakeDate extends RealDate {
        constructor(...args) { super(...(args.length ? args : [RealDate.now() + offset])); }
        static now() { return RealDate.now() + offset; }
      }
      globalThis.Date = FakeDate; })();`,
  });
}
let signedInAs = null;
for (const job of jobs) {
  const [name, rest] = [job.slice(0, job.indexOf('=')), job.slice(job.indexOf('=') + 1)];
  const [target, lang = 'en', theme = 'dark', size = '1440x900', scroll = '0'] = rest.split(',');
  const at = target.lastIndexOf('@/');
  const email = target.slice(0, at);
  const path = target.slice(at + 1);
  const [width, height] = size.split('x').map(Number);
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 700,
  });
  await navigate(BASE + '/login');
  const surface = path.startsWith('/field')
    ? 'field'
    : path.startsWith('/portal')
      ? 'portal'
      : 'app';
  await evaluate(
    `localStorage.setItem('fieldflow.language', '${lang}'); localStorage.setItem('acticrew.theme.${surface}', '${theme}'); true`,
  );
  if (signedInAs !== email) {
    await evaluate(
      "fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => 0).then(() => true)",
    );
    await navigate(BASE + '/login');
    await waitFor("!!document.querySelector('input[type=password]')", 'login form');
    await evaluate(`(() => {
      const set = (input, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set(document.querySelector('input[type=email], input[name=email], input[autocomplete=username]'), ${JSON.stringify(email)});
      set(document.querySelector('input[type=password]'), ${JSON.stringify(PASSWORD)});
      document.querySelector('form').requestSubmit();
      return true;
    })()`);
    await waitFor("!location.pathname.startsWith('/login')", 'sign-in').catch(async (error) => {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(outDir + '/_login-failure.png', Buffer.from(shot.data, 'base64'));
      throw error;
    });
    signedInAs = email;
  }
  await navigate(BASE + path);
  await evaluate(`localStorage.setItem('fieldflow.language', '${lang}'); true`);
  await send('Page.reload');
  await sleep(500);
  await waitFor("document.readyState === 'complete'", 'load');
  // Surfaces that follow the user's own language (the field app) ignore the stored choice: use
  // the language switcher so the requested language is what is captured.
  if ((await evaluate('document.documentElement.lang')) !== lang) {
    await evaluate(`(() => {
      const wanted = ${JSON.stringify(lang === 'en' ? 'EN' : 'العربية')};
      [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === wanted)?.click();
      return true;
    })()`);
    await sleep(600);
  }
  await waitFor(
    "document.querySelectorAll('[role=status]:not(.sr-only)').length === 0",
    'loading',
    16,
  ).catch(() => {});
  await sleep(Number(process.env.SCREENS_WAIT ?? 1500));
  if (Number(scroll)) {
    await evaluate(
      `(document.querySelector('#main')?.parentElement ?? document.scrollingElement).scrollTop = ${Number(scroll)}; true`,
    );
    await sleep(700);
    // After a long scroll the top bar and the sidebar must still sit at the top of the viewport.
    const positions = await evaluate(`(() => {
      const top = (selector) => document.querySelector(selector)?.getBoundingClientRect().top;
      return { header: top('header'), sidebar: top('aside'), pageScrolls: window.scrollY };
    })()`);
    console.log('after scroll', name, JSON.stringify(positions));
  }
  if (process.env.SCREENS_EVAL)
    console.log('eval', name, JSON.stringify(await evaluate(process.env.SCREENS_EVAL)));
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  const file = `${outDir}/${name}.png`;
  writeFileSync(file, Buffer.from(data, 'base64'));
  console.log('saved', file);
}
socket.close();
chrome.kill();
