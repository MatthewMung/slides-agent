const status = document.querySelector<HTMLElement>('#status')!;
const port = document.querySelector<HTMLInputElement>('#port')!;
const token = document.querySelector<HTMLInputElement>('#token')!;
async function refresh() {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'status' });
    status.textContent = `${result.state}${result.session ? ' · Controlling a presentation／正在操作簡報' : ''}`;
  } catch { status.textContent = 'Extension unavailable; reload it／請重新載入擴充功能'; }
}
document.querySelector<HTMLFormElement>('#pair')!.addEventListener('submit', event => {
  event.preventDefault();
  void (async () => {
    await chrome.storage.local.set({ port: Number(port.value), token: token.value.trim(), enabled: true });
    await chrome.runtime.sendMessage({ type: 'connect' });
    await refresh();
  })();
});
document.querySelector('#stop')!.addEventListener('click', () => { void chrome.runtime.sendMessage({ type: 'stop' }).then(refresh); });
document.querySelector('#disconnect')!.addEventListener('click', () => { void chrome.runtime.sendMessage({ type: 'disconnect' }).then(refresh); });
void chrome.storage.local.get(['port', 'token']).then(stored => { port.value = String(stored.port ?? 32145); token.value = typeof stored.token === 'string' ? stored.token : ''; });
void refresh();
setInterval(() => void refresh(), 1000);
