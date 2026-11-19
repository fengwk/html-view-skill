// 浏览器：查找 Chrome / Chromium，以临时 profile 与 --remote-debugging-pipe 启动，CDP 走 fd 3 / 4。
// 只用 Node 内置模块。每次启动都新建 profile；结束时结束进程并删除 profile；失败时保留日志给 details。
import {
  accessSync, constants, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync,
} from 'node:fs';
import { rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fail, ToolError } from './output.mjs';

// createBrowser 仅保留作为测试注入点；正常调用直接绑定共享错误 API。
const defaultErrors = { fail, isToolError: (err) => err instanceof ToolError };

// PATH 中按顺序查找的名字；Windows 上找带 .exe 的
const PATH_NAMES = [
  'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser',
  'microsoft-edge', 'microsoft-edge-stable', 'msedge',
];
const WINDOWS_NAMES = ['chrome.exe', 'msedge.exe'];

export const CHROME_HINT = '安装 Chrome / Chromium，或设置 CHROME_PATH 指向浏览器可执行文件';

const isExecutable = (path) => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

// 真实系统上环境变量的名字大小写不一致（例如 ProgramFiles(x86)），统一做一次不敏感查找
function envValue(env, name) {
  if (env[name] != null) return env[name];
  const key = Object.keys(env).find((item) => item.toLowerCase() === name.toLowerCase());
  return key ? env[key] : null;
}

// 平台安装路径：macOS 查 /Applications 与 ~/Applications；Windows 按 PROGRAMFILES、PROGRAMFILES(X86)、LOCALAPPDATA 拼
function installPaths(env, platform) {
  if (platform === 'darwin') {
    const home = envValue(env, 'HOME');
    const roots = ['/Applications', home ? join(home, 'Applications') : null].filter(Boolean);
    const apps = [
      join('Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'),
      join('Chromium.app', 'Contents', 'MacOS', 'Chromium'),
      join('Microsoft Edge.app', 'Contents', 'MacOS', 'Microsoft Edge'),
    ];
    return roots.flatMap((root) => apps.map((app) => join(root, app)));
  }
  if (platform === 'win32') {
    const bases = ['PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA']
      .map((name) => envValue(env, name))
      .filter(Boolean);
    const apps = [
      join('Google', 'Chrome', 'Application', 'chrome.exe'),
      join('Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ];
    return bases.flatMap((base) => apps.map((app) => join(base, app)));
  }
  return [];
}

/**
 * 依次查找浏览器：CHROME_PATH → PATH → 平台安装路径。
 * @returns {string | null} 可执行文件路径；找不到时为 null（调用方决定报 BROWSER_NOT_FOUND）
 */
export function findBrowser({ env = process.env, platform = process.platform } = {}) {
  if (env.CHROME_PATH) return isExecutable(env.CHROME_PATH) ? env.CHROME_PATH : null;
  const names = platform === 'win32' ? WINDOWS_NAMES : PATH_NAMES;
  for (const dir of String(env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = join(dir, name);
      if (isExecutable(candidate)) return candidate;
    }
  }
  for (const candidate of installPaths(env, platform)) {
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const alive = (child) => child.exitCode === null && child.signalCode === null;

function waitExit(child, ms) {
  if (!alive(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => { child.off('exit', onExit); resolve(false); }, ms);
    const onExit = () => { clearTimeout(timer); resolve(true); };
    child.once('exit', onExit);
  });
}

/** 强制结束仍在运行的进程：先 SIGTERM，仍不退再 SIGKILL。 */
async function stopChild(child) {
  if (!child?.pid || !alive(child)) return;
  child.kill('SIGTERM');
  if (await waitExit(child, 5000)) return;
  child.kill('SIGKILL');
  await waitExit(child, 3000);
}

/** 异步 rm 的重试会重新遍历目录，清掉退出期间迟到的写入；rmSync 只重试 rmdir。 */
async function removeDir(path) {
  try {
    await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (err) {
    // 清理只是善后，不能把成功结果或原有错误替换成 INTERNAL。
    process.stderr.write(`警告：浏览器临时目录清理失败，残留目录：${path}；可手动删除（${err?.message ?? err}）\n`);
  }
}

function readLogTail(path, size = 2000) {
  try {
    const text = readFileSync(path, 'utf8');
    return text.length > size ? text.slice(-size) : text;
  } catch {
    return '';
  }
}

/**
 * 调试管道连接：向 fd 3 写命令，从 fd 4 读回复，消息之间用 \0 分隔。
 * 不开调试端口，也不轮询 DevToolsActivePort。
 */
class Connection {
  constructor(input, output) {
    this.input = input;
    this.output = output;
    this.seq = 0;
    this.pending = new Map();
    this.listeners = new Set();
    this.buffer = '';
    this.closed = false;
    input.setEncoding('utf8');
    input.on('data', (chunk) => this.receive(chunk));
    input.on('close', () => this.destroy(new Error('浏览器调试管道已关闭')));
    input.on('error', (err) => this.destroy(err));
    output.on('error', (err) => this.destroy(err));
  }

  receive(chunk) {
    this.buffer += chunk;
    let index = this.buffer.indexOf('\0');
    while (index >= 0) {
      const raw = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      index = this.buffer.indexOf('\0');
      if (!raw.trim()) continue;
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        this.destroy(new Error('浏览器返回了无法解析的 CDP 消息'));
        return;
      }
      this.dispatch(message);
    }
  }

  dispatch(message) {
    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(`${message.error.message}${message.error.data ? `：${message.error.data}` : ''}`));
      else resolve(message.result);
      return;
    }
    if (message.method) for (const fn of this.listeners) fn(message);
  }

  send(method, params = {}, sessionId) {
    if (this.closed) return Promise.reject(new Error(`浏览器连接已关闭，无法执行 ${method}`));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.output.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    });
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  close() {
    this.destroy(new Error('浏览器已关闭'));
    this.input.destroy();
    this.output.end();
  }

  destroy(err) {
    if (this.closed) return;
    this.closed = true;
    for (const { reject } of this.pending.values()) reject(err);
    this.pending.clear();
  }
}

