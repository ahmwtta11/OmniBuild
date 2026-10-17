const path = require('path');
const fs = require('fs');

const OLLAMA = 'http://127.0.0.1:11434';
const GH_URL = 'https://models.github.ai/inference/chat/completions';
const SKIP = new Set(['node_modules', '.git', 'build', 'dist', 'release', '.gradle', '.idea']);
const MAX_READ = 12000;
const runs = new Map();
let confirmFn = () => false;

function setConfirm(fn) { confirmFn = fn; }
function stop(runId) { const s = runs.get(runId); if (s) s.cancelled = true; return !!s; }
function stopAll() { for (const s of runs.values()) s.cancelled = true; }
const send = (sender, ch, d) => { if (sender && !sender.isDestroyed()) sender.send(ch, d); };

// ---------- Sağlayıcılar ----------
async function ollamaModels() {
  try {
    const r = await fetch(OLLAMA + '/api/tags', { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return null;
    return ((await r.json()).models || []).map((m) => m.name);
  } catch { return null; }
}

const providers = {
  ollama: async (cfg, system, messages) => {
    const models = await ollamaModels();
    if (!models) throw new Error('Ollama çalışmıyor. Kurulum sihirbazından başlatın.');
    if (!models.length) throw new Error('Ollama’da model yok. Örnek: ollama pull gemma3:4b');
    const model = cfg.ollamaModel && models.includes(cfg.ollamaModel) ? cfg.ollamaModel : models[0];
    const r = await fetch(OLLAMA + '/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, ...messages], stream: false, options: { temperature: 0.2 } })
    });
    if (!r.ok) throw new Error(`Ollama HTTP ${r.status}: ${await r.text()}`);
    return { text: (await r.json()).message.content, provider: `ollama:${model}` };
  },

  github: async (cfg, system, messages) => {
    if (!cfg.githubToken) throw new Error('GitHub token yok');
    const model = cfg.githubModel || 'openai/gpt-4.1';
    const r = await fetch(GH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.githubToken}`, accept: 'application/vnd.github+json' },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, ...messages], temperature: 0.2, max_tokens: 2048 })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error?.message || j.message || `GitHub Models HTTP ${r.status}`);
    return { text: j.choices[0].message.content, provider: `github:${model}` };
  },

  gemini: async (cfg, system, messages) => {
    if (!cfg.geminiKey) throw new Error('Gemini anahtarı yok');
    const model = cfg.geminiModel || 'gemini-2.5-flash';
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.geminiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048 }
      })
    });
    const j = await r.json();
    if (!r.ok) throw new Error((j.error && j.error.message) || `Gemini HTTP ${r.status}`);
    return { text: j.candidates[0].content.parts.map((p) => p.text).join(''), provider: `gemini:${model}` };
  }
};

async function complete(cfg, system, messages) {
  const order = cfg.provider === 'auto' || !cfg.provider ? ['ollama', 'github', 'gemini'] : [cfg.provider];
  let first = null;
  for (const name of order) {
    try { return await providers[name](cfg, system, messages); }
    catch (e) { first = first || e; }
  }
  throw first || new Error('Sağlayıcı bulunamadı');
}

async function testProvider(cfg) {
  try {
    const r = await complete(cfg, 'Sen bir test asistanısın.', [{ role: 'user', content: 'Sadece OK yaz.' }]);
    return { ok: true, provider: r.provider, text: r.text.slice(0, 100) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ---------- Güvenli araçlar ----------
function resolveSafe(root, rel = '.') {
  const base = path.resolve(root);
  const p = path.resolve(base, String(rel));
  if (p !== base && !p.startsWith(base + path.sep)) throw new Error('Proje dışına erişim engellendi: ' + rel);
  return p;
}

function walkFiles(root, limit = 3000) {
  const out = [];
  const walk = (d, depth) => {
    if (depth > 10 || out.length >= limit) return;
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (SKIP.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1); else out.push(p);
    }
  };
  walk(root, 0);
  return out;
}

function makeTools(root, autoApply) {
  const base = path.resolve(root);
  const rel = (p) => path.relative(base, p) || '.';
  return {
    list_dir: async ({ path: p }) => {
      const d = resolveSafe(root, p);
      return fs.readdirSync(d, { withFileTypes: true })
        .filter((e) => !SKIP.has(e.name)).slice(0, 300)
        .map((e) => (e.isDirectory() ? '[dir] ' : '      ') + e.name).join('\n') || '(boş)';
    },
    read_file: async ({ path: p }) => {
      const f = resolveSafe(root, p);
      if (fs.statSync(f).size > 1024 * 1024) throw new Error('Dosya çok büyük (>1MB)');
      const txt = fs.readFileSync(f, 'utf8');
      return txt.length > MAX_READ ? txt.slice(0, MAX_READ) + `\n...[kırpıldı, toplam ${txt.length} karakter]` : txt;
    },
    search: async ({ query }) => {
      const q = String(query || '').toLowerCase();
      if (!q) throw new Error('query boş');
      const hits = [];
      for (const f of walkFiles(base)) {
        if (hits.length >= 60) break;
        let st;
        try { st = fs.statSync(f); } catch { continue; }
        if (st.size > 300 * 1024 || !/\.(js|ts|jsx|tsx|kt|java|xml|gradle|kts|json|html|css|md|properties|txt|ya?ml)$/i.test(f)) continue;
        fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
          if (hits.length < 60 && l.toLowerCase().includes(q)) hits.push(`${rel(f)}:${i + 1}: ${l.trim().slice(0, 160)}`);
        });
      }
      return hits.join('\n') || 'Sonuç yok';
    },
    write_file: async ({ path: p, content }) => {
      const f = resolveSafe(root, p);
      if (typeof content !== 'string') throw new Error('content metin olmalı');
      if (!autoApply && !confirmFn(`Agent şu dosyayı yazmak istiyor:\n${rel(f)}`, content.slice(0, 600))) {
        return 'Kullanıcı yazma işlemini reddetti.';
      }
      if (fs.existsSync(f)) fs.copyFileSync(f, f + '.bak');
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, content, 'utf8');
      return `Yazıldı: ${rel(f)}${autoApply ? ' (otomatik düzeltme)' : ''}. Eski sürüm .bak olarak saklandı.`;
    }
  };
}

// ---------- Ajan döngüsü ----------
const SYSTEM = `Sen OmniBuild içinde çalışan bir derleme ve hata ayıklama ajanısın.
Android (Gradle, Capacitor, Cordova) ve Electron (electron-builder, Windows NSIS) projelerinde derleme hatalarını çözersin.
Her yanıtta YALNIZCA tek bir JSON nesnesi döndür, başka metin yazma.
Araç çağırmak için: {"tool":"ad","args":{...}}
Bitirmek için: {"final":"Türkçe kısa özet: neyi bulduğun ve neyi değiştirdiğin"}
Araçlar:
- list_dir {"path": "klasör"} klasör içeriğini listeler
- read_file {"path": "dosya"} dosyayı okur
- search {"query": "metin"} proje içinde metin arar
- write_file {"path": "dosya", "content": "dosyanın tam yeni içeriği"} dosyayı yazar
Kurallar: önce log'daki ilk gerçek hata satırını bul, ilgili dosyayı oku, sonra minimum değişiklikle düzelt. Emin değilsen dosya yazma, final ile durumu açıkla. Dosyayı yazarken içeriğin tamamını ver.`;

function parseAction(text) {
  const cleaned = text.replace(/```(?:json)?/gi, '');
  const s = cleaned.indexOf('{');
  const e = cleaned.lastIndexOf('}');
  if (s < 0 || e < s) throw new Error('JSON bulunamadı');
  return JSON.parse(cleaned.slice(s, e + 1));
}

async function runAgent(sender, p) {
  const { runId, task, projectDir, logContext, cfg, autoApply } = p;
  const st = { cancelled: false };
  runs.set(runId, st);
  const emit = (d) => send(sender, 'agent-event', { runId, ...d });
  const tools = makeTools(projectDir, !!autoApply);
  const convo = [{
    role: 'user',
    content: `GÖREV: ${task}\n\nPROJE KLASÖRÜ: ${projectDir}\n\nLOG (son satırlar):\n${logContext || '(yok)'}`
  }];
  let provider = '';
  let writes = 0;

  try {
    for (let step = 1; step <= 12; step++) {
      if (st.cancelled) throw new Error('Kullanıcı durdurdu');
      emit({ type: 'thinking', step });
      const res = await complete(cfg, SYSTEM, convo);
      provider = res.provider;
      convo.push({ role: 'assistant', content: res.text });

      let action;
      try { action = parseAction(res.text); }
      catch {
        convo.push({ role: 'user', content: 'Geçersiz format. Yalnızca tek bir JSON nesnesi döndür.' });
        continue;
      }
      if (action.final) {
        emit({ type: 'final', text: String(action.final), provider, writes });
        return { ok: true, final: String(action.final), writes, provider };
      }
      if (!action.tool || !tools[action.tool]) {
        convo.push({ role: 'user', content: `Bilinmeyen araç: ${action.tool}. Sadece listelenen araçları kullan.` });
        continue;
      }
      emit({ type: 'tool', tool: action.tool, args: action.args || {} });
      let result;
      try { result = await tools[action.tool](action.args || {}); }
      catch (err) { result = 'HATA: ' + err.message; }
      if (action.tool === 'write_file' && String(result).startsWith('Yazıldı')) writes++;
      emit({ type: 'result', tool: action.tool, preview: String(result).slice(0, 400) });
      convo.push({ role: 'user', content: `Araç sonucu (${action.tool}):\n${String(result).slice(0, 8000)}` });
    }
    emit({ type: 'final', text: 'Adım limitine ulaşıldı. Mevcut bulgular yukarıda.', provider, writes });
    return { ok: true, final: 'limit', writes, provider };
  } catch (err) {
    emit({ type: 'error', text: err.message });
    return { ok: false, error: err.message, writes };
  } finally {
    runs.delete(runId);
  }
}

module.exports = { ollamaModels, runAgent, stop, stopAll, setConfirm, testProvider };
