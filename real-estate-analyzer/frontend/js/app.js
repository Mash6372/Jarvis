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

let allSearches = [];

async function loadSearches() {
  allSearches = await fetchJSON(`${API_BASE}/api/searches`);
  renderSearchesTable();
  populateSearchSelects();
}

function renderSearchesTable() {
  const tbody = document.getElementById("searches-body");
  tbody.innerHTML = "";

  for (const s of allSearches) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td></td>
      <td>${s.name}</td>
      <td>${s.city}${s.zone ? " / " + s.zone : ""}</td>
      <td>${(s.portals || []).join(", ") || "-"}</td>
      <td>${s.listings_count}</td>
      <td></td>
    `;

    const delTd = tr.children[0];
    const delBtn = document.createElement("button");
    delBtn.className = "delete-btn";
    delBtn.textContent = "✕";
    delBtn.title = "Elimina ricerca";
    delBtn.onclick = () => deleteSearch(s.id, s.name);
    delTd.appendChild(delBtn);

    const runTd = tr.children[tr.children.length - 1];
    const runBtn = document.createElement("button");
    runBtn.className = "run-btn";
    runBtn.textContent = "▶";
    runBtn.title = "Esegui ora";
    runBtn.onclick = async () => {
      await fetchJSON(`${API_BASE}/api/searches/${s.id}/run-now`, { method: "POST" });
      alert("Ricerca avviata in background, torna tra qualche minuto e ricarica gli annunci.");
    };
    runTd.appendChild(runBtn);

    tbody.appendChild(tr);
  }
}

async function deleteSearch(id, name) {
  if (!confirm(`Eliminare la ricerca "${name}"? Gli annunci già trovati resteranno salvati, solo scollegati dalla ricerca.`)) return;
  if (!confirm(`Confermi definitivamente l'eliminazione di "${name}"? Questa azione non può essere annullata.`)) return;
  await fetchJSON(`${API_BASE}/api/searches/${id}`, { method: "DELETE" });
  await loadSearches();
  loadListings();
}