/** 一个页面（target 的 flatten 会话）。 */
export class Page {
  constructor(browser, sessionId, targetId, fail = defaultErrors.fail) {
    this.browser = browser;
    this.sessionId = sessionId;
    this.targetId = targetId;
    this.fail = fail;
    this.listeners = new Set();
    this.offConnection = browser.conn.on((msg) => {
      if (msg.sessionId !== sessionId) return;
      for (const fn of this.listeners) fn(msg);
    });
  }

  send(method, params) {
    return this.browser.conn.send(method, params, this.sessionId);
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  once(method) {
    return new Promise((resolve) => {
      const off = this.on((msg) => {
        if (msg.method !== method) return;
        off();
        resolve(msg.params);
      });
    });
  }

  /** 执行页面内脚本；脚本抛错说明注入脚本自身有问题，按内部缺陷处理。 */
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true, userGesture: true,
    });
    if (result.exceptionDetails) {
      const { exceptionDetails } = result;
      const detail = exceptionDetails.exception?.description ?? exceptionDetails.text;
      const err = new Error(`页面脚本执行失败：${detail}`);
      err.internal = true;
      throw err;
    }
    return result.result.value;
  }

  /** 求值并按 JSON 解析：注入脚本统一返回 JSON 字符串，避免远端对象的序列化差异。 */
  async json(expression) {
    const raw = await this.evaluate(expression);
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  }

  async setViewport({ width, height, deviceScaleFactor = 1, mobile = false }) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile });
  }

  async setMedia(media) {
    await this.send('Emulation.setEmulatedMedia', { media: media ?? '' });
  }

  /** 打开页面并等它稳定：load 事件、字体就绪、两帧渲染。 */
  async goto(url, { timeout = 20000 } = {}) {
    const loaded = this.once('Page.loadEventFired');
    const { errorText } = await this.send('Page.navigate', { url });
    if (errorText) this.fail('BROWSER_FAILED', `无法打开页面：${errorText}`, { next: '确认文件路径存在且可读' });
    await withTimeout(loaded, timeout, `页面加载超时：${url}`);
    await this.evaluate('document.fonts && document.fonts.ready ? document.fonts.ready.then(() => 1) : 1');
    await this.evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(1))))');
  }

  /**
   * 截取页面坐标中的一块区域（CSS px），返回 PNG 字节。
   * 区域落在当前视口内就直接截可见画面：超出视口截图时 Chrome 会临时改变视口，
   * 页面收到 resize / scroll（期间 innerHeight 可能短暂变成几像素），展开的浮层会因此收起或移位。
   */
  async screenshot(clip, { format = 'png' } = {}) {
    const [left, top, width, height] = await this.json('JSON.stringify([scrollX, scrollY, innerWidth, innerHeight])');
    const inside = clip.x >= left && clip.y >= top && clip.x + clip.width <= left + width && clip.y + clip.height <= top + height;
    const { data } = await this.send('Page.captureScreenshot', {
      format, captureBeyondViewport: !inside, fromSurface: true, clip: { ...clip, scale: 1 },
    });
    return Buffer.from(data, 'base64');
  }

  async printToPDF(params) {
    const { data } = await this.send('Page.printToPDF', params);
    return Buffer.from(data, 'base64');
  }

  async close() {
    this.offConnection();
    this.listeners.clear();
    try {
      await this.browser.send('Target.closeTarget', { targetId: this.targetId });
    } catch {
      // 浏览器可能已经退出
    }
  }
}

