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
  roadmap: () => j('/api/roadmap'),
  eligibility: () => j('/api/eligibility'),
  recommendations: () => j('/api/recommendations'),
  submitRecommendationFeedback: (courseCode, isInterested, targetSemester) =>
    j('/api/recommendations/feedback', post({ courseCode, isInterested, targetSemester })),
  sections: (code, mufSqId) =>
    j(`/api/sections?code=${encodeURIComponent(code)}${mufSqId ? `&mufSqId=${encodeURIComponent(mufSqId)}` : ''}`),
  search: (code) => j(`/api/search?code=${encodeURIComponent(code)}`),
  electives: (payload) => j('/api/electives', post(payload)),
  profile: () => j('/api/profile'),
  updateProfile: (body) => j('/api/profile', { method: 'PUT', body: JSON.stringify(body) }),
  getMyAdvisor: () => j('/api/advisor'),
  adminGetUsers: () => j('/api/admin/users'),
  adminUpdateRole: (username, role) => j(`/api/admin/users/${encodeURIComponent(username)}/role`, { method: 'PUT', body: JSON.stringify({ role }) }),
  adminBlockUser: (username, is_blocked) => j(`/api/admin/users/${encodeURIComponent(username)}/block`, { method: 'PUT', body: JSON.stringify({ is_blocked }) }),
  adminGetGroups: () => j('/api/admin/groups'),
  adminCreateGroup: (body) => j('/api/admin/groups', post(body)),
  adminDeleteGroup: (id) => j(`/api/admin/groups/${id}`, { method: 'DELETE' }),
  adminAssignAdvisor: (id, advisor_username) => j(`/api/admin/groups/${id}/advisor`, { method: 'PUT', body: JSON.stringify({ advisor_username }) }),
  adminGetGroupMembers: (id) => j(`/api/admin/groups/${id}/members`),
  adminEnrollStudent: (id, username) => j(`/api/admin/groups/${id}/members`, post({ username })),
  adminRemoveStudent: (id, username) => j(`/api/admin/groups/${id}/members/${encodeURIComponent(username)}`, { method: 'DELETE' }),
  adminGetCurriculums: () => j('/api/admin/curriculums'),
  adminPreviewCurriculum: (body) => j('/api/admin/curriculums/preview', post(body)),
  adminImportCurriculum: (body) => j('/api/admin/curriculums', post(body)),
  adminGetCurriculumDetails: (id) => j(`/api/admin/curriculums/${id}`),
  adminSetCurriculumPublished: (id, is_published) => j(`/api/admin/curriculums/${id}/publish`, { method: 'PATCH', body: JSON.stringify({ is_published }) }),
  adminDeleteCurriculum: (id) => j(`/api/admin/curriculums/${id}`, { method: 'DELETE' }),
  adminGetCurriculumStudents: (id) => j(`/api/admin/curriculums/${id}/students`),
  adminAssignCurriculumStudent: (id, username) => j(`/api/admin/curriculums/${id}/students`, post({ username })),
  adminRemoveCurriculumStudent: (id, username) => j(`/api/admin/curriculums/${id}/students/${encodeURIComponent(username)}`, { method: 'DELETE' }),
  adminGetRecommendationConfig: () => j('/api/admin/recommendations/config'),
  adminUpdateRecommendationConfig: (body) => j('/api/admin/recommendations/config', { method: 'PUT', body: JSON.stringify(body) }),
  adminResetRecommendationConfig: () => j('/api/admin/recommendations/config/reset', { method: 'POST' }),
};
