const API_BASE = window.REA_API_BASE || "http://localhost:8000";

const eur = (v) => (v == null ? "-" : v.toLocaleString("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }));
const num = (v, d = 0) => (v == null ? "-" : v.toLocaleString("it-IT", { maximumFractionDigits: d }));

async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body}`);
  }
  return res.status === 204 ? null : res.json();
}

async function loadSearches() {
  const searches = await fetchJSON(`${API_BASE}/api/searches`);
  const container = document.getElementById("searches-list");
  container.innerHTML = "";
  for (const s of searches) {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.innerHTML = `<span>${s.name} (${s.city}${s.zone ? " - " + s.zone : ""})</span>`;

    const runBtn = document.createElement("button");
    runBtn.textContent = "▶";
    runBtn.title = "Esegui ora";
    runBtn.style.color = "#22c55e";
    runBtn.onclick = async () => {
      await fetchJSON(`${API_BASE}/api/searches/${s.id}/run-now`, { method: "POST" });
      alert("Ricerca avviata in background, torna tra qualche minuto e ricarica gli annunci.");
    };

    const delBtn = document.createElement("button");
    delBtn.textContent = "✕";
    delBtn.onclick = async () => {
      await fetchJSON(`${API_BASE}/api/searches/${s.id}`, { method: "DELETE" });
      loadSearches();
    };

    chip.appendChild(runBtn);
    chip.appendChild(delBtn);
    container.appendChild(chip);
  }
}

document.getElementById("search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const payload = {
    name: form.get("name"),
    city: form.get("city"),
    zone: form.get("zone") || null,
    min_price: form.get("min_price") ? Number(form.get("min_price")) : null,
    max_price: form.get("max_price") ? Number(form.get("max_price")) : null,
    min_size_sqm: form.get("min_size_sqm") ? Number(form.get("min_size_sqm")) : null,
    max_size_sqm: form.get("max_size_sqm") ? Number(form.get("max_size_sqm")) : null,
    min_rooms: form.get("min_rooms") ? Number(form.get("min_rooms")) : null,
    portals: ["immobiliare.it", "idealista.it"],
  };
  await fetchJSON(`${API_BASE}/api/searches`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  e.target.reset();
  loadSearches();
});

function scoreClass(score) {
  if (score == null) return "score-low";
  if (score >= 60) return "score-high";
  if (score >= 30) return "score-mid";
  return "score-low";
}

function buildFilterQuery() {
  const params = new URLSearchParams();
  const map = {
    "f-city": "city",
    "f-zone": "zone",
    "f-min-price": "min_price",
    "f-max-price": "max_price",
    "f-min-size": "min_size_sqm",
    "f-max-size": "max_size_sqm",
    "f-min-rooms": "min_rooms",
    "f-condition": "condition",
    "f-source": "source",
    "f-sort": "sort_by",
  };
  for (const [id, key] of Object.entries(map)) {
    const value = document.getElementById(id).value;
    if (value) params.set(key, value);
  }
  return params.toString();
}

async function loadListings() {
  const query = buildFilterQuery();
  const listings = await fetchJSON(`${API_BASE}/api/listings?${query}`);
  const tbody = document.getElementById("listings-body");
  tbody.innerHTML = "";

  for (const l of listings) {
    const deal = l.deal || {};
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${l.title || "-"}</td>
      <td><span class="badge">${l.source}</span></td>
      <td>${l.city || "-"}${l.zone ? " / " + l.zone : ""}</td>
      <td>${eur(l.price)}</td>
      <td>${num(l.size_sqm)}</td>
      <td>${eur(l.price_per_sqm)}</td>
      <td>${l.rooms ?? "-"}</td>
      <td>${l.condition}</td>
      <td>${eur(deal.estimated_after_reno_value)}</td>
      <td>${eur(deal.estimated_renovation_cost)}</td>
      <td>${eur(deal.estimated_margin)}</td>
      <td>${deal.estimated_roi_pct != null ? deal.estimated_roi_pct.toFixed(1) + "%" : "-"}</td>
      <td class="${scoreClass(deal.deal_score)}">${deal.deal_score ?? "-"} <small>(${deal.confidence || "-"})</small></td>
      <td><a class="listing-link" href="${l.url}" target="_blank" rel="noopener">Apri</a></td>
    `;
    tbody.appendChild(tr);
  }
}

document.getElementById("apply-filters").addEventListener("click", loadListings);

document.getElementById("import-btn").addEventListener("click", async () => {
  const url = document.getElementById("import-url").value.trim();
  if (!url) return;
  try {
    await fetchJSON(`${API_BASE}/api/listings/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    document.getElementById("import-url").value = "";
    loadListings();
  } catch (err) {
    alert("Errore importazione: " + err.message);
  }
});

loadSearches();
loadListings();
