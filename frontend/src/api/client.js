const BASE_URL = import.meta.env.VITE_API_URL || "";

function getToken() {
  return localStorage.getItem("vsa_token");
}

async function request(path, opts = {}) {
  const token = getToken();
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, { ...opts, headers });
  if (res.status === 401) {
    localStorage.removeItem("vsa_token");
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const api = {
  async login(username, password) {
    const body = new URLSearchParams({ username, password });
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new Error("Login failed");
    return res.json();
  },

  async getAlerts(limit = 20) {
    return request(`/api/alerts?limit=${limit}`);
  },

  async getEvents({ areaId, signalId, limit = 500, since, dateFrom, dateTo } = {}) {
    const params = new URLSearchParams();
    if (areaId) params.set("area_id", areaId);
    if (signalId) params.set("signal_id", signalId);
    if (limit) params.set("limit", limit);
    if (since) params.set("since", since.toISOString());
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    return request(`/api/events?${params}`);
  },

  async getStats({ areaId, date } = {}) {
    const params = new URLSearchParams();
    if (areaId) params.set("area_id", areaId);
    if (date) params.set("date", date);
    return request(`/api/stats?${params}`);
  },

  async getConfig() {
    return request("/api/config");
  },
  async getSite() {
    return request("/api/config/site");
  },

  async patchSite(body) {
    return request("/api/config/site", { method: "PATCH", body: JSON.stringify(body) });
  },

  async getLiveStatus() {
    return request("/api/live/status");
  },

  async getLogs({ limit = 100, kind } = {}) {
    const params = new URLSearchParams();
    if (limit) params.set("limit", limit);
    if (kind) params.set("kind", kind);
    return request(`/api/logs?${params}`);
  },
};
