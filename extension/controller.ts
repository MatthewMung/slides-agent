import { AgentError, actionSchema, assertPoint, keyDefinition, matchesDownload, modifierMask, presentationId, VERSION, type Action, type Observation, type Params, type Method } from '../src/protocol.js';

type Target = chrome.debugger.DebuggerSession;
type Viewport = { width: number; height: number; dpr: number; href: string; inputRevision: number };
interface Session {
  id: string; tabId: number; documentId: string; since: number;
  targets: Map<string, Target>;
  observation?: Observation;
  revision?: number;
  observedAt?: number;
  chooser?: { id: string; target: Target; nodeId: number; multiple: boolean };
}
const binding = '__slidesAgentInput_v1';
const installInputObserver = `(() => {
  if (globalThis.__slidesAgentInputInstalled) return;
  globalThis.__slidesAgentInputInstalled = true;
  globalThis.__slidesAgentInputRevision = 0;
  for (const event of ['pointerdown','keydown','wheel','input']) {
    addEventListener(event, () => {
      globalThis.__slidesAgentInputRevision++;
      try { globalThis.${binding}('input'); } catch {}
    }, true);
  }
})()`;
const viewportExpression = `({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,href:location.href,inputRevision:globalThis.__slidesAgentInputRevision ?? 0})`;

