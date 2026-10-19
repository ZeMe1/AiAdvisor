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

const post = (body) => ({ method: 'POST', body: JSON.stringify(body) });

export const api = {
  login: (username, password) => j('/api/auth/login', post({ username, password })),
  twoFa: (code) => j('/api/auth/2fa', post({ code })),
  logout: () => j('/api/auth/logout', { method: 'POST' }),
  me: (refresh = false) => j(`/api/me${refresh ? '?refresh=1' : ''}`),
  curriculum: () => j('/api/curriculum'),
  catalog: () => j('/api/catalog'),
  sections: (code, mufSqId) =>
    j(`/api/sections?code=${encodeURIComponent(code)}${mufSqId ? `&mufSqId=${encodeURIComponent(mufSqId)}` : ''}`),
  search: (code) => j(`/api/search?code=${encodeURIComponent(code)}`),
  electives: (payload) => j('/api/electives', post(payload)),
  profile: () => j('/api/profile'),
  updateProfile: (body) => j('/api/profile', { method: 'PUT', body: JSON.stringify(body) }),
  adminGetUsers: () => j('/api/admin/users'),
  adminUpdateRole: (username, role) =>
    j(`/api/admin/users/${encodeURIComponent(username)}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    }),
  adminBlockUser: (username, is_blocked) =>
    j(`/api/admin/users/${encodeURIComponent(username)}/block`, {
      method: 'PUT',
      body: JSON.stringify({ is_blocked }),
    }),

  // Course catalog admin CRUD (Story 6)
  adminGetCourses: () => j('/api/admin/courses'),
  adminCreateCourse: (course) => j('/api/admin/courses', post(course)),
  adminUpdateCourse: (id, course) =>
    j(`/api/admin/courses/${id}`, {
      method: 'PUT',
      body: JSON.stringify(course),
    }),
  adminArchiveCourse: (id, is_archived) =>
    j(`/api/admin/courses/${id}/archive`, {
      method: 'PUT',
      body: JSON.stringify({ is_archived }),
    }),
  adminDeleteCourse: (id) => j(`/api/admin/courses/${id}`, { method: 'DELETE' }),

  // Prerequisites (Story 7)
  adminGetPrerequisites: () => j('/api/admin/prerequisites'),
  adminCreatePrerequisite: (body) => j('/api/admin/prerequisites', post(body)),
  adminDeletePrerequisite: (id) => j(`/api/admin/prerequisites/${id}`, { method: 'DELETE' }),

  // Transcript & Grades (Story 9)
  studentGetTranscript: () => j('/api/student/transcript'),
  studentParseTranscript: (payload) => j('/api/student/transcript/parse', post(payload)),
  studentConfirmTranscript: (courses) => j('/api/student/transcript/confirm', post({ courses })),
  studentAddManualCourse: (course) => j('/api/student/transcript/manual', post(course)),
  studentDeleteTranscriptCourse: (id) => j(`/api/student/transcript/${id}`, { method: 'DELETE' }),
  studentClearTranscript: () => j('/api/student/transcript', { method: 'DELETE' }),

  // Academic Progress (Story 10)
  studentGetProgress: () => j('/api/student/progress'),
};
