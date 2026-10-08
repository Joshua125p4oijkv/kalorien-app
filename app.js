// Kalorien Tracker – Version 1
// Daten werden nur auf dem Gerät gespeichert (localStorage).

const $ = (s) => document.querySelector(s);

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem("kt_" + key);
      return v ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem("kt_" + key, JSON.stringify(value)); } catch {}
  },
};

// ---------- Datum ----------
function dateStr(d = new Date()) {
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
function shiftDay(s, n) {
  const [y, m, d] = s.split("-").map(Number);
  return dateStr(new Date(y, m - 1, d + n));
}
function dayLabel(s) {
  const today = dateStr();
  if (s === today) return "Heute";
  if (s === shiftDay(today, -1)) return "Gestern";
  const [y, m, d] = s.split("-");
  return `${d}.${m}.${y}`;
}

let day = dateStr();
const round = (n) => Math.round(n);
const round1 = (n) => Math.round(n * 10) / 10;

// ---------- Anzeige ----------
function getEntries() {
  return store.get("entries", {})[day] || [];
}
function saveEntries(list) {
  const all = store.get("entries", {});
  if (list.length) all[day] = list; else delete all[day];
  store.set("entries", all);
}

function render() {
  const entries = getEntries();
  const goal = store.get("goal", 2000);
  const sum = entries.reduce(
    (a, e) => ({ kcal: a.kcal + e.kcal, p: a.p + e.p, c: a.c + e.c, f: a.f + e.f }),
    { kcal: 0, p: 0, c: 0, f: 0 }
  );

  $("#dayLabel").textContent = dayLabel(day);
  $("#nextDay").disabled = day >= dateStr();
  $("#nextDay").style.visibility = day >= dateStr() ? "hidden" : "visible";

  const rest = goal - sum.kcal;
  $("#remaining").textContent = round(Math.abs(rest));
  $("#remaining").nextElementSibling.textContent = rest >= 0 ? "kcal übrig" : "kcal zu viel";
  $("#eaten").textContent = round(sum.kcal);
  $("#goal").textContent = goal;
  $("#mP").textContent = round(sum.p);
  $("#mC").textContent = round(sum.c);
  $("#mF").textContent = round(sum.f);

  const fill = $("#barFill");
  fill.style.width = Math.min(100, (sum.kcal / goal) * 100) + "%";
  fill.classList.toggle("over", rest < 0);

  const ul = $("#entries");
  ul.innerHTML = "";
  entries.forEach((e) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <div class="info">
        <div class="name"></div>
        <div class="sub"></div>
      </div>
      <span class="kcal">${round(e.kcal)} kcal</span>
      <button class="del" aria-label="Löschen">✕</button>`;
    li.querySelector(".name").textContent = e.name;
    li.querySelector(".sub").textContent =
      (e.grams ? e.grams + " g · " : "") + `E ${round(e.p)} · K ${round(e.c)} · F ${round(e.f)}`;
    li.querySelector(".del").onclick = () => {
      saveEntries(getEntries().filter((x) => x.id !== e.id));
      render();
    };
    ul.appendChild(li);
  });
  $("#empty").hidden = entries.length > 0;
}

function addEntry(entry) {
  const list = getEntries();
  list.push({ id: Date.now() + Math.random(), ...entry });
  saveEntries(list);
  render();
}

// ---------- Open Food Facts ----------
// Kostenlose Lebensmittel-Datenbank: https://world.openfoodfacts.org
const FIELDS = "code,product_name,product_name_de,brands,nutriments";

function fromOFF(p) {
  const n = p.nutriments || {};
  const p100 = +(n.proteins_100g || 0);
  const c100 = +(n.carbohydrates_100g || 0);
  const f100 = +(n.fat_100g || 0);
  let kcal = n["energy-kcal_100g"];
  if (kcal == null && n["energy_100g"] != null) kcal = n["energy_100g"] / 4.184; // kJ -> kcal
  if (kcal == null && (p100 || c100 || f100)) kcal = p100 * 4 + c100 * 4 + f100 * 9; // aus Nährwerten
  const name = p.product_name_de || p.product_name;
  if (kcal == null || !name) return null;
  const brands = Array.isArray(p.brands) ? p.brands : (p.brands || "").split(",");
  return {
    name: name.trim(),
    brand: (brands[0] || "").trim(),
    kcal: +kcal,
    p: p100,
    c: c100,
    f: f100,
  };
}

// Läuft über server.py, weil die Such-Datenbank keine direkten Browser-Anfragen erlaubt.
async function searchProducts(q) {
  const res = await fetch(`api/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(res.status);
  const data = await res.json();
  const seen = new Set();
  return (data.hits || []).map(fromOFF).filter((p) => {
    if (!p) return false;
    const key = p.name + "|" + p.brand + "|" + round(p.kcal);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function productByCode(code) {
  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${FIELDS}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.status === 1 ? fromOFF(data.product) : null;
}

// ---------- Listen mit Produkten ----------
function productList(ul, products) {
  ul.innerHTML = "";
  products.forEach((p) => {
    const li = document.createElement("li");
    li.className = "pick";
    li.innerHTML = `<div class="info"><div class="name"></div><div class="sub"></div></div>
      <span class="kcal">${round(p.kcal)}<small> /100g</small></span>`;
    li.querySelector(".name").textContent = p.name;
    li.querySelector(".sub").textContent = p.brand || " ";
    li.onclick = () => openAmount(p);
    ul.appendChild(li);
  });
}

function renderRecent() {
  const recent = store.get("recent", []);
  $("#recentTitle").hidden = recent.length === 0;
  productList($("#recent"), recent);
}

function rememberRecent(p) {
  const recent = store.get("recent", []).filter((r) => !(r.name === p.name && r.kcal === p.kcal));
  recent.unshift(p);
  store.set("recent", recent.slice(0, 15));
}

// ---------- Menge wählen ----------
let currentProduct = null;

function openAmount(p) {
  currentProduct = p;
  $("#prodName").textContent = p.name;
  $("#prodPer100").textContent =
    `Pro 100 g: ${round(p.kcal)} kcal · E ${round1(p.p)} g · K ${round1(p.c)} g · F ${round1(p.f)} g`;
  $("#grams").value = store.get("lastGrams_" + p.name, 100);
  updateAmount();
  $("#amountDlg").showModal();
  $("#grams").select();
}

function updateAmount() {
  const g = +$("#grams").value || 0;
  $("#amountKcal").textContent = currentProduct ? round((currentProduct.kcal * g) / 100) : 0;
}

$("#grams").addEventListener("input", updateAmount);

$("#amountForm").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const p = currentProduct;
  const g = +$("#grams").value;
  if (!p || !g) return;
  const k = g / 100;
  addEntry({ name: p.name, grams: g, kcal: p.kcal * k, p: p.p * k, c: p.c * k, f: p.f * k });
  rememberRecent(p);
  store.set("lastGrams_" + p.name, g);
  $("#amountDlg").close();
  closeAdd();
});

// ---------- Hinzufügen-Fenster ----------
function openAdd() {
  showTab("search");
  $("#results").innerHTML = "";
  $("#searchStatus").textContent = "";
  $("#searchInput").value = "";
  renderRecent();
  $("#addDlg").showModal();
}
function closeAdd() {
  stopScan();
  if ($("#addDlg").open) $("#addDlg").close();
}

function showTab(name) {
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab").forEach((t) => (t.hidden = t.id !== "tab-" + name));
  if (name === "scan") startScan(); else stopScan();
}

document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));

$("#searchForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const q = $("#searchInput").value.trim();
  if (!q) return;
  $("#searchStatus").textContent = "Suche läuft …";
  $("#results").innerHTML = "";
  try {
    const products = await searchProducts(q);
    $("#searchStatus").textContent = products.length ? "" : "Nichts gefunden. Probier ein anderes Wort oder trag es manuell ein.";
    productList($("#results"), products);
  } catch {
    $("#searchStatus").textContent = "Suche hat nicht geklappt. Bist du online? Versuch es gleich nochmal.";
  }
});

