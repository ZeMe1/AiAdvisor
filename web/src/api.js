async function j(url, opts = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText);
    err.status = res.status;
    throw err;
  }
  return data;
}

const post = (url, body) => ({ method: "POST", body: JSON.stringify(body) });

export const api = {
  login: (username, password) =>
    j("/api/auth/login", post("/api/auth/login", { username, password })),
  twoFa: (code) => j("/api/auth/2fa", post("/api/auth/2fa", { code })),
  logout: () => j("/api/auth/logout", { method: "POST" }),
  me: () => j("/api/me"),
  curriculum: () => j("/api/curriculum"),
  catalog: () => j("/api/catalog"),
  sections: (code, mufSqId) =>
    j(
      `/api/sections?code=${encodeURIComponent(code)}${mufSqId ? `&mufSqId=${encodeURIComponent(mufSqId)}` : ""}`,
    ),
  search: (code) => j(`/api/search?code=${encodeURIComponent(code)}`),
  electives: (payload) => j("/api/electives", post("/api/electives", payload)),
  profile: () => j("/api/profile"),
  updateProfile: (body) =>
    j("/api/profile", { method: "PUT", body: JSON.stringify(body) }),
  adminGetUsers: () => j("/api/admin/users"),
  adminUpdateRole: (username, role) =>
    j(`/api/admin/users/${encodeURIComponent(username)}/role`, {
      method: "PUT",
      body: JSON.stringify({ role }),
    }),
  adminBlockUser: (username, is_blocked) =>
    j(`/api/admin/users/${encodeURIComponent(username)}/block`, {
      method: "PUT",
      body: JSON.stringify({ is_blocked }),
    }),
  // Course catalog admin CRUD
  adminGetCourses: () => j("/api/admin/courses"),
  adminCreateCourse: (course) =>
    j("/api/admin/courses", post("/api/admin/courses", course)),
  adminUpdateCourse: (id, course) =>
    j(`/api/admin/courses/${id}`, {
      method: "PUT",
      body: JSON.stringify(course),
    }),
  adminArchiveCourse: (id, is_archived) =>
    j(`/api/admin/courses/${id}/archive`, {
      method: "PUT",
      body: JSON.stringify({ is_archived }),
    }),
  adminDeleteCourse: (id) =>
    j(`/api/admin/courses/${id}`, { method: "DELETE" }),
  // Story 7: Prerequisites
  adminGetPrerequisites: () => j("/api/admin/prerequisites"),
  adminCreatePrerequisite: (body) =>
    j("/api/admin/prerequisites", post("/api/admin/prerequisites", body)),
  adminDeletePrerequisite: (id) =>
    j(`/api/admin/prerequisites/${id}`, { method: "DELETE" }),
  // Story 9: Transcript & Grades
  studentGetTranscript: () => j("/api/student/transcript"),
  studentParseTranscript: (payload) =>
    j(
      "/api/student/transcript/parse",
      post("/api/student/transcript/parse", payload),
    ),
  studentConfirmTranscript: (courses) =>
    j(
      "/api/student/transcript/confirm",
      post("/api/student/transcript/confirm", { courses }),
    ),
  studentAddManualCourse: (course) =>
    j(
      "/api/student/transcript/manual",
      post("/api/student/transcript/manual", course),
    ),
  studentDeleteTranscriptCourse: (id) =>
    j(`/api/student/transcript/${id}`, { method: "DELETE" }),
  studentClearTranscript: () =>
    j("/api/student/transcript", { method: "DELETE" }),
  studentGetProgress: () =>
    j("/api/student/progress"),
};
