const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};
const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  appInfo: call('app:info'),
  getSettings: call('settings:get'),
  setSettings: call('settings:set'),
  addUrls: call('jobs:add'),
  listJobs: call('jobs:list'),
  retryJob: call('jobs:retry'),
  retryFailed: call('jobs:retryFailed'),
  removeJob: call('jobs:remove'),
  clearFinished: call('jobs:clearFinished'),
  pause: call('queue:pause'),
  resume: call('queue:resume'),
  stop: call('queue:stop'),
  openLogin: call('login:open'),
  loginStatus: call('login:status'),
  clearSession: call('session:clear'),
  showBrowser: call('browser:show'),
  getProduct: call('product:get'),
  openPath: call('path:open'),
  revealPath: call('path:reveal'),
  openExternal: call('external:open'),
  chooseFolder: call('folder:choose'),
  onJobAdded: on('jobs:added'),
  onJobUpdate: on('job:update'),
  onQueueState: on('queue:state'),
  onQueueNext: on('queue:next'),
  onQueueFinished: on('queue:finished'),
  onLog: on('log'),
});
