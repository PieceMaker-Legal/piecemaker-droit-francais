(() => {
  const parameters = new URLSearchParams(location.search);
  const parentOrigin = parameters.get('pieceMakerOrigin');
  const mode = parameters.get('pieceMakerMode');
  if (!parentOrigin) return;
  document.documentElement.dataset.pieceMakerMode = mode || '';
  let lastPath = '';
  let selectedWorkflowTitle = '';
  let workflows = [];
  let quickActions = [];
  let documentsByFilename = new Map();
  let selectedDocumentIds = new Set();
  function post(type, payload) {
    parent.postMessage({ type, ...payload }, parentOrigin);
  }
  function publish() {
    const currentPath = location.pathname;
    if (lastPath === currentPath) return;
    lastPath = currentPath;
    post('piecemaker-mike-navigation', { path: currentPath });
  }
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const request = typeof args[0] === 'string' ? args[0] : args[0] instanceof Request ? args[0].url : '';
    const pathname = new URL(request, location.href).pathname;
    if (pathname === '/api/workflows' || pathname.startsWith('/api/workflows/')) {
      response.clone().json().then((items) => {
        if (Array.isArray(items)) workflows = items;
        else if (items?.id) workflows = [...workflows.filter((item) => item.id !== items.id), items];
      }).catch(() => {});
    }
    if (pathname === '/api/quick-actions' && response.ok) {
      response.clone().json().then(async (actions) => {
        if (!Array.isArray(actions)) return;
        quickActions = actions;
        let available = workflows;
        if (!available.length) {
          const workflowsResponse = await originalFetch('/api/workflows?type=assistant');
          if (workflowsResponse.ok) available = await workflowsResponse.json();
        }
        const byId = new Map(available.map((workflow) => [workflow.id, workflow]));
        post('piecemaker-mike-quick-actions', { actions: actions.map((action) => ({ ...action, workflow: byId.get(action.workflow_id) || action.workflow })).filter((action) => action.workflow) });
      }).catch(() => {});
    }
    if (/^\/api\/library\/(?:files|templates)$/.test(pathname) && response.ok) {
      response.clone().json().then((payload) => {
        const documents = Array.isArray(payload?.documents) ? payload.documents : [];
        documents.forEach((document) => documentsByFilename.set(document.filename, document));
      }).catch(() => {});
    }
    return response;
  };
  window.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    if (!button) return;
    if (button.closest('[data-slot="workflow-picker-list"]')) {
      selectedWorkflowTitle = button.textContent?.trim() || '';
      return;
    }
    if (mode === 'workflow-picker' && button.textContent?.trim() === 'Use' && selectedWorkflowTitle) {
      const workflow = workflows.find((item) => item.metadata?.title === selectedWorkflowTitle);
      if (workflow) window.setTimeout(() => post('piecemaker-mike-workflow-selected', { workflow }), 0);
    }
    if (!mode && button.textContent?.trim() === 'Use') {
      const workflowId = location.pathname.match(/^\/workflows\/(?:assistant|tabular-review)\/([^/?]+)/)?.[1];
      const workflow = workflows.find((item) => item.id === workflowId || item.metadata?.title === selectedWorkflowTitle);
      if (workflow?.metadata?.type === 'assistant') {
        event.preventDefault();
        event.stopImmediatePropagation();
        post('piecemaker-mike-workflow-selected', { workflow });
      }
    }
    if (mode === 'quick-action' && button.textContent?.trim() === 'Confirm') {
      post('piecemaker-mike-documents-selected', { documentIds: [...selectedDocumentIds] });
    }
  }, true);
  window.addEventListener('change', (event) => {
    const input = event.target instanceof HTMLInputElement ? event.target : null;
    const label = input?.getAttribute('aria-label') || '';
    if (!input || !label.startsWith('Select ')) return;
    const document = documentsByFilename.get(label.slice('Select '.length));
    if (!document?.id) return;
    if (input.checked) selectedDocumentIds.add(document.id);
    else selectedDocumentIds.delete(document.id);
  }, true);
  if (mode === 'workflow-picker') {
    const openPicker = () => {
      const button = document.querySelector('button[aria-label="Open workflows"]');
      if (button) button.click();
      else window.setTimeout(openPicker, 50);
    };
    openPicker();
  }
  if (mode === 'quick-action') {
    const actionId = parameters.get('pieceMakerQuickAction');
    const startQuickAction = () => {
      const action = quickActions.find((item) => item.id === actionId);
      const button = action && [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === (action.name?.trim() || action.workflow?.title));
      if (button) button.click();
      else window.setTimeout(startQuickAction, 50);
    };
    startQuickAction();
  }
  publish();
  const observer = new MutationObserver(publish);
  observer.observe(document.body, { subtree: true, childList: true });
  window.addEventListener('popstate', publish);
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
})();
