const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const build = require('./build');
const agent = require('./agent');

const WIN = process.platform === 'win32';
const DEFAULTS = {
  wizardDone: false, provider: 'auto', ollamaModel: '', geminiModel: 'gemini-2.5-flash',
  githubModel: 'openai/gpt-4.1', outDir: '', autoFix: true, maxAttempts: 2, secrets: {}
};
const TOOLS = [
  { id: 'node', name: 'Node.js', cmd: 'node -v', winget: 'OpenJS.NodeJS.LTS', url: 'https://nodejs.org' },
  { id: 'npm', name: 'npm', cmd: 'npm -v' },
  { id: 'java', name: 'JDK 17 (Java)', cmd: 'java -version 2>&1', winget: 'Microsoft.OpenJDK.17', url: 'https://adoptium.net' },
  { id: 'git', name: 'Git', cmd: 'git --version', winget: 'Git.Git', url: 'https://git-scm.com' },
  { id: 'ollama', name: 'Ollama (yerel AI)', cmd: 'ollama -v', winget: 'Ollama.Ollama', url: 'https://ollama.com' },
  { id: 'android', name: 'Android SDK', env: ['ANDROID_HOME', 'ANDROID_SDK_ROOT'], winget: 'Google.AndroidStudio', url: 'https://developer.android.com/studio' }
];
const TASK_FIX = 'Derleme başarısız oldu. Log’daki ilk gerçek hatayı bul, ilgili dosyayı oku ve düzeltmeyi write_file ile uygula. Bitince final ile ne değiştirdiğini yaz. Emin değilsen dosya yazma.';

let win = null;
let cfg = { ...DEFAULTS };
let busy = false;
let cancelled = false;
let proc = null;

const cfgFile = () => path.join(app.getPath('userData'), 'config.json');
function loadCfg() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(cfgFile(), 'utf8')) }; }
  catch { return { ...DEFAULTS }; }
}
function saveCfg() {
  fs.mkdirSync(path.dirname(cfgFile()), { recursive: true });
  fs.writeFileSync(cfgFile(), JSON.stringify(cfg, null, 2));
}
function enc(v) {
  return safeStorage.isEncryptionAvailable()
    ? 'e:' + safeStorage.encryptString(v).toString('base64')
    : 'p:' + Buffer.from(v, 'utf8').toString('base64');
}
function dec(v) {
  if (!v) return '';
  if (v.startsWith('e:')) return safeStorage.decryptString(Buffer.from(v.slice(2), 'base64'));
  return Buffer.from(v.slice(2), 'base64').toString('utf8');
}
const secret = (name) => { try { return dec((cfg.secrets || {})[name]); } catch { return ''; } };
const agentCfg = () => ({
  provider: cfg.provider, ollamaModel: cfg.ollamaModel,
  geminiKey: secret('gemini'), geminiModel: cfg.geminiModel,
  githubToken: secret('github'), githubModel: cfg.githubModel
});
const publicCfg = () => {
  const { secrets, ...rest } = cfg;
  return { ...rest, hasKeys: { gemini: !!secret('gemini'), github: !!secret('github') } };
};
const send = (sender, ch, d) => { if (sender && !sender.isDestroyed()) sender.send(ch, d); };
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 1040, minHeight: 680,
    backgroundColor: '#03060d', autoHideMenuBar: true, title: 'OmniBuild',
    icon: path.join(__dirname, 'assets', 'icon-512.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

function checkTools() {
  return TOOLS.map((t) => {
    let version = null;
    if (t.cmd) {
      try { version = execSync(t.cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: true, timeout: 8000 }).trim().split('\n')[0]; }
      catch { version = null; }
    }
    if (t.env) version = t.env.map((k) => process.env[k]).find(Boolean) || null;
    return { id: t.id, name: t.name, ok: !!version, version, canInstall: !!(WIN && t.winget), url: t.url || null };
  });
}

// Sürekli akışlı komut (kurulum, ollama pull vb.)
function streamCmd(sender, cmd, args, channel) {
  const p = spawn(cmd, args, { shell: WIN, env: process.env });
  const pipe = (s, level) => {
    let buf = '';
    s.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      lines.forEach((l) => { if (l.trim()) send(sender, channel, { level, text: l }); });
    });
  };
  pipe(p.stdout, 'out');
  pipe(p.stderr, 'err');
  p.on('error', (e) => send(sender, channel, { level: 'error', text: e.message, done: true, code: 1 }));
  p.on('close', (code) => send(sender, channel, { level: code === 0 ? 'ok' : 'error', text: `çıkış kodu ${code}`, done: true, code }));
  return p;
}

function runStep(s, log) {
  return new Promise((resolve) => {
    const q = (x) => (/\s/.test(x) ? `"${x}"` : x);
    proc = spawn(q(s.cmd), s.args.map(q), { cwd: s.cwd, shell: true, env: { ...process.env, FORCE_COLOR: '0' } });
    const pipe = (stream, level) => {
      let buf = '';
      stream.on('data', (d) => {
        buf += d.toString();
        const lines = buf.split(/\r?\n/);
        buf = lines.pop();
        lines.forEach((l) => { if (l.trim()) log(level, l); });
      });
    };
    pipe(proc.stdout, 'out');
    pipe(proc.stderr, 'err');
    proc.on('error', (e) => { log('error', e.message); proc = null; resolve(1); });
    proc.on('close', (c) => { proc = null; resolve(c ?? 1); });
  });
}

