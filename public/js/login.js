(function () {
  // Deja connecte ? -- evite d'afficher le formulaire si une session valide
  // existe encore (ex: retour arriere apres connexion).
  fetch('/api/auth/me').then(r => { if (r.ok) location.href = '/index.html'; }).catch(() => {});

  // Bouton "Se connecter avec Google" masque par defaut -- affiche
  // seulement si GOOGLE_CLIENT_ID/SECRET sont configures cote serveur
  // (voir /api/public-config).
  fetch('/api/public-config').then(r => r.json()).then(cfg => {
    if (cfg.googleEnabled) {
      document.getElementById('loginGoogleDivider').style.display = 'flex';
      document.getElementById('loginGoogleBtn').style.display = 'flex';
    }
  }).catch(() => {});

  // Erreurs renvoyees par le callback OAuth (redirection cote serveur,
  // pas un fetch -- l'information voyage donc par la query string).
  const GOOGLE_ERROR_MESSAGES = {
    google_no_account: "Aucun compte Leez n'est associé à cette adresse Google. Contactez l'administrateur de votre fonds pour qu'il crée votre compte, puis reconnectez-vous avec Google.",
    google_email_unverified: "Votre adresse Google n'est pas vérifiée -- impossible de l'utiliser pour se connecter.",
    google_state_mismatch: "La connexion Google a expiré ou a été interrompue -- réessayez.",
    google_exchange_failed: "La connexion avec Google a échoué -- réessayez.",
    google_disabled: "La connexion avec Google n'est pas activée sur ce serveur.",
    google_session_error: "Erreur lors de l'ouverture de la session -- réessayez.",
  };
  const errorCode = new URLSearchParams(location.search).get('error');
  if (errorCode) {
    const redirectErrorEl = document.getElementById('loginErrorRedirect');
    redirectErrorEl.textContent = GOOGLE_ERROR_MESSAGES[errorCode] || 'Une erreur est survenue lors de la connexion.';
    redirectErrorEl.style.display = 'block';
  }

  const form = document.getElementById('loginForm');
  const errorEl = document.getElementById('loginError');
  const submitBtn = document.getElementById('loginSubmit');

  // Base sans aucun compte (premiere installation, ou base fraichement
  // branchee) : plutot qu'un "mot de passe incorrect" incomprehensible,
  // la page propose de creer le compte administrateur. Le serveur ferme
  // cette voie des qu'un compte existe.
  let setupMode = false;
  fetch('/api/auth/setup-status').then(r => r.json()).then(s => {
    if (!s.available) return;
    setupMode = true;
    document.getElementById('loginTitle').textContent = 'Première installation';
    document.getElementById('loginSub').style.display = 'none';
    document.getElementById('loginSetupBanner').style.display = 'block';
    submitBtn.textContent = 'Créer le compte et continuer';
    const emailInput = document.getElementById('loginEmail');
    if (s.expectedEmail) { emailInput.value = s.expectedEmail; emailInput.readOnly = true; }
    document.getElementById('loginPassword').setAttribute('autocomplete', 'new-password');
  }).catch(() => {});

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
    submitBtn.textContent = 'Connexion…';
    try {
      const res = await fetch(setupMode ? '/api/auth/first-run' : '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: document.getElementById('loginEmail').value.trim(),
          password: document.getElementById('loginPassword').value,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur de connexion.');
      location.href = '/index.html';
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Se connecter';
    }
  });
})();
