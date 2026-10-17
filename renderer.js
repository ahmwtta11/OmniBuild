const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const TYPE = { capacitor: 'Capacitor', cordova: 'Cordova', electron: 'Electron (Windows)', gradle: 'Native Android', node: 'Node / Web', unknown: 'Bilinmiyor' };
const TASK_FIX = 'Derleme başarısız oldu. Log’daki ilk gerçek hatayı bul, ilgili dosyayı oku ve düzeltmeyi write_file ile uygula. Bitince final ile ne değiştirdiğini yaz. Emin değilsen dosya yazma.';

const RULES = [
  { re: /JAVA_HOME|Unsupported class file major version|invalid source release|JDK/i, title: 'Java sürümü uyumsuz', fix: 'JDK 17 kurun ve JAVA_HOME ayarlayın. AGP sürümü ile JDK uyumlu olmalı.' },
  { re: /SDK location not found|ANDROID_HOME|ANDROID_SDK_ROOT|sdk\.dir/i, title: 'Android SDK bulunamadı', fix: 'Android Studio ile SDK kurun, ANDROID_HOME ayarlayın veya local.properties içine sdk.dir yazın.' },
  { re: /Could not resolve|Could not GET|UnknownHostException|ETIMEDOUT|ECONNRESET|ENOTFOUND/i, title: 'Ağ / bağımlılık indirme hatası', fix: 'İnternet ve proxy ayarlarını kontrol edin, sonra tekrar deneyin.' },
  { re: /npm ERR!|npm error|Cannot find module/i, title: 'NPM hatası', fix: 'node_modules klasörünü silip npm install çalıştırın; package-lock.json çakışmalarına bakın.' },
  { re: /Execution failed for task ':[\w-]+:\w+'/i, title: 'Gradle görevi başarısız', fix: 'Hata satırının üstündeki ayrıntıya bakın. Gerekirse AI ile düzeltin.' },
  { re: /Duplicate class|Manifest merger failed/i, title: 'Manifest / sınıf çakışması', fix: 'Aynı kütüphanenin farklı sürümlerini tek sürümde birleştirin.' },
  { re: /minSdk|compileSdk|targetSdk|requires Android/i, title: 'SDK seviyesi uyumsuzluğu', fix: 'compileSdk ve minSdk değerlerini bağımlılıkların gerektirdiği seviyeye göre güncelleyin.' },
  { re: /OutOfMemoryError|Java heap space|GC overhead/i, title: 'Bellek yetersiz', fix: 'gradle.properties içine org.gradle.jvmargs=-Xmx4096m ekleyin.' },
  { re: /Cannot find module 'electron'|electron-builder.*(not found|ENOENT)/i, title: 'Electron bağımlılığı eksik', fix: 'package.json içinde electron ve electron-builder devDependencies olarak tanımlı olmalı; npm install çalıştırın.' },
  { re: /winCodeSign|signtool|code sign|signing/i, title: 'Kod imzalama uyarısı', fix: 'İmzasız derleme için package.json build.win içine "signAndEditExecutable": false ekleyin.' },
  { re: /icon.*(ico|png|size)|Invalid icon/i, title: 'İkon hatası', fix: 'build/icon.png dosyasını en az 256x256 boyutlu, geçerli bir PNG yapın.' },
  { re: /is not recognized as an internal or external command|command not found|not recognized/i, title: 'Komut bulunamadı', fix: 'Node.js, Java veya Gradle PATH içinde değil. Kurulumdan sonra uygulamayı yeniden başlatın.' }
];

const S = { dir: null, info: null, outDir: '', logs: [], building: false, steps: [], active: 0, lastArtifact: null, cfg: null, tools: [], timer: null };
const ai = { running: null, thinking: null };

