const { contextBridge, ipcRenderer } = require('electron');
const on = (ch) => (cb) => ipcRenderer.on(ch, (_e, d) => cb(d));

contextBridge.exposeInMainWorld('forge', {
  pickFolder: () => ipcRenderer.invoke('dialog:folder'),
  openPath: (p) => ipcRenderer.invoke('shell:open', p),
  openUrl: (u) => ipcRenderer.invoke('shell:url', u),
  detect: (dir) => ipcRenderer.invoke('project:detect', dir),
  envCheck: () => ipcRenderer.invoke('env:check'),
  installTool: (id) => ipcRenderer.invoke('tool:install', id),
  ollamaStart: () => ipcRenderer.invoke('ollama:start'),
  ollamaPull: (model) => ipcRenderer.invoke('ollama:pull', model),
  ollamaModels: () => ipcRenderer.invoke('ollama:models'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  testAI: () => ipcRenderer.invoke('ai:test'),
  build: (opts) => ipcRenderer.invoke('build:start', opts),
  cancel: () => ipcRenderer.invoke('build:cancel'),
  agentRun: (payload) => ipcRenderer.invoke('agent:run', payload),
  agentStop: (runId) => ipcRenderer.invoke('agent:stop', runId),
  onLog: on('build-log'),
  onStep: on('build-step'),
  onStatus: on('build-status'),
  onDone: on('build-done'),
  onAgent: on('agent-event'),
  onInstall: on('install-log')
});
