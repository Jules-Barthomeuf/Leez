(function () {
  const token = new URLSearchParams(location.search).get('token');
  const sub = document.getElementById('inviteSub');
  const form = document.getElementById('inviteForm');
  const fatal = document.getElementById('inviteFatal');
  const toLogin = document.getElementById('inviteToLogin');
  const errorEl = document.getElementById('inviteError');
  const submitBtn = document.getElementById('inviteSubmit');

  function showFatal(msg) {
    sub.style.display = 'none';
    form.style.display = 'none';
    fatal.textContent = msg;
    fatal.style.display = 'block';
    toLogin.style.display = 'block';
  }

  document.querySelectorAll('.password-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.togglePassword);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.querySelector('.icon-eye').style.display = show ? 'none' : '';
      btn.querySelector('.icon-eye-off').style.display = show ? '' : 'none';
    });
  });

  if (!token) { showFatal('Lien incomplet — le jeton d’invitation est absent.'); return; }

  // Verifie le lien AVANT d'afficher le formulaire : un lien expire ou deja
  // utilise ne doit jamais laisser croire qu'on peut definir un mot de passe.
  fetch(`/api/auth/invite/${encodeURIComponent(token)}`)
    .then(async r => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Ce lien d’invitation est invalide ou a expiré.');
      document.getElementById('inviteEmail').value = d.email;
      sub.textContent = 'Choisissez un mot de passe pour accéder à votre espace de travail.';
      form.style.display = '';
      document.getElementById('invitePassword').focus();
    })
    .catch(err => showFatal(err.message));

  form.addEventListener('submit', async e => {
    e.preventDefault();
    errorEl.style.display = 'none';
    const p1 = document.getElementById('invitePassword').value;
    const p2 = document.getElementById('invitePassword2').value;
    if (p1.length < 8) { errorEl.textContent = 'Le mot de passe doit faire au moins 8 caractères.'; errorEl.style.display = 'block'; return; }
    if (p1 !== p2) { errorEl.textContent = 'Les deux mots de passe ne correspondent pas.'; errorEl.style.display = 'block'; return; }
    submitBtn.disabled = true; submitBtn.textContent = 'Activation…';
    try {
      const r = await fetch(`/api/auth/invite/${encodeURIComponent(token)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: p1 }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Activation impossible.');
      // La session est ouverte cote serveur : entree directe dans l'app.
      location.href = '/index.html';
    } catch (err) {
      errorEl.textContent = err.message; errorEl.style.display = 'block';
      submitBtn.disabled = false; submitBtn.textContent = 'Activer mon compte';
    }
  });
})();
