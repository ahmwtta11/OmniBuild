const path = require('path');
const fs = require('fs');

const WIN = process.platform === 'win32';
const NPM = WIN ? 'npm.cmd' : 'npm';
const NPX = WIN ? 'npx.cmd' : 'npx';
const SKIP = new Set(['node_modules', '.git', '.gradle', '.idea']);

function readPkg(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); }
  catch { return null; }
}

function detect(dir) {
  if (!dir || !fs.existsSync(dir)) return { ok: false, error: 'Klasör bulunamadı' };
  const has = (f) => fs.existsSync(path.join(dir, f));
  const pkg = readPkg(dir);
  if (has('package.json') && !pkg) return { ok: false, error: 'package.json okunamadı (bozuk JSON)' };
  const deps = { ...((pkg && pkg.dependencies) || {}), ...((pkg && pkg.devDependencies) || {}) };
  let type = 'unknown';
  if (has('capacitor.config.json') || has('capacitor.config.ts')) type = 'capacitor';
  else if (has('config.xml') && pkg) type = 'cordova';
  else if (pkg && (deps.electron || (pkg.main && pkg.build))) type = 'electron';
  else if (['gradlew', 'gradlew.bat', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'].some(has)) type = 'gradle';
  else if (pkg) type = 'node';
  return {
    ok: true, type, dir,
    name: ((pkg && pkg.name) || path.basename(dir)).replace(/[^\w.-]/g, '_'),
    scripts: Object.keys((pkg && pkg.scripts) || {}),
    hasNodeModules: has('node_modules')
  };
}

function gradleStep(dir, sub, task) {
  const base = path.join(dir, sub);
  const wrapper = path.join(base, WIN ? 'gradlew.bat' : 'gradlew');
  if (fs.existsSync(wrapper) && !WIN) { try { fs.chmodSync(wrapper, 0o755); } catch {} }
  return {
    label: `Gradle ${task}`,
    cmd: fs.existsSync(wrapper) ? wrapper : (WIN ? 'gradle.bat' : 'gradle'),
    args: [task, '--stacktrace'],
    cwd: base
  };
}

// target: 'apk-debug' | 'apk-release' | 'exe'
function planSteps(info, target, dir) {
  const steps = [];
  if (info.type !== 'gradle' && !info.hasNodeModules) {
    steps.push({ label: 'npm install', cmd: NPM, args: ['install'], cwd: dir });
  }

  if (target === 'exe') {
    if (info.type !== 'electron') {
      throw new Error('Windows (.exe) hedefi için proje Electron olmalı (package.json içinde electron bağımlılığı).');
    }
    steps.push({ label: 'Electron Windows build (electron-builder)', cmd: NPX, args: ['electron-builder', '--win', '--publish', 'never'], cwd: dir });
    return steps;
  }

  const release = target === 'apk-release';
  const task = release ? 'assembleRelease' : 'assembleDebug';
  if (info.type === 'capacitor') {
    if (info.scripts.includes('build')) steps.push({ label: 'Web build (npm run build)', cmd: NPM, args: ['run', 'build'], cwd: dir });
    steps.push({ label: 'Capacitor sync (android)', cmd: NPX, args: ['cap', 'sync', 'android'], cwd: dir });
    steps.push(gradleStep(dir, 'android', task));
  } else if (info.type === 'cordova') {
    steps.push({ label: 'Cordova Android build', cmd: NPX, args: ['cordova', 'build', 'android', release ? '--release' : '--debug'], cwd: dir });
  } else if (info.type === 'gradle') {
    steps.push(gradleStep(dir, '', task));
  } else {
    throw new Error('APK için Capacitor, Cordova veya native Gradle projesi gerekir.');
  }
  return steps;
}

function findArtifact(root, since, exts) {
  const found = [];
  const walk = (d, depth) => {
    if (depth > 12) return;
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (SKIP.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p, depth + 1); continue; }
      if (!exts.some((x) => e.name.toLowerCase().endsWith(x))) continue;
      const t = fs.statSync(p).mtimeMs;
      found.push({ p, t, fresh: t >= since - 1000, score: /setup|installer/i.test(e.name) ? 2 : 0 });
    }
  };
  walk(root, 0);
  const pick = (list) => list.sort((a, b) => b.score - a.score || b.t - a.t)[0];
  const fresh = found.filter((f) => f.fresh);
  const best = pick(fresh) || pick(found);
  return best ? best.p : null;
}

module.exports = { detect, planSteps, findArtifact };
