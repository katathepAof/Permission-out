(() => {
  'use strict';

  const cfg = window.APP_CONFIG || {};
  const client = cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase?.createClient
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: {
        persistSession: true,
        storage: window.sessionStorage,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
    : null;

  const params = new URLSearchParams(location.search);
  const modules = [
    { key: 'mod1', path: '/', label: 'MOD 1 · วิเคราะห์ PEA / UFM' },
    { key: 'mod2', path: '/mod2/', label: 'MOD 2 · Site Facility' }
  ];
  const elements = {
    context: document.getElementById('loginContext'),
    title: document.getElementById('loginTitle'),
    intro: document.getElementById('loginIntro'),
    form: document.getElementById('loginForm'),
    email: document.getElementById('loginEmail'),
    password: document.getElementById('loginPassword'),
    togglePassword: document.getElementById('togglePassword'),
    error: document.getElementById('loginError'),
    submit: document.getElementById('loginSubmit'),
    forgot: document.getElementById('forgotPassword'),
    recoveryForm: document.getElementById('recoveryForm'),
    newPassword: document.getElementById('newPassword'),
    confirmPassword: document.getElementById('confirmPassword'),
    toggleNewPassword: document.getElementById('toggleNewPassword'),
    recoveryError: document.getElementById('recoveryError'),
    recoverySubmit: document.getElementById('recoverySubmit')
  };

  function safeReturnTo() {
    const raw = params.get('returnTo') || '/';
    try {
      const target = new URL(raw, location.origin);
      if (target.origin !== location.origin || target.pathname.startsWith('/login')) return '/';
      return `${target.pathname}${target.search}${target.hash}`;
    } catch {
      return '/';
    }
  }

  const returnTo = safeReturnTo();
  const requestedModule = returnTo.startsWith('/mod2') ? modules[1] : modules[0];
  elements.context.textContent = requestedModule.label.toUpperCase();

  function authErrorMessage(error) {
    const message = String(error?.message || '');
    if (/invalid login credentials/i.test(message)) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
    if (/email not confirmed/i.test(message)) return 'อีเมลยังไม่ได้รับการยืนยัน';
    if (/user is banned/i.test(message)) return 'บัญชีนี้ถูกระงับการใช้งาน';
    if (/rate limit/i.test(message)) return 'ลองทำรายการหลายครั้งเกินไป กรุณารอสักครู่';
    return message || 'ไม่สามารถดำเนินการได้ กรุณาลองใหม่';
  }

  function togglePassword(input, button, label = 'รหัสผ่าน') {
    const visible = input.type === 'text';
    input.type = visible ? 'password' : 'text';
    button.textContent = visible ? 'แสดง' : 'ซ่อน';
    button.setAttribute('aria-label', visible ? `แสดง${label}` : `ซ่อน${label}`);
  }

  async function loadAccess(user) {
    const latest = await client.auth.getUser().then(({ data }) => data.user);
    const authUser = latest?.id === user.id ? latest : user;
    let result = await client.from('profiles')
      .select('id,display_name,organization,role,is_active,permissions')
      .eq('id', authUser.id)
      .maybeSingle();
    if (result.error && (result.error.code === '42703' || /role|is_active|permissions/i.test(result.error.message || ''))) {
      result = await client.from('profiles')
        .select('id,display_name,organization,role,is_active')
        .eq('id', authUser.id)
        .maybeSingle();
    }
    if (result.error) throw result.error;
    const profile = result.data || {};
    const metadata = authUser.app_metadata || {};
    const role = metadata.permission_out_role || profile.role || 'user';
    const active = metadata.permission_out_active === undefined
      ? profile.is_active !== false
      : metadata.permission_out_active !== false;
    const permissions = profile.permissions || metadata.permission_out_permissions || {};
    return {
      active,
      role,
      permissions,
      canView(key) {
        return role === 'admin' || permissions[key]?.view !== false;
      }
    };
  }

  async function continueToWorkspace(session) {
    const access = await loadAccess(session.user);
    if (!access.active) throw new Error('บัญชีนี้ถูกระงับการใช้งาน');
    if (!access.canView(requestedModule.key)) {
      const fallback = modules.find(module => access.canView(module.key));
      if (fallback) {
        elements.error.innerHTML = `บัญชีนี้ไม่มีสิทธิ์เข้า ${requestedModule.label}<br><a href="${fallback.path}">ไปยัง ${fallback.label}</a>`;
      } else {
        elements.error.textContent = 'บัญชีนี้ยังไม่มีสิทธิ์เข้าใช้งานโมดูล กรุณาติดต่อผู้ดูแลระบบ';
      }
      return false;
    }
    location.replace(returnTo);
    return true;
  }

  function showRecovery() {
    elements.form.hidden = true;
    elements.recoveryForm.hidden = false;
    elements.title.textContent = 'ตั้งรหัสผ่านใหม่';
    elements.intro.textContent = 'กำหนดรหัสผ่านใหม่อย่างน้อย 12 ตัวอักษร แล้วระบบจะพากลับไปยังพื้นที่ทำงาน';
    elements.newPassword.focus();
  }

  elements.togglePassword.addEventListener('click', () => togglePassword(elements.password, elements.togglePassword));
  elements.toggleNewPassword.addEventListener('click', () => togglePassword(elements.newPassword, elements.toggleNewPassword, 'รหัสผ่านใหม่'));

  elements.form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!client || !elements.form.reportValidity()) return;
    elements.submit.disabled = true;
    elements.submit.textContent = 'กำลังตรวจสอบ…';
    elements.error.textContent = '';
    try {
      const { data, error } = await client.auth.signInWithPassword({
        email: elements.email.value.trim(),
        password: elements.password.value
      });
      if (error) throw error;
      const continued = await continueToWorkspace(data.session);
      if (!continued) {
        elements.submit.disabled = false;
        elements.submit.textContent = 'เข้าสู่ระบบ';
      }
    } catch (error) {
      elements.error.textContent = authErrorMessage(error);
      elements.submit.disabled = false;
      elements.submit.textContent = 'เข้าสู่ระบบ';
    }
  });

  elements.forgot.addEventListener('click', async () => {
    const email = elements.email.value.trim();
    if (!email) {
      elements.error.textContent = 'กรุณากรอกอีเมลก่อนขอลิงก์ตั้งรหัสผ่านใหม่';
      elements.email.focus();
      return;
    }
    elements.forgot.disabled = true;
    elements.error.textContent = '';
    const redirectTo = `${location.origin}/login/?mode=recovery&returnTo=${encodeURIComponent(returnTo)}`;
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
    elements.forgot.disabled = false;
    elements.error.textContent = error
      ? authErrorMessage(error)
      : 'ส่งลิงก์ตั้งรหัสผ่านใหม่แล้ว กรุณาตรวจสอบอีเมล';
  });

  elements.recoveryForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!client || !elements.recoveryForm.reportValidity()) return;
    if (elements.newPassword.value !== elements.confirmPassword.value) {
      elements.recoveryError.textContent = 'รหัสผ่านทั้งสองช่องไม่ตรงกัน';
      return;
    }
    elements.recoverySubmit.disabled = true;
    elements.recoverySubmit.textContent = 'กำลังบันทึก…';
    elements.recoveryError.textContent = '';
    const { data, error } = await client.auth.updateUser({ password: elements.newPassword.value });
    if (error) {
      elements.recoveryError.textContent = authErrorMessage(error);
      elements.recoverySubmit.disabled = false;
      elements.recoverySubmit.textContent = 'บันทึกรหัสผ่านใหม่';
      return;
    }
    const { data: sessionData } = await client.auth.getSession();
    if (sessionData.session) await continueToWorkspace(sessionData.session);
    else if (data.user) location.replace(returnTo);
  });

  async function initialize() {
    if (!client) {
      elements.error.textContent = 'ระบบ Cloud ยังไม่ได้ตั้งค่า กรุณาติดต่อผู้ดูแลระบบ';
      elements.submit.disabled = true;
      elements.forgot.disabled = true;
      return;
    }
    client.auth.onAuthStateChange(event => {
      if (event === 'PASSWORD_RECOVERY') showRecovery();
    });
    if (params.get('mode') === 'recovery') {
      showRecovery();
      return;
    }
    const reason = params.get('reason');
    if (reason === 'session_expired') elements.error.textContent = 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่';
    if (reason === 'access_denied') elements.error.textContent = 'บัญชีนี้ไม่มีสิทธิ์เข้าโมดูลที่ร้องขอ';
    const { data } = await client.auth.getSession();
    if (data.session) await continueToWorkspace(data.session);
  }

  initialize().catch(error => {
    elements.error.textContent = authErrorMessage(error);
  });
})();