export class SlidesController {
  private session?: Session;
  constructor(private notifyStop: (reason: string) => void = () => {}) {
    chrome.debugger.onEvent.addListener((source, method, params) => { void this.onEvent(source, method, params as any).catch(() => {}); });
    chrome.debugger.onDetach.addListener(source => { if (this.session?.tabId === source.tabId) void this.stop('Debugger detached'); });
    chrome.tabs.onRemoved.addListener(tabId => { if (this.session?.tabId === tabId) void this.stop('Controlled tab closed'); });
    chrome.tabs.onActivated.addListener(() => { if (this.session) this.session.observation = undefined; });
    chrome.tabs.onUpdated.addListener((tabId, change) => {
      const session = this.session;
      if (!session || tabId !== session.tabId) return;
      if (change.url || change.status === 'loading') { session.observation = undefined; session.chooser = undefined; }
      if (change.url && presentationId(change.url) !== session.documentId) void this.stop('Tab left the selected presentation');
    });
  }
  get status() { return { version: VERSION, session: this.session ? { sessionId: this.session.id, tabId: this.session.tabId } : null }; }
  private current(id: string): Session {
    if (!this.session || this.session.id !== id) throw new AgentError('NO_SESSION', 'Start a new session.');
    return this.session;
  }
  private target(session: Session): Target { return { tabId: session.tabId }; }
  private async command<T = any>(session: Session, method: string, params: Record<string, unknown> = {}, target = this.target(session)): Promise<T> {
    if (this.session !== session) throw new AgentError('SESSION_STOPPED', 'Control was stopped.');
    const result = await chrome.debugger.sendCommand(target, method, params);
    if (this.session !== session) throw new AgentError('SESSION_STOPPED', 'Control was stopped.');
    return result as T;
  }
  private async configureTarget(session: Session, target: Target): Promise<void> {
    await this.command(session, 'Page.enable', {}, target);
    await this.command(session, 'Runtime.enable', {}, target);
    await this.command(session, 'Accessibility.enable', {}, target);
    await this.command(session, 'Page.setInterceptFileChooserDialog', { enabled: true }, target);
    await this.command(session, 'Runtime.addBinding', { name: binding }, target);
    await this.command(session, 'Page.addScriptToEvaluateOnNewDocument', { source: installInputObserver }, target);
    await this.command(session, 'Runtime.evaluate', { expression: installInputObserver }, target);
    await this.command(session, 'Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true, filter: [{ type: 'iframe', exclude: false }] }, target);
  }
  private async onEvent(source: Target, method: string, params: any): Promise<void> {
    const session = this.session;
    if (!session || source.tabId !== session.tabId) return;
    if (method === 'Target.attachedToTarget' && params.targetInfo?.type === 'iframe') {
      const target = { tabId: session.tabId, sessionId: params.sessionId };
      session.targets.set(params.sessionId, target);
      await this.configureTarget(session, target);
    }
    if (method === 'Target.detachedFromTarget') {
      session.targets.delete(params.sessionId);
      if (session.chooser?.target.sessionId === params.sessionId) session.chooser = undefined;
    }
    if (method === 'Runtime.bindingCalled' && params.name === binding) { session.observation = undefined; session.chooser = undefined; }
    if (method === 'Page.frameNavigated') {
      session.observation = undefined;
      if (session.chooser?.target.sessionId === source.sessionId) session.chooser = undefined;
      if (!source.sessionId && !params.frame.parentId && presentationId(params.frame.url) !== session.documentId) await this.stop('Navigation left selected presentation');
    }
    if (method === 'Page.fileChooserOpened' && typeof params.backendNodeId === 'number') {
      session.chooser = { id: crypto.randomUUID(), target: source, nodeId: params.backendNodeId, multiple: params.mode === 'selectMultiple' };
    }
  }
  async stop(reason = 'Stopped', notify = true): Promise<void> {
    const session = this.session;
    this.session = undefined;
    if (session) {
      // Cancel held inputs before detaching. This must bypass command's cancelled-session check.
      await chrome.debugger.sendCommand({ tabId: session.tabId }, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: 0, y: 0, button: 'left', buttons: 0 }).catch(() => {});
      for (const key of ['Control', 'Shift', 'Alt', 'Meta']) {
        await chrome.debugger.sendCommand({ tabId: session.tabId }, 'Input.dispatchKeyEvent', { type: 'keyUp', key }).catch(() => {});
      }
      await chrome.debugger.detach({ tabId: session.tabId }).catch(() => {});
      if (notify) this.notifyStop(reason);
    }
  }
  async listTabs() {
    const tabs = await chrome.tabs.query({});
    return { tabs: tabs.filter(tab => tab.url && presentationId(tab.url)).map(tab => ({ tabId: tab.id, title: tab.title, url: tab.url, active: tab.active })) };
  }
  async start(tabId: number): Promise<Observation> {
    if (this.session) throw new AgentError('SESSION_IN_USE', 'End the existing session first.');
    const tab = await chrome.tabs.get(tabId);
    const documentId = presentationId(tab.url ?? '');
    if (!documentId) throw new AgentError('UNSUPPORTED_TAB', 'Choose a https://docs.google.com/presentation/d/... tab.');
    const session: Session = { id: crypto.randomUUID(), tabId, documentId, since: Date.now(), targets: new Map() };
    this.session = session;
    try {
      await chrome.debugger.attach({ tabId }, '1.3');
      await this.configureTarget(session, this.target(session));
      return await this.observe(session.id);
    } catch (error) { await this.stop('Session start failed', false); throw error; }
  }
  private async viewport(session: Session): Promise<Viewport> {
    const result = await this.command(session, 'Runtime.evaluate', { expression: viewportExpression, returnByValue: true });
    const view = result?.result?.value as Viewport | undefined;
    if (!view || !view.width || !view.height || presentationId(view.href) !== session.documentId) throw new AgentError('UNSUPPORTED_TAB', 'Selected presentation is no longer available.');
    return view;
  }
  async observe(sessionId: string): Promise<Observation> {
    const session = this.current(sessionId);
    const tab = await chrome.tabs.get(session.tabId);
    if (presentationId(tab.url ?? '') !== session.documentId) { await this.stop('Presentation changed'); throw new AgentError('NO_SESSION', 'Presentation changed.'); }
    await this.command(session, 'Page.bringToFront');
    const view = await this.viewport(session);
    const warnings: string[] = [];
    const elements: Observation['elements'] = [];
    for (const target of [this.target(session), ...session.targets.values()]) {
      try {
        const tree = await this.command(session, 'Accessibility.getFullAXTree', {}, target);
        for (const node of tree.nodes ?? []) {
          if (node.ignored || (!node.name?.value && !node.value?.value)) continue;
          const element: Observation['elements'][number] = { role: String(node.role?.value ?? ''), name: String(node.name?.value ?? '').slice(0, 1000) };
          if (node.value?.value !== undefined) element.value = String(node.value.value).slice(0, 1000);
          // Child-frame AX names remain useful; only root-frame bounds use viewport coordinates.
          if (!target.sessionId && node.backendDOMNodeId && elements.length < 60 && /button|menuitem|textbox|checkbox|combobox|slider|option/i.test(element.role)) {
            try {
              const model = await this.command(session, 'DOM.getBoxModel', { backendNodeId: node.backendDOMNodeId }, target);
              const quad: number[] = model.model.border;
              const xs = [quad[0]!, quad[2]!, quad[4]!, quad[6]!];
              const ys = [quad[1]!, quad[3]!, quad[5]!, quad[7]!];
              element.bounds = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
            } catch { /* Canvas and detached elements may have no DOM box. */ }
          }
          elements.push(element);
          if (elements.length >= 300) break;
        }
      } catch { warnings.push('Some accessibility information is unavailable; use the screenshot.'); }
      if (elements.length >= 300) break;
    }
    const capture = await this.command(session, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const finalView = await this.viewport(session);
    if (view.width !== finalView.width || view.height !== finalView.height || view.dpr !== finalView.dpr || view.href !== finalView.href || view.inputRevision !== finalView.inputRevision) {
      session.observation = undefined;
      throw new AgentError('VIEW_CHANGED', 'Viewport or input changed during capture; observe again.');
    }
    const header = Uint8Array.from(atob(capture.data.slice(0, 44)), char => char.charCodeAt(0));
    const imageView = new DataView(header.buffer);
    const width = imageView.getUint32(16), height = imageView.getUint32(20);
    const observation: Observation = {
      sessionId, snapshotId: crypto.randomUUID(), tabId: session.tabId, url: view.href,
      viewport: { width: view.width, height: view.height, deviceScaleFactor: view.dpr },
      screenshot: { data: capture.data, mimeType: 'image/png', width, height, cssToImageX: width / view.width, cssToImageY: height / view.height },
      elements, warnings,
      ...(session.chooser ? { pendingUpload: { chooserId: session.chooser.id, multiple: session.chooser.multiple } } : {}),
    };
    session.observation = observation; session.revision = view.inputRevision; session.observedAt = Date.now();
    return observation;
  }
  private async withModifiers(session: Session, modifiers: string[] | undefined, action: () => Promise<void>): Promise<void> {
    const pressed: string[] = [];
    const keys: Record<string, number> = { Alt: 18, Control: 17, Meta: 91, Shift: 16 };
    try {
      for (const key of [...new Set(modifiers)]) {
        pressed.push(key);
        await this.command(session, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: `${key}Left`, windowsVirtualKeyCode: keys[key], modifiers: modifierMask(pressed) });
      }
      await action();
    } finally {
      for (const key of pressed.reverse()) {
        await chrome.debugger.sendCommand(this.target(session), 'Input.dispatchKeyEvent', { type: 'keyUp', key, code: `${key}Left`, windowsVirtualKeyCode: keys[key], modifiers: 0 }).catch(() => {});
      }
    }
  }
  async act(sessionId: string, snapshotId: string, input: Action): Promise<Observation & { status: string }> {
    const session = this.current(sessionId);
    const action = actionSchema.parse(input);
    const observation = session.observation;
    if (!observation || observation.snapshotId !== snapshotId || Date.now() - (session.observedAt ?? 0) > 60000) throw new AgentError('STALE_SNAPSHOT', 'Observe again and use the latest snapshotId.');
    const activeTabs = await chrome.tabs.query({ active: true, windowId: (await chrome.tabs.get(session.tabId)).windowId });
    const view = await this.viewport(session);
    if (activeTabs[0]?.id !== session.tabId || view.href !== observation.url || view.width !== observation.viewport.width || view.height !== observation.viewport.height || view.dpr !== observation.viewport.deviceScaleFactor || view.inputRevision !== session.revision) {
      session.observation = undefined;
      throw new AgentError('STALE_SNAPSHOT', 'Active tab, viewport or user input changed; observe again.');
    }
    const checkPoint = (point: { x: number; y: number }) => assertPoint(point.x, point.y, view.width, view.height);
    if ('x' in action) checkPoint(action);
    if (action.type === 'drag') { checkPoint(action.from); checkPoint(action.to); }
    if (action.type === 'press_key') keyDefinition(action.key);
    session.observation = undefined;
    session.chooser = undefined;
    const modifiers = 'modifiers' in action ? action.modifiers : undefined;
    const mask = modifierMask(modifiers);
    let sent = false;
    try {
      await this.withModifiers(session, modifiers, async () => {
        sent = true;
        if (action.type === 'type_text') { await this.command(session, 'Input.insertText', { text: action.text }); return; }
        if (action.type === 'press_key') {
          const definition = keyDefinition(action.key);
          if (modifiers?.includes('Shift') && /^[a-z]$/.test(definition.key)) definition.key = definition.key.toUpperCase();
          const text = !modifiers?.some(key => ['Alt', 'Control', 'Meta'].includes(key)) ? (definition.key.length === 1 ? definition.key : definition.key === 'Enter' ? '\r' : undefined) : undefined;
          try { await this.command(session, 'Input.dispatchKeyEvent', { type: 'keyDown', ...definition, modifiers: mask, ...(text ? { text, unmodifiedText: text } : {}) }); }
          finally { await chrome.debugger.sendCommand(this.target(session), 'Input.dispatchKeyEvent', { type: 'keyUp', ...definition, modifiers: mask }).catch(() => {}); }
          return;
        }
        if (action.type === 'scroll') { await this.command(session, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x: action.x, y: action.y, deltaX: action.deltaX, deltaY: action.deltaY, modifiers: mask }); return; }
        if (action.type === 'drag') {
          try {
            await this.command(session, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...action.from, button: 'left', buttons: 1, clickCount: 1, modifiers: mask });
            for (let step = 1; step <= 12; step++) {
              await this.command(session, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: action.from.x + (action.to.x - action.from.x) * step / 12, y: action.from.y + (action.to.y - action.from.y) * step / 12, button: 'left', buttons: 1, modifiers: mask });
              await new Promise(resolve => setTimeout(resolve, 16));
            }
          } finally { await chrome.debugger.sendCommand(this.target(session), 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...action.to, button: 'left', buttons: 0, clickCount: 1, modifiers: mask }).catch(() => {}); }
          return;
        }
        const button = action.type === 'right_click' ? 'right' : 'left';
        for (let count = 1; count <= (action.type === 'double_click' ? 2 : 1); count++) {
          try { await this.command(session, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: action.x, y: action.y, button, buttons: button === 'left' ? 1 : 2, clickCount: count, modifiers: mask }); }
          finally { await chrome.debugger.sendCommand(this.target(session), 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: action.x, y: action.y, button, buttons: 0, clickCount: count, modifiers: mask }).catch(() => {}); }
        }
      });
      // Give event-driven UI and intercepted file choosers a bounded opportunity to update.
      await new Promise(resolve => setTimeout(resolve, 150));
      return { status: 'action_sent_verify_result', ...await this.observe(sessionId) };
    } catch (error) {
      if (sent) throw new AgentError('ACTION_RESULT_UNKNOWN', 'Input may have been applied. Observe before deciding what to do; do not automatically replay.');
      throw error;
    }
  }
  async upload(sessionId: string, chooserId: string, path: string): Promise<Observation & { status: string }> {
    const session = this.current(sessionId);
    const chooser = session.chooser;
    if (!chooser || chooser.id !== chooserId) throw new AgentError('NO_FILE_CHOOSER', 'Click Upload from computer, then observe the pendingUpload chooserId.');
    session.observation = undefined; session.chooser = undefined;
    try {
      await this.command(session, 'DOM.setFileInputFiles', { files: [path], backendNodeId: chooser.nodeId }, chooser.target);
      await new Promise(resolve => setTimeout(resolve, 150));
      return { status: 'file_sent_verify_result', ...await this.observe(sessionId) };
    } catch { throw new AgentError('UPLOAD_RESULT_UNKNOWN', 'Upload may have started. Observe and verify before retrying.'); }
  }
  async downloads(sessionId: string) {
    const session = this.current(sessionId);
    const items = await chrome.downloads.search({ startedAfter: new Date(session.since).toISOString() });
    const matched = items.filter(item => matchesDownload(item, session.documentId, session.since));
    return {
      downloads: matched.map(item => ({ id: item.id, filename: item.filename, state: item.state, bytesReceived: item.bytesReceived, totalBytes: item.totalBytes, danger: item.danger, error: item.error })),
      note: matched.length ? 'Only complete and locally verified files confirm export. In-progress or dangerous downloads may need user action.' : 'No download can be attributed to this presentation. Check export progress or a native Save dialog; no success is implied.',
    };
  }
  async dispatch(method: Method, params: Params): Promise<any> {
    switch (method) {
      case 'get_status': return this.status;
      case 'list_tabs': return this.listTabs();
      case 'start_session': return this.start(params.tabId as number);
      case 'end_session': this.current(params.sessionId as string); await this.stop('Session ended', false); return { ended: true };
      case 'observe': return this.observe(params.sessionId as string);
      case 'act': return this.act(params.sessionId as string, params.snapshotId as string, params.action as Action);
      case 'upload_file': return this.upload(params.sessionId as string, params.chooserId as string, params.path as string);
      case 'get_downloads': return this.downloads(params.sessionId as string);
    }
  }
}