async function runBuild(sender, opts, attempt) {
  const started = Date.now();
  const tail = [];
  const log = (level, text) => {
    tail.push(`[${level}] ${text}`);
    if (tail.length > 400) tail.shift();
    send(sender, 'build-log', { level, text, t: Date.now() });
  };
  try {
    const info = build.detect(opts.dir);
    if (!info.ok) throw new Error(info.error);
    const steps = build.planSteps(info, opts.target, opts.dir);
    log('info', `Deneme ${attempt} · ${info.name} · tür: ${info.type} · hedef: ${opts.target} · ${steps.length} adım`);
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      send(sender, 'build-step', { index: i, total: steps.length, label: s.label });
      log('step', `▶ ${s.label}`);
      const code = await runStep(s, log);
      if (cancelled) throw new Error('Kullanıcı iptal etti');
      if (code !== 0) throw new Error(`"${s.label}" çıkış kodu: ${code}`);
    }
    const exts = opts.target === 'exe' ? ['.exe'] : ['.apk'];
    const found = build.findArtifact(opts.dir, started, exts);
    if (!found) throw new Error('Derleme bitti ama çıktı dosyası bulunamadı');
    let dest = found;
    if (opts.outDir) {
      fs.mkdirSync(opts.outDir, { recursive: true });
      dest = path.join(opts.outDir, `${info.name}-${stamp()}${path.extname(found)}`);
      fs.copyFileSync(found, dest);
    }
    log('ok', `✔ Hazır: ${dest}`);
    return { ok: true, artifact: dest, attempt, tail: tail.join('\n') };
  } catch (err) {
    log('error', `✖ ${err.message}`);
    return { ok: false, error: err.message, attempt, tail: tail.join('\n') };
  }
}

app.whenReady().then(() => {
  cfg = loadCfg();
  agent.setConfirm((message, detail) => dialog.showMessageBoxSync(win, {
    type: 'question', buttons: ['Onayla', 'Reddet'], defaultId: 1, cancelId: 1,
    title: 'Agent onayı', message, detail
  }) === 0);

  ipcMain.handle('dialog:folder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('shell:open', (_e, p) => shell.openPath(p));
  ipcMain.handle('shell:url', (_e, u) => { if (/^https:\/\//.test(u)) shell.openExternal(u); return true; });
  ipcMain.handle('project:detect', (_e, dir) => build.detect(dir));
  ipcMain.handle('env:check', () => checkTools());

  ipcMain.handle('tool:install', (e, id) => {
    const t = TOOLS.find((x) => x.id === id);
    if (!t) return { ok: false, error: 'Bilinmeyen araç' };
    if (WIN && t.winget) {
      streamCmd(e.sender, 'winget', ['install', '--id', t.winget, '-e', '--accept-package-agreements', '--accept-source-agreements'], 'install-log');
      return { ok: true };
    }
    if (t.url) { shell.openExternal(t.url); return { ok: true, opened: true }; }
    return { ok: false, error: 'Otomatik kurulum yok' };
  });
  ipcMain.handle('ollama:start', () => {
    try { spawn('ollama', ['serve'], { detached: true, stdio: 'ignore', shell: WIN }).unref(); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('ollama:pull', (e, model) => {
    if (!/^[\w.:/-]+$/.test(model)) return { ok: false, error: 'Geçersiz model adı' };
    streamCmd(e.sender, 'ollama', ['pull', model], 'install-log');
    return { ok: true };
  });
  ipcMain.handle('ollama:models', async () => (await agent.ollamaModels()) || []);

  ipcMain.handle('config:get', () => publicCfg());
  ipcMain.handle('config:set', (_e, patch) => {
    const { secrets, ...rest } = patch;
    cfg = { ...cfg, ...rest };
    if (secrets) {
      cfg.secrets = cfg.secrets || {};
      for (const k of Object.keys(secrets)) {
        if (secrets[k]) cfg.secrets[k] = enc(secrets[k]);
      }
    }
    saveCfg();
    return publicCfg();
  });
  ipcMain.handle('ai:test', () => agent.testProvider(agentCfg()));

  ipcMain.handle('build:start', async (e, opts) => {
    if (busy) return { ok: false, error: 'Zaten bir derleme çalışıyor' };
    busy = true;
    cancelled = false;
    const sender = e.sender;
    const max = opts.autoFix ? Math.min(5, Math.max(1, opts.attempts || 2)) : 1;
    let result = null;
    try {
      for (let attempt = 1; ; attempt++) {
        send(sender, 'build-status', { phase: 'building', attempt, max });
        result = await runBuild(sender, opts, attempt);
        if (result.ok || cancelled || attempt >= max) break;
        send(sender, 'build-status', { phase: 'fixing', attempt, max });
        const fix = await agent.runAgent(sender, {
          runId: `fix-${Date.now()}`, task: TASK_FIX, projectDir: opts.dir,
          logContext: result.tail, autoApply: true, cfg: agentCfg()
        });
        if (cancelled || !fix.ok || fix.writes === 0) break;
      }
    } finally {
      busy = false;
    }
    send(sender, 'build-done', result);
    return result;
  });

  ipcMain.handle('build:cancel', () => {
    cancelled = true;
    agent.stopAll();
    if (proc) {
      if (WIN) spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F']);
      else proc.kill('SIGTERM');
    }
    return true;
  });

  ipcMain.handle('agent:run', (e, p) => {
    agent.runAgent(e.sender, { ...p, cfg: agentCfg() });
    return { started: true };
  });
  ipcMain.handle('agent:stop', (_e, runId) => agent.stop(runId));

  createWindow();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