// ---------- Yardımcılar ----------
function status(text, kind = '') { $('#status').textContent = text; $('#status').className = 'status ' + kind; }
function setProgress(p, label) {
  $('#bar').style.width = Math.round(Math.min(1, Math.max(0, p)) * 100) + '%';
  $('#pct').textContent = Math.round(Math.min(1, Math.max(0, p)) * 100) + '%';
  if (label !== undefined) $('#stepLabel').textContent = label;
}
function renderStepper() {
  $('#stepper').innerHTML = S.steps.map((s, i) =>
    `<div class="st ${i < S.active ? 'done' : i === S.active ? 'on' : ''}"><i></i>${String(s).replace(/^▶\s?/, '')}</div>`).join('');
}
function lineEl(e) {
  const d = document.createElement('div');
  d.className = `line ${e.level}`;
  const t = document.createElement('span'); t.className = 't';
  t.textContent = new Date(e.t).toLocaleTimeString('tr-TR');
  const m = document.createElement('span'); m.textContent = e.text;
  d.append(t, m);
  return d;
}
const isErr = (e) => e.level === 'error' || e.level === 'err';
function renderConsole() {
  const box = $('#console');
  box.innerHTML = '';
  const frag = document.createDocumentFragment();
  state_logs().forEach((e) => { if (!$('#filterErr').checked || isErr(e)) frag.appendChild(lineEl(e)); });
  box.appendChild(frag);
  box.scrollTop = box.scrollHeight;
  $('#lineCount').textContent = `${S.logs.length} satır`;
}
const state_logs = () => S.logs;
function addLine(e) {
  S.logs.push(e);
  if (S.logs.length > 4000) S.logs.shift();
  $('#lineCount').textContent = `${S.logs.length} satır`;
  if (!$('#filterErr').checked || isErr(e)) {
    $('#console').appendChild(lineEl(e));
    $('#console').scrollTop = $('#console').scrollHeight;
  }
  if (isErr(e)) { clearTimeout(S.timer); S.timer = setTimeout(analyze, 400); }
}
function analyze() {
  const text = S.logs.slice(-500).filter((l) => isErr(l) || /error|failed|exception|✖/i.test(l.text)).map((l) => l.text).join('\n');
  const hits = RULES.filter((r) => r.re.test(text));
  const diag = $('#diag');
  if (!hits.length) { diag.innerHTML = '<div class="empty">Bilinen bir hata deseni yok. Derleme sırasında hata çıkarsa burada anında görünür.</div>'; return; }
  diag.innerHTML = hits.map((r) => `<div class="card"><h4>${r.title}</h4><p>${r.fix}</p></div>`).join('') +
    `<button class="btn gold" id="diagAI">🛠 AI ile düzelt</button>`;
  $('#diagAI').onclick = () => { $$('.tab')[1].click(); askAgent(TASK_FIX); };
}
function addChat(role, content, html = false) {
  const d = document.createElement('div');
  d.className = `msg ${role}`;
  if (html) d.innerHTML = content; else d.textContent = content;
  $('#chat').appendChild(d);
  $('#chat').scrollTop = $('#chat').scrollHeight;
  return d;
}
function fmt(t) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc(t).split(/```/).map((p, i) => i % 2
    ? `<pre>${p.replace(/^[\w+-]*\n/, '')}</pre>`
    : p.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>')).join('');
}
function showThinking() {
  if (ai.thinking) ai.thinking.remove();
  ai.thinking = addChat('ai', '<span class="dots"><i></i><i></i><i></i></span>', true);
}
function endThinking() { if (ai.thinking) ai.thinking.remove(); ai.thinking = null; }

// ---------- Araçlar / rozetler ----------
function renderPills() {
  $('#pills').innerHTML = S.tools.map((t) => `<span class="pill ${t.ok ? 'ok' : 'bad'}" title="${t.version || 'bulunamadı'}">${t.ok ? '●' : '○'} ${t.name}</span>`).join('');
}
async function refreshTools() {
  S.tools = await window.forge.envCheck();
  renderPills();
  if (wz === 1 && $('#toolList')) renderToolList();
}
async function refreshBadge() {
  const models = await window.forge.ollamaModels();
  const prov = S.cfg.provider === 'auto' ? 'Otomatik' : S.cfg.provider;
  const b = $('#modelBadge');
  b.textContent = `${prov} · ${models.length ? 'Ollama ● ' + models.length + ' model' : 'Ollama ○'}`;
  b.className = 'badge ' + (models.length || S.cfg.hasKeys.github || S.cfg.hasKeys.gemini ? 'ok' : 'bad');
}

// ---------- Proje ----------
$('#pickProj').onclick = async () => {
  const dir = await window.forge.pickFolder();
  if (!dir) return;
  const info = await window.forge.detect(dir);
  if (!info.ok) return status(info.error, 'err');
  S.dir = dir; S.info = info;
  $('#projName').textContent = info.name;
  $('#projType').textContent = TYPE[info.type];
  $('#projPath').textContent = dir;
  $('#target').value = info.type === 'electron' ? 'exe' : 'apk-debug';
  addLine({ level: 'info', text: `Proje seçildi: ${info.name} · ${TYPE[info.type]}`, t: Date.now() });
  status('Proje hazır', 'ok');
};
$('#pickOut').onclick = async () => {
  const dir = await window.forge.pickFolder();
  if (!dir) return;
  S.outDir = dir;
  $('#outPath').textContent = dir;
  window.forge.setConfig({ outDir: dir });
};
$('#autoFix').onchange = (e) => window.forge.setConfig({ autoFix: e.target.checked });
$('#attempts').onchange = (e) => window.forge.setConfig({ maxAttempts: +e.target.value });
$('#filterErr').onchange = renderConsole;
$('#clearBtn').onclick = () => { S.logs = []; $('#console').innerHTML = ''; $('#lineCount').textContent = ''; };
$('#copyBtn').onclick = () => navigator.clipboard.writeText(S.logs.map((l) => l.text).join('\n'));
$('#openBtn').onclick = () => S.lastArtifact && window.forge.openPath(S.lastArtifact.replace(/[\\/][^\\/]+$/, ''));
$('#runBtn').onclick = () => S.lastArtifact && window.forge.openPath(S.lastArtifact);

// ---------- Derleme ----------
function setBuildUI(on) {
  $('#buildBtn').disabled = on;
  $('#cancelBtn').disabled = !on;
}
$('#buildBtn').onclick = () => {
  if (!S.dir) return status('Önce bir proje klasörü seçin', 'warn');
  if (S.building) return;
  S.building = true; S.steps = []; S.active = 0;
  $('#result').hidden = true;
  setBuildUI(true);
  renderStepper();
  setProgress(0, 'Başlıyor…');
  status('Derleniyor…', 'busy');
  window.forge.build({
    dir: S.dir, target: $('#target').value, outDir: S.outDir,
    autoFix: $('#autoFix').checked, attempts: +$('#attempts').value
  }).catch((e) => { S.building = false; setBuildUI(false); status(e.message, 'err'); });
};
$('#cancelBtn').onclick = () => window.forge.cancel();

window.forge.onLog(addLine);
window.forge.onStep((d) => {
  S.steps[d.index] = d.label;
  S.active = d.index;
  renderStepper();
  setProgress(d.index / d.total, d.label);
});
window.forge.onStatus((d) => {
  if (d.phase === 'fixing') {
    status(`AI düzeltiyor… (deneme ${d.attempt}/${d.max})`, 'busy');
    addChat('meta', `🛠 Derleme hatası — AI otomatik düzeltme ${d.attempt}/${d.max}`);
    $$('.tab')[1].click();
  } else {
    status(`Derleme denemesi ${d.attempt}/${d.max}`, 'busy');
  }
});
window.forge.onDone((d) => {
  S.building = false;
  setBuildUI(false);
  if (d.ok) {
    S.lastArtifact = d.artifact;
    setProgress(1, 'Tamamlandı');
    S.active = S.steps.length;
    renderStepper();
    status(`Hazır ✔ (deneme ${d.attempt})`, 'ok');
    $('#resName').textContent = d.artifact;
    $('#result').hidden = false;
  } else {
    status(`Başarısız ✖ ${d.error}`, 'err');
    $$('.tab')[0].click();
  }
  analyze();
});

// ---------- Sekmeler ----------
$$('.tab').forEach((b) => b.onclick = () => {
  $$('.tab').forEach((t) => t.classList.toggle('active', t === b));
  $$('.pane').forEach((p) => p.classList.toggle('active', p.id === 'pane-' + b.dataset.tab));
  if (b.dataset.tab === 'diag') analyze();
});

// ---------- AI Ajan ----------
async function askAgent(task) {
  if (ai.running) return;
  if (!S.dir) return addChat('sys', 'Önce bir proje klasörü seçin; ajan dosyaları oradan okuyacak.');
  const runId = 'chat-' + Date.now();
  ai.running = runId;
  $('#stopBtn').disabled = false;
  addChat('user', task);
  $('#chatIn').value = '';
  showThinking();
  window.forge.agentRun({
    runId, task, projectDir: S.dir, autoApply: false,
    logContext: S.logs.slice(-150).map((l) => `[${l.level}] ${l.text}`).join('\n')
  }).catch((e) => { endThinking(); addChat('sys', e.message); ai.running = null; });
}
function finishChat() { endThinking(); ai.running = null; $('#stopBtn').disabled = true; }

window.forge.onAgent((d) => {
  const mine = d.runId === ai.running;
  const fix = String(d.runId).startsWith('fix-');
  if (!mine && !fix) return;
  if (d.type === 'thinking') { if (mine && !ai.thinking) showThinking(); }
  else if (d.type === 'tool') {
    endThinking();
    addChat('tool', `🔧 ${d.tool} ${JSON.stringify(d.args).slice(0, 160)}`);
  } else if (d.type === 'result') {
    addChat('tool', `↳ ${d.preview.slice(0, 220)}`);
    if (mine) showThinking();
  } else if (d.type === 'final') {
    if (mine) finishChat();
    addChat('ai', fmt(d.text), true);
    addChat('meta', `${d.provider}${d.writes ? ` · ${d.writes} dosya değişti` : ''}`);
  } else if (d.type === 'error') {
    if (mine) finishChat();
    addChat('sys', 'Hata: ' + d.text);
  }
});

$('#sendBtn').onclick = () => askAgent($('#chatIn').value.trim());
$('#chatIn').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askAgent($('#chatIn').value.trim()); }
});
$('#stopBtn').onclick = () => { if (ai.running) window.forge.agentStop(ai.running); };
$$('[data-q]').forEach((b) => b.onclick = () => askAgent(b.dataset.q));

// ---------- Kurulum Sihirbazı ----------
const WZ = ['Hoş geldin', 'Ortam', 'Yapay zeka', 'Hazır'];
let wz = 0;

function openWizard(step = 0) { wz = step; $('#wizard').classList.add('show'); renderWiz(); }
function closeWizard() { $('#wizard').classList.remove('show'); }
function renderWiz() {
  $('#wizNav').innerHTML = WZ.map((n, i) =>
    `<button class="wnav${i === wz ? ' on' : ''}${i < wz ? ' done' : ''}" data-i="${i}"><span>${i < wz ? '✓' : i + 1}</span>${n}</button>`).join('');
  $$('.wnav').forEach((b) => b.onclick = () => { wz = +b.dataset.i; renderWiz(); });
  $('#wizPrev').disabled = wz === 0;
  $('#wizNext').textContent = wz === WZ.length - 1 ? 'Bitir ✓' : 'İleri →';
  const body = $('#wizBody');
  body.innerHTML = '';
  body.className = 'wbody';
  void body.offsetWidth;
  body.className = 'wbody anim';
  [pageWelcome, pageEnv, pageAI, pageDone][wz](body);
}
$('#wizPrev').onclick = () => { if (wz > 0) { wz--; renderWiz(); } };
$('#wizNext').onclick = async () => {
  if (wz === 2) await saveAI(true);
  if (wz === WZ.length - 1) {
    S.cfg = await window.forge.setConfig({ wizardDone: true });
    closeWizard();
    refreshBadge();
    return;
  }
  wz++;
  renderWiz();
};
$('#wizClose').onclick = closeWizard;
$('#btnSetup').onclick = () => openWizard(1);
$('#btnAgentSetup').onclick = () => openWizard(2);

function pageWelcome(body) {
  body.innerHTML = `
    <div class="hero">
      <img src="assets/logo.png" class="logo hero-logo" alt="OmniBuild">
      <h2>OmniBuild’a hoş geldiniz</h2>
      <p class="muted">Android APK ve Windows uygulaması derleyin. Hata çıktığında yapay zeka sorunu bulup düzeltsin, sonra yeniden derlesin.</p>
    </div>
    <div class="feat">
      <div><b>📱 Android APK</b>Capacitor, Cordova ve native Gradle projelerini APK’ya çevirir.</div>
      <div><b>🪟 Windows .exe</b>Electron projelerinizi kurulum sihirbazlı hazır Windows uygulamasına dönüştürür.</div>
      <div><b>🧠 AI düzeltme</b>Derleme hatasını okur, dosyayı düzeltir ve yeniden derler. Ollama ile tamamen yerelde çalışır.</div>
    </div>
    <p class="muted small">Bu sihirbaz gerekli araçları kontrol eder, kurar ve AI sağlayıcınızı ayarlar. İstediğiniz zaman ⚙ butonundan tekrar açabilirsiniz.</p>`;
}

function pageEnv(body) {
  body.innerHTML = `
    <div class="rowh"><h3>Gerekli araçlar</h3><button id="envRefresh" class="btn tiny">Yenile</button></div>
    <div id="toolList" class="tools"></div>
    <p class="muted small">Eksik araçları “Kur” ile winget üzerinden otomatik kurabilirsiniz (Windows). Android APK için JDK 17 ve Android SDK gerekir. Windows .exe için Node.js yeterlidir.</p>
    <pre id="installLog" class="logbox"></pre>`;
  renderToolList();
  $('#envRefresh').onclick = async () => { await refreshTools(); };
}

function renderToolList() {
  const list = $('#toolList');
  if (!list) return;
  list.innerHTML = S.tools.map((t) => `
    <div class="tool">
      <span class="dot ${t.ok ? 'ok' : 'bad'}"></span>
      <div><b>${t.name}</b><small>${t.ok ? t.version : 'bulunamadı'}</small></div>
      ${!t.ok && t.canInstall ? `<button class="btn tiny" data-install="${t.id}">Kur</button>` : ''}
      ${!t.ok && t.url ? `<button class="btn tiny ghost2" data-url="${t.url}">Sayfa ↗</button>` : ''}
    </div>`).join('');
  $$('[data-install]').forEach((b) => b.onclick = async () => {
    b.disabled = true; b.textContent = 'Kuruluyor…';
    const r = await window.forge.installTool(b.dataset.install);
    const log = $('#installLog');
    if (log) log.textContent += (r.ok ? '▶ Kurulum başlatıldı…' : '✖ ' + r.error) + '\n';
  });
  $$('[data-url]').forEach((b) => b.onclick = () => window.forge.openUrl(b.dataset.url));
}

function pageAI(body) {
  const c = S.cfg;
  body.innerHTML = `
    <div class="grid3">
      <div class="card">
        <div class="rowh"><h4>Ollama</h4><span id="olBadge" class="badge">…</span></div>
        <p>Anahtarsız, tamamen yerel. Ajanın ana motoru.</p>
        <div class="row"><button id="olStart" class="btn tiny">Başlat</button><button id="olRefresh" class="btn tiny">Yenile</button></div>
        <label>Model<select id="olModel"></select></label>
        <label>Model indir<div class="row"><input id="olPull" value="gemma3:4b"><button id="olPullBtn" class="btn tiny gold">İndir</button></div></label>
        <small class="muted">Öneri: gemma3:4b (genel) · qwen2.5-coder:7b (kod)</small>
      </div>
      <div class="card">
        <div class="rowh"><h4>GitHub Models</h4><span class="badge ${c.hasKeys.github ? 'ok' : ''}">${c.hasKeys.github ? 'kayıtlı' : 'yok'}</span></div>
        <p>Copilot ailesi modelleri. Copilot Chat’in kendisinin herkese açık bir API’si yok; GitHub Models resmi yoldur. “models” izinli bir token kullanın.</p>
        <label>Token<input id="ghTok" type="password" placeholder="${c.hasKeys.github ? 'kayıtlı — değiştirmek için yazın' : 'github_pat_…'}"></label>
        <label>Model<input id="ghModel" value="${c.githubModel}"></label>
      </div>
      <div class="card">
        <div class="rowh"><h4>Gemini API</h4><span class="badge ${c.hasKeys.gemini ? 'ok' : ''}">${c.hasKeys.gemini ? 'kayıtlı' : 'yok'}</span></div>
        <p>İsteğe bağlı. Google AI Studio’dan ücretsiz anahtar alabilirsiniz.</p>
        <label>Anahtar<input id="gKey" type="password" placeholder="${c.hasKeys.gemini ? 'kayıtlı — değiştirmek için yazın' : 'AIza…'}"></label>
        <label>Model<input id="gModel" value="${c.geminiModel}"></label>
      </div>
    </div>
    <div class="card">
      <label>Sağlayıcı sırası
        <select id="prov">
          <option value="auto">Otomatik: Ollama → GitHub Models → Gemini</option>
          <option value="ollama">Sadece Ollama (anahtarsız)</option>
          <option value="github">Sadece GitHub Models</option>
          <option value="gemini">Sadece Gemini</option>
        </select>
      </label>
      <div class="row"><button id="aiSave" class="btn gold">Kaydet</button><button id="aiTest" class="btn">Bağlantıyı test et</button></div>
      <div id="aiOut" class="out"></div>
    </div>
    <pre id="aiLog" class="logbox"></pre>`;
  $('#prov').value = c.provider;
  refreshOllama();
  $('#olRefresh').onclick = refreshOllama;
  $('#olStart').onclick = async () => {
    const r = await window.forge.ollamaStart();
    aiOut(r.ok ? 'Ollama başlatıldı, bekleniyor…' : r.error, r.ok ? '' : 'err');
    setTimeout(refreshOllama, 2500);
  };
  $('#olPullBtn').onclick = async () => {
    const m = $('#olPull').value.trim();
    const r = await window.forge.ollamaPull(m);
    if (!r.ok) aiOut(r.error, 'err');
    else $('#aiLog').textContent += `▶ ollama pull ${m}\n`;
  };
  $('#aiSave').onclick = () => saveAI(false);
  $('#aiTest').onclick = async () => {
    await saveAI(true);
    aiOut('Test ediliyor…', '');
    const r = await window.forge.testAI();
    aiOut(r.ok ? `✔ ${r.provider} yanıt verdi` : `✖ ${r.error}`, r.ok ? 'ok' : 'err');
  };
}

function aiOut(text, kind) { const o = $('#aiOut'); if (o) { o.textContent = text; o.className = 'out ' + (kind || ''); } }

async function refreshOllama() {
  const models = await window.forge.ollamaModels();
  const badge = $('#olBadge');
  if (badge) { badge.textContent = models.length ? `● ${models.length} model` : '○ kapalı'; badge.className = 'badge ' + (models.length ? 'ok' : 'bad'); }
  const sel = $('#olModel');
  if (sel) {
    sel.innerHTML = '';
    if (!models.length) { const o = document.createElement('option'); o.textContent = 'model yok'; o.value = ''; sel.appendChild(o); }
    models.forEach((m) => { const o = document.createElement('option'); o.value = m; o.textContent = m; sel.appendChild(o); });
    if (S.cfg.ollamaModel && models.includes(S.cfg.ollamaModel)) sel.value = S.cfg.ollamaModel;
  }
}

async function saveAI(quiet) {
  const secrets = {};
  const t = $('#ghTok') && $('#ghTok').value.trim();
  const k = $('#gKey') && $('#gKey').value.trim();
  if (t) secrets.github = t;
  if (k) secrets.gemini = k;
  S.cfg = await window.forge.setConfig({
    provider: $('#prov') ? $('#prov').value : S.cfg.provider,
    ollamaModel: $('#olModel') && $('#olModel').value ? $('#olModel').value : S.cfg.ollamaModel,
    githubModel: $('#ghModel') ? $('#ghModel').value.trim() || S.cfg.githubModel : S.cfg.githubModel,
    geminiModel: $('#gModel') ? $('#gModel').value.trim() || S.cfg.geminiModel : S.cfg.geminiModel,
    secrets
  });
  if ($('#ghTok')) $('#ghTok').value = '';
  if ($('#gKey')) $('#gKey').value = '';
  if (!quiet) aiOut('Kaydedildi ✔', 'ok');
  refreshBadge();
  return S.cfg;
}

function pageDone(body) {
  const ready = S.tools.filter((t) => t.ok).length;
  const prov = S.cfg.provider === 'auto' ? 'Otomatik (Ollama → GitHub → Gemini)' : S.cfg.provider;
  body.innerHTML = `
    <div class="hero">
      <img src="assets/logo.png" class="logo hero-logo" alt="OmniBuild">
      <h2>Her şey hazır</h2>
    </div>
    <div class="summary">
      <div>🧰 Araçlar: <b>${ready}/${S.tools.length}</b> hazır</div>
      <div>🧠 AI sağlayıcı: <b>${prov}</b></div>
      <div>🛠 Otomatik düzeltme: <b>${S.cfg.autoFix ? `açık (en fazla ${S.cfg.maxAttempts} deneme)` : 'kapalı'}</b></div>
    </div>
    <p class="muted">Sol panelden proje klasörünü seçin, hedefi belirleyin ve DERLE’ye basın.</p>`;
}

// ---------- Başlangıç ----------
(async function init() {
  S.cfg = await window.forge.getConfig();
  S.outDir = S.cfg.outDir || '';
  $('#outPath').textContent = S.outDir || 'Seçilmedi (proje içinde kalır)';
  $('#autoFix').checked = !!S.cfg.autoFix;
  $('#attempts').value = String(S.cfg.maxAttempts || 2);
  await refreshTools();
  refreshBadge();
  if (!S.cfg.wizardDone) openWizard(0);
})();

window.forge.onInstall((d) => {
  const box = $('#installLog') || $('#aiLog');
  if (box) { box.textContent += (d.text || '') + '\n'; box.scrollTop = box.scrollHeight; }
  if (d.done) refreshTools();
});