/** 一次浏览器会话：一个进程、一个临时 profile、一条调试管道。 */
export class Browser {
  constructor({
    child, conn, chromePath, profile, dir, logPath, fail = defaultErrors.fail,
  }) {
    this.child = child;
    this.conn = conn;
    this.chromePath = chromePath;
    this.profile = profile;
    this.dir = dir;
    this.logPath = logPath;
    this.fail = fail;
    this.pid = child.pid;
    this.closed = false;
  }

  send(method, params) {
    return this.conn.send(method, params);
  }

  async newPage() {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(this, sessionId, targetId, this.fail);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Log.enable');
    await page.send('Network.enable');
    // Chrome 只用来读取本地产物；截图和导出不能以联网补救缺失资源。
    await page.send('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
    return page;
  }

  /** 结束进程、关闭连接并删除临时 profile；keepLog 时保留 chrome.log 供 details 引用。 */
  async close({ keepLog = false } = {}) {
    if (this.closed) return;
    this.closed = true;
    try {
      await withTimeout(this.send('Browser.close'), 3000, '关闭浏览器超时');
    } catch {
      // Browser.close 可能先断开连接，进程仍会退出
    }
    // CDP 回复只表示已接受关闭；先等正常退出，避免立即 SIGTERM 打断 profile 收尾。
    if (!await waitExit(this.child, 3000)) await stopChild(this.child);
    this.conn.close();
    await removeDir(keepLog ? this.profile : this.dir);
  }
}

const LAUNCH_ARGS = (profile) => [
  '--headless=new',
  '--remote-debugging-pipe',
  // 新 profile 启动时不触发 Linux 密钥环 / macOS 钥匙串弹框
  '--password-store=basic',
  '--use-mock-keychain',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-extensions',
  '--disable-sync',
  '--disable-gpu',
  '--mute-audio',
  '--allow-file-access-from-files',
  '--hide-scrollbars',
  `--user-data-dir=${profile}`,
  'about:blank',
];

/**
 * 启动浏览器。失败时报 BROWSER_NOT_FOUND / BROWSER_FAILED，并保证已启动的进程与 profile 被清理。
 * @param {{chromePath?: string, timeout?: number}} options
 * @param {{fail: Function}} errors 调用方的错误策略
 */
export async function launchBrowser({ chromePath, timeout = 20000 } = {}, errors = defaultErrors) {
  const { fail } = errors;
  const bin = chromePath ?? findBrowser();
  if (!bin) {
    const configured = !chromePath && process.env.CHROME_PATH;
    fail('BROWSER_NOT_FOUND', configured
      ? `CHROME_PATH 指向的浏览器不可执行：${process.env.CHROME_PATH}`
      : '找不到可用的 Chrome / Chromium', { next: CHROME_HINT });
  }
  if (!existsSync(bin)) {
    fail('BROWSER_NOT_FOUND', `CHROME_PATH 指向的文件不存在：${bin}`, { next: CHROME_HINT });
  }
  const dir = mkdtempSync(join(tmpdir(), 'htmlview-browser-'));
  const profile = join(dir, 'profile');
  const logPath = join(dir, 'chrome.log');
  // 让浏览器自己的临时文件也落在本目录：结束时一次清理，不给系统临时目录留东西
  const childTmp = join(dir, 'tmp');
  mkdirSync(childTmp);
  const fd = openSync(logPath, 'w');
  const child = spawn(bin, LAUNCH_ARGS(profile), {
    stdio: ['ignore', fd, fd, 'pipe', 'pipe'],
    env: { ...process.env, TMPDIR: childTmp, TMP: childTmp, TEMP: childTmp },
  });
  closeSync(fd);

  let exitInfo = null;
  child.once('exit', (code, signal) => { exitInfo = { code, signal }; });

  const failLaunch = async (reason) => {
    await stopChild(child);
    await removeDir(profile);
    fail('BROWSER_FAILED', `浏览器没能启动${exitInfo ? `（退出码 ${exitInfo.code ?? exitInfo.signal}）` : ''}：${reason}`, {
      retryable: true,
      next: `查看 ${logPath} 中的浏览器日志；也可以设置 CHROME_PATH 换一个浏览器`,
      details: { browser: bin, log: logPath, exit: exitInfo?.code ?? exitInfo?.signal ?? null, output: readLogTail(logPath) },
    });
  };

  try {
    // 可执行文件存在时，启动仍可能因解释器或运行环境缺失而失败。
    await once(child, 'spawn');
  } catch (err) {
    await failLaunch(err.message);
  }
  if (!child.stdio[3] || !child.stdio[4]) {
    await failLaunch('调试管道没有创建出来');
  }
  const conn = new Connection(child.stdio[4], child.stdio[3]);
  try {
    // 管道没有端口文件可轮询：发一条 Browser.getVersion 确认浏览器已经在读命令
    await withTimeout(conn.send('Browser.getVersion'), timeout, '等待浏览器调试管道超时');
  } catch (err) {
    conn.close();
    await failLaunch(err?.message ?? String(err));
  }
  return new Browser({
    child, conn, chromePath: bin, profile, dir, logPath, fail,
  });
}

/** 启动 → 执行 → 一定清理。run 内的异常统一上报为 BROWSER_FAILED（注入脚本自身的问题除外）。 */
export async function withBrowser(run, options = {}, errors = defaultErrors) {
  const { fail, isToolError } = errors;
  const browser = await launchBrowser(options, errors);
  // 只有浏览器自身的问题才需要留下日志；USAGE 之类的输入错误直接清理
  let keepLog = false;
  try {
    return await run(browser);
  } catch (err) {
    if (isToolError(err)) {
      keepLog = err.code === 'BROWSER_FAILED';
      throw err;
    }
    if (err?.internal) {
      fail('INTERNAL', `htmlview 内部错误：${err.message}`, {
        state: 'unknown',
        next: '这是技能缺陷：把这条输出和 stderr 报告给技能维护者；目标文件没有被改动',
      });
    }
    keepLog = true;
    fail('BROWSER_FAILED', `浏览器操作失败：${err?.message ?? err}`, {
      retryable: true,
      next: `重试一次；仍失败时查看 ${browser.logPath} 中的浏览器日志`,
      details: { browser: browser.chromePath, log: browser.logPath, output: readLogTail(browser.logPath) },
    });
  } finally {
    await browser.close({ keepLog });
  }
}

/** 用调用方的错误策略生成一组浏览器 API；同一实现可被多个技能各自绑定。 */
export function createBrowser({ fail, isToolError = () => false }) {
  if (typeof fail !== 'function') throw new TypeError('createBrowser 需要调用方提供 fail 函数');
  const errors = { fail, isToolError };
  return {
    CHROME_HINT,
    findBrowser,
    Page,
    Browser,
    launchBrowser: (options) => launchBrowser(options, errors),
    withBrowser: (run, options) => withBrowser(run, options, errors),
  };
}