function populateSearchSelects() {
  const options = allSearches.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");

  const filterSelect = document.getElementById("f-search");
  const currentFilterValue = filterSelect.value;
  filterSelect.innerHTML = `<option value="">Tutte le ricerche</option>` + options;
  filterSelect.value = currentFilterValue;

  const manualSelect = document.getElementById("manual-search-select");
  manualSelect.innerHTML = `<option value="">Nessuna ricerca associata</option>` + options;
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
    "f-q": "q",
    "f-city": "city",
    "f-zone": "zone",
    "f-min-price": "min_price",
    "f-max-price": "max_price",
    "f-min-size": "min_size_sqm",
    "f-max-size": "max_size_sqm",
    "f-min-rooms": "min_rooms",
    "f-max-rooms": "max_rooms",
    "f-min-bathrooms": "min_bathrooms",
    "f-max-bathrooms": "max_bathrooms",
    "f-floor": "floor",
    "f-condition": "condition",
    "f-source": "source",
    "f-search": "search_id",
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
    const searchName = allSearches.find((s) => s.id === l.search_id)?.name || "-";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><a class="listing-link" href="${l.url}" target="_blank" rel="noopener">Apri</a></td>
      <td></td>
      <td>${l.title || "-"}</td>
      <td><span class="badge">${l.source}</span></td>
      <td>${searchName}</td>
      <td>${l.city || "-"}${l.zone ? " / " + l.zone : ""}</td>
      <td>${eur(l.price)}</td>
      <td>${num(l.size_sqm)}</td>
      <td>${eur(l.price_per_sqm)}</td>
      <td>${l.rooms ?? "-"}</td>
      <td>${l.floor || "-"}</td>
      <td>${l.condition}</td>
      <td>${eur(deal.estimated_after_reno_value)}</td>
      <td>${eur(deal.estimated_renovation_cost)}</td>
      <td>${eur(deal.estimated_margin)}</td>
      <td>${deal.estimated_roi_pct != null ? deal.estimated_roi_pct.toFixed(1) + "%" : "-"}</td>
      <td class="${scoreClass(deal.deal_score)}">${deal.deal_score ?? "-"} <small>(${deal.confidence || "-"})</small></td>
    `;

    const actionsTd = tr.children[1];

    const editBtn = document.createElement("button");
    editBtn.className = "edit-btn";
    editBtn.textContent = "✏️";
    editBtn.title = "Modifica annuncio";
    editBtn.onclick = () => openEditDialog(l);
    actionsTd.appendChild(editBtn);

    const delBtn = document.createElement("button");
    delBtn.className = "delete-btn";
    delBtn.textContent = "✕";
    delBtn.title = "Elimina annuncio";
    delBtn.onclick = () => deleteListing(l.id, l.title);
    actionsTd.appendChild(delBtn);

    tbody.appendChild(tr);
  }
}

function openEditDialog(listing) {
  const form = document.getElementById("edit-form");
  form.elements["id"].value = listing.id;
  form.elements["url"].value = listing.url || "";
  form.elements["source"].value = listing.source;
  form.elements["title"].value = listing.title || "";
  form.elements["price"].value = listing.price ?? "";
  form.elements["size_sqm"].value = listing.size_sqm ?? "";
  form.elements["rooms"].value = listing.rooms ?? "";
  form.elements["bathrooms"].value = listing.bathrooms ?? "";
  form.elements["floor"].value = listing.floor || "";
  form.elements["city"].value = listing.city || "";
  form.elements["zone"].value = listing.zone || "";
  form.elements["condition"].value = listing.condition;

  const editSelect = document.getElementById("edit-search-select");
  editSelect.innerHTML =
    `<option value="">Nessuna ricerca associata</option>` +
    allSearches.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
  editSelect.value = listing.search_id ?? "";

  document.getElementById("edit-dialog").showModal();
}

document.getElementById("edit-cancel").addEventListener("click", () => {
  document.getElementById("edit-dialog").close();
});

document.getElementById("edit-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const id = form.get("id");
  const payload = {
    url: form.get("url"),
    source: form.get("source"),
    title: form.get("title") || null,
    price: Number(form.get("price")),
    size_sqm: Number(form.get("size_sqm")),
    rooms: form.get("rooms") ? Number(form.get("rooms")) : null,
    bathrooms: form.get("bathrooms") ? Number(form.get("bathrooms")) : null,
    floor: form.get("floor") || null,
    city: form.get("city"),
    zone: form.get("zone") || null,
    condition: form.get("condition"),
    search_id: form.get("search_id") ? Number(form.get("search_id")) : null,
  };
  try {
    await fetchJSON(`${API_BASE}/api/listings/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    document.getElementById("edit-dialog").close();
    await loadSearches();
    loadListings();
  } catch (err) {
    alert("Errore modifica annuncio: " + err.message);
  }
});

async function deleteListing(id, title) {
  if (!confirm(`Eliminare l'annuncio "${title || id}"?`)) return;
  await fetchJSON(`${API_BASE}/api/listings/${id}`, { method: "DELETE" });
  loadListings();
  loadSearches();
}

document.getElementById("apply-filters").addEventListener("click", loadListings);

document.getElementById("manual-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const payload = {
    url: form.get("url"),
    source: form.get("source"),
    title: form.get("title") || null,
    price: Number(form.get("price")),
    size_sqm: Number(form.get("size_sqm")),
    rooms: form.get("rooms") ? Number(form.get("rooms")) : null,
    bathrooms: form.get("bathrooms") ? Number(form.get("bathrooms")) : null,
    floor: form.get("floor") || null,
    city: form.get("city"),
    zone: form.get("zone") || null,
    condition: form.get("condition"),
    search_id: form.get("search_id") ? Number(form.get("search_id")) : null,
  };
  try {
    await fetchJSON(`${API_BASE}/api/listings/manual`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    e.target.reset();
    await loadSearches();
    loadListings();
  } catch (err) {
    alert("Errore aggiunta annuncio: " + err.message);
  }
});

(async () => {
  await loadSearches();
  loadListings();
})();
