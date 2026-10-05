async function j(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  let data = {};
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: res.statusText };
  }
  if (!res.ok) {
    const err = new Error(data.error || res.statusText);
    err.status = res.status;
    err.sessionExpired = data.sessionExpired;
    throw err;
  }
  return data;
}

const post = (url, body) => ({ method: 'POST', body: JSON.stringify(body) });

export const api = {
  login: (username, password) => j('/api/auth/login', post('/api/auth/login', { username, password })),
  twoFa: (code) => j('/api/auth/2fa', post('/api/auth/2fa', { code })),
  logout: () => j('/api/auth/logout', { method: 'POST' }),
  me: (refresh = false) => j(`/api/me${refresh ? '?refresh=1' : ''}`),
  curriculum: () => j('/api/curriculum'),
  sections: (code, mufSqId) =>
    j(`/api/sections?code=${encodeURIComponent(code)}${mufSqId ? `&mufSqId=${encodeURIComponent(mufSqId)}` : ''}`),
  search: (code) => j(`/api/search?code=${encodeURIComponent(code)}`),
  electives: (payload) => j('/api/electives', post('/api/electives', payload)),
  profile: () => j('/api/profile'),
  updateProfile: (body) => j('/api/profile', { method: 'PUT', body: JSON.stringify(body) }),
  adminGetUsers: () => j('/api/admin/users'),
  adminUpdateRole: (username, role) => j(`/api/admin/users/${encodeURIComponent(username)}/role`, { method: 'PUT', body: JSON.stringify({ role }) }),
  adminBlockUser: (username, is_blocked) => j(`/api/admin/users/${encodeURIComponent(username)}/block`, { method: 'PUT', body: JSON.stringify({ is_blocked }) }),
};
