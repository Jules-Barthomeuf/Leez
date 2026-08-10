(function () {
  // Deja connecte ? -- evite d'afficher le formulaire si une session valide
  // existe encore.
  fetch('/api/auth/me').then(r => { if (r.ok) location.href = '/index.html'; }).catch(() => {});

  const form = document.getElementById('signupForm');
  const errorEl = document.getElementById('signupError');
  const submitBtn = document.getElementById('signupSubmit');

  document.querySelectorAll('.password-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.togglePassword);
      if (!input) return;
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.querySelector('.icon-eye').style.display = showing ? '' : 'none';
      btn.querySelector('.icon-eye-off').style.display = showing ? 'none' : '';
      btn.setAttribute('aria-label', showing ? 'Afficher le mot de passe' : 'Masquer le mot de passe');
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Création…';
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: document.getElementById('signupName').value.trim(),
          email: document.getElementById('signupEmail').value.trim(),
          password: document.getElementById('signupPassword').value,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur lors de la création du compte.');
      location.href = '/index.html';
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Créer le compte';
    }
  });
})();
