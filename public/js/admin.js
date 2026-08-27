(function () {
  const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('fr-FR') : '—';

  function showFeedback(el, message, ok) {
    el.textContent = message;
    el.className = 'admin-feedback ' + (ok ? 'ok' : 'error');
    el.style.display = 'block';
  }

  async function fetchJson(url, opts) {
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Erreur.');
    return data;
  }

  function renderWorkspaces(workspaces) {
    const list = document.getElementById('adminWorkspaceList');
    if (!workspaces.length) { list.innerHTML = '<p class="admin-empty">Aucun fonds créé pour l\'instant.</p>'; return; }
    list.innerHTML = workspaces.map(w => `
      <div class="admin-row">
        <div class="admin-row-main">
          <div class="admin-row-title">${escapeHtml(w.name)}</div>
          <div class="admin-row-sub">${w.memberCount} membre${w.memberCount === 1 ? '' : 's'} · créé le ${fmtDate(w.createdAt)}</div>
        </div>
      </div>`).join('');
  }

  function workspaceOptions(workspaces, selectedId) {
    return '<option value="">Non assigné</option>' + workspaces.map(w =>
      `<option value="${w.id}" ${w.id === selectedId ? 'selected' : ''}>${escapeHtml(w.name)}</option>`
    ).join('');
  }

  function renderUsers(users, workspaces) {
    const list = document.getElementById('adminUserList');
    const feedback = document.getElementById('adminUserFeedback');
    if (!users.length) { list.innerHTML = '<p class="admin-empty">Aucun compte.</p>'; return; }
    list.innerHTML = users.map(u => `
      <div class="admin-row">
        <div class="admin-row-main">
          <div class="admin-row-title">${escapeHtml(u.name || u.email)}</div>
          <div class="admin-row-sub ${u.workspaceId ? '' : 'admin-row-unassigned'}">
            ${escapeHtml(u.email)} · ${u.workspaceName ? escapeHtml(u.workspaceName) : 'non assigné'}
          </div>
        </div>
        <select data-user-id="${u.id}">${workspaceOptions(workspaces, u.workspaceId)}</select>
        <button type="button" class="btn btn-ghost" data-reset-id="${u.id}" data-reset-email="${escapeHtml(u.email)}">Réinitialiser le mot de passe</button>
      </div>`).join('');
    // Reinitialisation d'un mot de passe oublie, sans passer par un shell.
    list.querySelectorAll('[data-reset-id]').forEach(btn => btn.addEventListener('click', async () => {
      const pwd = prompt(`Nouveau mot de passe pour ${btn.dataset.resetEmail} (8 caractères minimum) :`);
      if (pwd === null) return;
      if (pwd.length < 8) { showFeedback(feedback, 'Le mot de passe doit faire au moins 8 caractères.', false); return; }
      btn.disabled = true;
      try {
        await fetchJson(`/api/admin/users/${btn.dataset.resetId}/password`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pwd }),
        });
        showFeedback(feedback, `Mot de passe réinitialisé pour ${btn.dataset.resetEmail}.`, true);
      } catch (err) {
        showFeedback(feedback, err.message, false);
      }
      btn.disabled = false;
    }));
    list.querySelectorAll('select[data-user-id]').forEach(sel => {
      sel.addEventListener('change', async () => {
        const workspaceId = sel.value;
        if (!workspaceId) { sel.value = sel.dataset.previousValue || ''; return; }
        sel.disabled = true;
        try {
          await fetchJson(`/api/admin/users/${sel.dataset.userId}/workspace`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspaceId }),
          });
          showFeedback(feedback, 'Compte rattaché.', true);
          await loadAll();
        } catch (err) {
          showFeedback(feedback, err.message, false);
          sel.disabled = false;
        }
      });
      sel.dataset.previousValue = sel.value;
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function loadAll() {
    const [workspaces, users] = await Promise.all([
      fetchJson('/api/admin/workspaces'),
      fetchJson('/api/admin/users'),
    ]);
    renderWorkspaces(workspaces);
    renderUsers(users, workspaces);
  }

  document.getElementById('adminCreateWorkspaceBtn').addEventListener('click', async () => {
    const input = document.getElementById('adminNewWorkspaceName');
    const feedback = document.getElementById('adminWorkspaceFeedback');
    const name = input.value.trim();
    if (!name) return;
    try {
      await fetchJson('/api/admin/workspaces', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      input.value = '';
      showFeedback(feedback, 'Fonds créé.', true);
      await loadAll();
    } catch (err) {
      showFeedback(feedback, err.message, false);
    }
  });

  document.getElementById('adminLogoutBtn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login.html';
  });

  (async () => {
    const me = await fetch('/api/auth/me').then(r => r.ok ? r.json() : null).catch(() => null);
    if (!me) { location.href = '/login.html'; return; }
    if (!me.isSuperAdmin) { document.getElementById('adminDenied').style.display = 'block'; return; }
    document.getElementById('adminBody').style.display = 'block';
    try {
      await loadAll();
    } catch (err) {
      document.getElementById('adminDenied').textContent = err.message;
      document.getElementById('adminDenied').style.display = 'block';
    }
  })();
})();
