// api.js
export const API_BASE = 'http://localhost:8000';

export async function fetchPOIs(n=null) {
  const url = `${API_BASE}/api/pois${n?('?n='+n):''}`;
  const r = await fetch(url);
  return r.json();
}

export async function postLog(payload) {
  try {
    await fetch(`${API_BASE}/api/log`, {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload)
    });
  } catch (e) {
    console.error("postLog error", e);
  }
}

export async function predictProfile(features) {
  try {
    const r = await fetch(`${API_BASE}/api/predict_profile`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(features)
    });
    return r.json();
  } catch (e) {
    console.error("predictProfile error", e);
    return null;
  }
}

export async function fetchMetrics() {
  try {
    const r = await fetch(`${API_BASE}/api/admin/metrics`);
    return r.json();
  } catch (e) { return null; }
}

export async function fetchServerSessions({ limit=50, recent=null } = {}) {
  try {
    let url = `${API_BASE}/api/admin/sessions?limit=${limit}`;
    if (recent !== null) url += `&recent=${recent}`;
    const r = await fetch(url);
    return await r.json();
  } catch (e) {
    console.error("fetchServerSessions error", e);
    return null;
  }
}