$("#manualForm").addEventListener("submit", (ev) => {
  ev.preventDefault();
  addEntry({
    name: $("#manName").value.trim(),
    grams: null,
    kcal: +$("#manKcal").value || 0,
    p: +$("#manP").value || 0,
    c: +$("#manC").value || 0,
    f: +$("#manF").value || 0,
  });
  ev.target.reset();
  closeAdd();
});

// ---------- Barcode scannen ----------
let stream = null;
let scanTimer = null;

async function lookupCode(code) {
  $("#scanStatus").textContent = `Barcode ${code} – suche Produkt …`;
  try {
    const p = await productByCode(code);
    if (p) { stopScan(); openAmount(p); }
    else $("#scanStatus").textContent = `Produkt ${code} nicht gefunden. Trag es manuell ein.`;
  } catch {
    $("#scanStatus").textContent = "Suche hat nicht geklappt. Bist du online?";
  }
}

// Ersatz-Scanner für Browser ohne eingebauten Barcode-Scanner (z. B. iPhone/Safari)
const SCANNER_LIB = "https://cdn.jsdelivr.net/npm/barcode-detector@3.2.2/dist/iife/ponyfill.js";
const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function getDetector() {
  if ("BarcodeDetector" in window) {
    try {
      const supported = await BarcodeDetector.getSupportedFormats();
      if (supported.includes("ean_13")) return new BarcodeDetector({ formats: FORMATS });
    } catch {}
  }
  if (!window.BarcodeDetectionAPI) await loadScript(SCANNER_LIB);
  return new window.BarcodeDetectionAPI.BarcodeDetector({ formats: FORMATS });
}

async function startScan() {
  const status = $("#scanStatus");
  if (!navigator.mediaDevices?.getUserMedia) {
    status.textContent = window.isSecureContext
      ? "Kamera nicht verfügbar. Gib die Nummer unten ein."
      : "Die Kamera geht nur über eine sichere Adresse (https). Gib die Nummer unten ein.";
    $("#video").hidden = true;
    return;
  }
  let detector;
  try {
    status.textContent = "Scanner wird geladen …";
    detector = await getDetector();
  } catch {
    status.textContent = "Scanner konnte nicht geladen werden. Gib die Nummer unten ein.";
    $("#video").hidden = true;
    return;
  }
  if ($("#tab-scan").hidden) return; // Tab inzwischen gewechselt
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  } catch {
    status.textContent = "Kein Zugriff auf die Kamera. Gib die Nummer unten ein.";
    $("#video").hidden = true;
    return;
  }
  if ($("#tab-scan").hidden || !$("#addDlg").open) return stopScan();
  const video = $("#video");
  video.hidden = false;
  video.srcObject = stream;
  await video.play();
  status.textContent = "Halte den Barcode vor die Kamera.";
  scanTimer = setInterval(async () => {
    try {
      const codes = await detector.detect(video);
      if (codes.length) {
        clearInterval(scanTimer);
        scanTimer = null;
        lookupCode(codes[0].rawValue);
      }
    } catch {}
  }, 300);
}

function stopScan() {
  if (scanTimer) clearInterval(scanTimer);
  scanTimer = null;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
}

$("#codeForm").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const code = $("#codeInput").value.replace(/\D/g, "");
  if (code) lookupCode(code);
});

// ---------- Einstellungen ----------
$("#openSettings").onclick = () => {
  $("#goalInput").value = store.get("goal", 2000);
  $("#settingsDlg").showModal();
};
$("#settingsForm").addEventListener("submit", (ev) => {
  ev.preventDefault();
  store.set("goal", +$("#goalInput").value);
  $("#settingsDlg").close();
  render();
});

// ---------- Allgemein ----------
document.querySelectorAll("[data-close]").forEach((b) => {
  b.onclick = () => {
    const dlg = b.closest("dialog");
    if (dlg.id === "addDlg") closeAdd(); else dlg.close();
  };
});
$("#addDlg").addEventListener("close", stopScan);
$("#openAdd").onclick = openAdd;
$("#prevDay").onclick = () => { day = shiftDay(day, -1); render(); };
$("#nextDay").onclick = () => { if (day < dateStr()) { day = shiftDay(day, 1); render(); } };

render();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
