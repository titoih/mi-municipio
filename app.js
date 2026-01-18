// ====== CONFIG: CSV locales (carpeta /data) ======
const DATASETS = {
  naturaleza: {
    name: "Actividades en la naturaleza",
    file: "./data/actividades-naturaleza.csv",
    source: "https://datos.tenerife.es/api/action/package_show?id=7a84fcee-3fc7-4f9b-b6ad-1cf4ba2b5255",
    help: "Planes de naturaleza y aire libre. Filtra por caravana, pernocta o grupos; y ordénalo por cercanía."
  },
  itinerarios: {
    name: "Itinerarios de Tenerife",
    file: "./data/itinerarios-tenerife.csv",
    source: "https://datos.tenerife.es/api/action/package_show?id=8d10c221-0910-43c5-9b2f-d9df59efded7",
    help: "Rutas e itinerarios. Usa el buscador para encontrar senderos por zona o nombre."
  },
  puntos: {
    name: "Puntos de interés",
    file: "./data/puntos-interes.csv",
    source: "https://datos.tenerife.es/api/action/package_show?id=8c56a7ab-2ff9-44f9-986f-6f3a18dc7ac3",
    help: "Lugares para descubrir: patrimonio, miradores, cultura, naturaleza…"
  }
};

// Municipios (lista fija)
const MUNICIPIOS = [
  "Adeje","Arafo","Arico","Arona","Buenavista del Norte","Candelaria","El Rosario","El Sauzal","El Tanque",
  "Fasnia","Garachico","Granadilla de Abona","Guía de Isora","Güímar","Icod de los Vinos","La Guancha",
  "La Laguna","La Matanza de Acentejo","La Orotava","La Victoria de Acentejo","Los Realejos","Los Silos",
  "Puerto de la Cruz","San Juan de la Rambla","San Miguel de Abona","Santa Cruz de Tenerife","Santa Úrsula",
  "Santiago del Teide","Tacoronte","Tegueste","Vilaflor de Chasna"
];

const STEP_MORE = 15;
const LIMIT_START = 8;

// ====== DOM ======
const $municipio = document.getElementById("municipio");
const $btn = document.getElementById("btn");
const $out = document.getElementById("out");
const $status = document.getElementById("status");

// ====== Estado ======
let cache = null;
const cardState = {};

// ====== Utilidades ======
function escapeHTML(s){
  return (s ?? "").toString()
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

function normText(s) {
  return (s || "").toString().trim().toLowerCase()
    .replaceAll("á","a").replaceAll("é","e").replaceAll("í","i").replaceAll("ó","o").replaceAll("ú","u")
    .replaceAll("ü","u").replaceAll("ñ","n")
    .replace(/\s+/g, " ");
}

function normMunicipio(s) {
  const x = normText(s);
  const alias = {
    "la laguna": "san cristobal de la laguna",
    "san cristobal de la laguna": "san cristobal de la laguna",
    "santa cruz": "santa cruz de tenerife",
    "santa cruz de tenerife": "santa cruz de tenerife",
    "vilaflor": "vilaflor de chasna",
    "vilaflor de chasna": "vilaflor de chasna"
  };
  return alias[x] || x;
}

function toNumberSafe(x) {
  if (x === null || x === undefined) return null;
  const s = String(x).trim().replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function fmtMeters(x) {
  const n = toNumberSafe(x);
  if (n === null) return "";
  return `${Math.round(n)}`;
}

function fmtKm(x) {
  const n = toNumberSafe(x);
  if (n === null) return "";
  return `${n.toFixed(1)}`;
}

function clampText(s, max = 160) {
  const t = (s || "").toString().trim();
  if (t.length <= max) return t;
  return t.slice(0, max).trim() + "…";
}

function badgeHTML(text) {
  if (!text) return "";
  return `<span class="badge" style="margin-right:6px">${escapeHTML(text)}</span>`;
}

async function shareText(title, text) {
  if (navigator.share) {
    try { await navigator.share({ title, text }); return true; } catch (_) {}
  }
  try {
    await navigator.clipboard.writeText(text);
    alert("Copiado al portapapeles ✅");
    return true;
  } catch (_) {
    prompt("Copia este texto:", text);
    return false;
  }
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];

    if (c === '"' && inQuotes && n === '"') { cur += '"'; i++; continue; }
    if (c === '"') { inQuotes = !inQuotes; continue; }

    if (!inQuotes && (c === ',' || c === ';')) { row.push(cur.trim()); cur = ""; continue; }
    if (!inQuotes && (c === '\n' || c === '\r')) {
      if (cur.length || row.length) { row.push(cur.trim()); rows.push(row); }
      cur = ""; row = [];
      if (c === '\r' && n === '\n') i++;
      continue;
    }
    cur += c;
  }
  if (cur.length || row.length) { row.push(cur.trim()); rows.push(row); }

  if (!rows.length) return [];
  const headers = rows[0].map(h => h.replace(/^\uFEFF/, ""));
  return rows.slice(1).filter(r => r.some(x => x && x.trim())).map(r => {
    const obj = {};
    headers.forEach((h, idx) => obj[h] = (r[idx] ?? "").trim());
    return obj;
  });
}

function findField(record, candidates) {
  const keys = Object.keys(record);
  for (const c of candidates) {
    const k = keys.find(k => k.toLowerCase() === c.toLowerCase());
    if (k) return k;
  }
  return null;
}

function detectNameKey(sample) {
  const candidates = [
    "nombre","Nombre","titulo","Título","title","Title",
    "denominacion","Denominación","itinerario","Itinerario",
    "ruta","Ruta","sendero","Sendero","actividad","Actividad",
    "punto_interes_nombre","punto_interes","poi_nombre","poi","recurso","Recurso",
    "actividad_nombre","itinerario_nombre"
  ];
  return findField(sample, candidates);
}

function detectPlaceKey(sample) {
  const candidates = [
    "lugar","Lugar","zona","Zona","direccion","Dirección",
    "localizacion","Localización","municipio_nombre","Municipio","municipio",
    "barrio","Barrio","entorno","Entorno",
    "itinerario_inicio","itinerario_fin"
  ];
  return findField(sample, candidates);
}

function detectMunicipioKey(sample) {
  const candidates = [
    "municipio_nombre","MUNICIPIO_NOMBRE","municipio","Municipio",
    "tm_municipio","municipio_descripcion","municipio_desc","municipios_nombres"
  ];
  return findField(sample, candidates);
}

function detectDifficultyKey(sample) {
  const candidates = ["dificultad","Dificultad","nivel","Nivel","nivel_dificultad","NivelDificultad","grado","Grado"];
  return findField(sample, candidates);
}

function detectDateKey(sample) {
  const candidates = ["fecha","Fecha","date","Date","fecha_inicio","Fecha_inicio","inicio","Inicio","fecha_actividad","fecha_evento"];
  return findField(sample, candidates);
}

function getLatLon(it) {
  const lat = it["latitud"] || it["lat"] || it["LATITUD"] || it["latitude"] || it["Latitude"];
  const lon = it["longitud"] || it["lon"] || it["LONGITUD"] || it["longitude"] || it["Longitude"];
  if (!lat || !lon) return null;
  return { lat, lon };
}

function mapsViewUrl(lat, lon) {
  const q = encodeURIComponent(`${lat},${lon}`);
  return `https://www.google.com/maps?q=${q}`;
}

function mapsNavUrl(lat, lon) {
  const d = encodeURIComponent(`${lat},${lon}`);
  return `https://www.google.com/maps/dir/?api=1&destination=${d}&travelmode=driving`;
}

function getContact(it) {
  const emailKey = findField(it, ["email","Email","correo","Correo","correo_electronico","mail"]);
  const phoneKey = findField(it, ["telefono","Teléfono","phone","Phone","movil","Móvil"]);
  const email = emailKey ? (it[emailKey] || "").trim() : "";
  const phone = phoneKey ? (it[phoneKey] || "").trim() : "";
  return { email, phone };
}

function cleanPhone(phone) {
  return (phone || "").replace(/[^\d+]/g, "");
}

function filtroMunicipioFlexible(items, municipio) {
  const m = normMunicipio(municipio);
  const alt = (m === "san cristobal de la laguna") ? "la laguna" : m;
  return items.filter(r => {
    const blob = normText(Object.values(r).join(" "));
    return blob.includes(m) || blob.includes(alt);
  });
}

function applySearch(items, q) {
  const query = normText(q);
  if (!query) return items;
  return items.filter(it => normText(Object.values(it).join(" ")).includes(query));
}

function applyDifficultyFilter(items, difficultyKey, level) {
  if (!difficultyKey || !level || level === "all") return items;
  const wanted = normText(level);
  return items.filter(it => normText(it[difficultyKey]).includes(wanted));
}

function applyDateQuickFilter(items, dateKey, mode) {
  if (!dateKey || !mode || mode === "all") return items;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = todayStart.getDay(); // 0..6

  const saturday = new Date(todayStart);
  saturday.setDate(todayStart.getDate() + ((6 - day + 7) % 7));
  const sunday = new Date(saturday);
  sunday.setDate(saturday.getDate() + 1);

  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  return items.filter(it => {
    const d = new Date(it[dateKey]);
    if (isNaN(d)) return false;

    if (mode === "today") return d >= todayStart && d < new Date(todayStart.getTime() + 86400000);
    if (mode === "weekend") return d >= saturday && d <= sunday;
    if (mode === "month") return d >= todayStart && d <= monthEnd;
    return true;
  });
}

function applyPoiTypeFilter(items, typeValue) {
  if (!typeValue || typeValue === "all") return items;
  const wanted = normText(typeValue);
  return items.filter(it => normText(it["punto_interes_tipo"]).includes(wanted));
}

// Naturaleza: filtros
function toBoolLoose(v) {
  const s = normText(v);
  if (!s) return null;
  if (["1","si","sí","true","t","yes","y"].includes(s)) return true;
  if (["0","no","false","f","n"].includes(s)) return false;
  return null;
}

function applyNatureFilters(items, st) {
  let out = items;

  if (st.natCaravana) {
    out = out.filter(it => toBoolLoose(it["permite_caravana"]) === true);
  }
  if (st.natPernocta) {
    out = out.filter(it => toBoolLoose(it["pernocta"]) === true);
  }
  if (st.natGrupos) {
    out = out.filter(it => toBoolLoose(it["actividad_para_grupos"]) === true);
  }

  // Tamaño grupo: usa maximo_personas si existe
  if (st.natGroupSize && st.natGroupSize !== "all") {
    const need = parseInt(st.natGroupSize, 10);
    out = out.filter(it => {
      const mx = toNumberSafe(it["maximo_personas"]);
      if (mx === null) return false;
      return mx >= need;
    });
  }

  return out;
}

// Geodistancia
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (x) => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function fmtDaysAvailable(v) {
  const s = (v || "").toString().trim();
  if (!s) return "";
  // Si viene como lista, lo dejamos "bonito" sin inventar
  return s.replace(/\s+/g, " ");
}

function pickFallbackFields(it) {
  const entries = Object.entries(it).filter(([,v]) => (v ?? "").toString().trim());
  const first = entries[0]?.[1] || "";
  const second = entries[1]?.[1] || "";
  return { first, second };
}

// ====== Carga CSVs ======
async function loadAll() {
  $status.textContent = "Cargando datos…";
  const loaded = {};

  for (const [key, ds] of Object.entries(DATASETS)) {
    const res = await fetch(ds.file, { cache: "no-store" });
    if (!res.ok) throw new Error(`No se pudo cargar ${ds.file}`);
    const text = await res.text();
    const data = parseCSV(text);

    const sample = data[0] || {};
    loaded[key] = {
      ...ds,
      data,
      keys: {
        munKey: detectMunicipioKey(sample),
        nameKey: detectNameKey(sample),
        placeKey: detectPlaceKey(sample),
        difficultyKey: (key === "itinerarios") ? detectDifficultyKey(sample) : null,
        dateKey: (key === "naturaleza") ? detectDateKey(sample) : null
      }
    };
  }

  cache = loaded;
  $status.textContent = "Listo ✅";
  $btn.disabled = false;
}

// ====== Render items ======
function buildItemHTML(datasetKey, it, keys) {
  // ----- NATURALEZA: ficha útil -----
  if (datasetKey === "naturaleza") {
    const nombre = (it["actividad_nombre"] || "").trim();
    const tipo = (it["actividad_tipo"] || "").trim();
    const infra = (it["infraestructura"] || "").trim();
    const desc = (it["actividad_descripcion"] || "").trim();

    const caravana = toBoolLoose(it["permite_caravana"]);
    const pernocta = toBoolLoose(it["pernocta"]);
    const grupos = toBoolLoose(it["actividad_para_grupos"]);
    const maxPers = toNumberSafe(it["maximo_personas"]);
    const antel = toNumberSafe(it["maximo_dias_antelacion"]);
    const dias = fmtDaysAvailable(it["dias_disponible"]);

    const ll = getLatLon(it);
    const geoLine = ll
      ? `<a href="${mapsViewUrl(ll.lat, ll.lon)}" target="_blank" rel="noreferrer">📍 Ver mapa</a> ·
         <a href="${mapsNavUrl(ll.lat, ll.lon)}" target="_blank" rel="noreferrer">🚗 Cómo llegar</a>`
      : "";

    const distLine = (it.__distKm != null)
      ? `📍 A ${it.__distKm.toFixed(1)} km de ti`
      : "";

    const b = [];
    if (tipo) b.push(badgeHTML(tipo));
    if (infra) b.push(badgeHTML(infra));
    if (caravana === true) b.push(badgeHTML("🚐 Caravana"));
    if (pernocta === true) b.push(badgeHTML("🏕 Pernocta"));
    if (grupos === true) b.push(badgeHTML("👥 Grupos"));
    if (maxPers != null) b.push(badgeHTML(`👤 Máx ${Math.round(maxPers)}`));

    return `
      <li style="margin-bottom:12px">
        <strong>🌿 ${escapeHTML(nombre || "Actividad")}</strong>
        ${b.length ? `<div style="margin-top:6px">${b.join("")}</div>` : ""}

        ${desc ? `<div class="muted" style="margin-top:6px">📝 ${escapeHTML(clampText(desc, 170))}</div>` : ""}

        ${dias ? `<div class="muted" style="margin-top:6px">📅 Días disponible: ${escapeHTML(dias)}</div>` : ""}
        ${antel != null ? `<div class="muted" style="margin-top:6px">⏳ Reserva: hasta ${Math.round(antel)} días de antelación</div>` : ""}

        ${distLine ? `<div class="muted" style="margin-top:6px">${escapeHTML(distLine)}</div>` : ""}
        ${geoLine ? `<div class="muted" style="margin-top:6px">${geoLine}</div>` : ""}
      </li>
    `;
  }

  // ----- ITINERARIOS: render ciudadano con campos reales -----
  if (datasetKey === "itinerarios") {
    const matricula = (it["itinerario_matricula"] || "").trim();
    const nombre = (it["itinerario_nombre"] || "").trim();
    const inicio = (it["itinerario_inicio"] || "").trim();
    const fin = (it["itinerario_fin"] || "").trim();

    const distancia = fmtKm(it["itinerario_distancia"]);
    const altMin = fmtMeters(it["itinerario_altura_minima"]);
    const altMax = fmtMeters(it["itinerario_altura_maxima"]);
    const desnPos = fmtMeters(it["itinerario_desnivel_positivo"]);
    const desnNeg = fmtMeters(it["itinerario_desnivel_negativo"]);

    const clase = (it["itinerario_clase"] || "").trim();
    const modalidad = (it["itinerario_modalidad"] || "").trim();
    const municipios = (it["municipios_nombres"] || "").trim();
    const espacios = (it["espacios_naturales"] || "").trim();

    const title = [matricula, nombre].filter(Boolean).join(" — ") || "Itinerario";

    const line1Parts = [];
    if (distancia) line1Parts.push(`📏 ${distancia} km`);
    if (clase) line1Parts.push(`🏷 ${clase}`);
    if (modalidad) line1Parts.push(`🥾 ${modalidad}`);
    const line1 = line1Parts.join(" · ");

    const line2Parts = [];
    if (altMin || altMax) line2Parts.push(`⛰ ${altMin || "?"}–${altMax || "?"} m`);
    if (desnPos) line2Parts.push(`⬆️ +${desnPos} m`);
    if (desnNeg) line2Parts.push(`⬇️ -${desnNeg} m`);
    const line2 = line2Parts.join(" · ");

    const line3 = (inicio || fin) ? `🧭 ${[inicio, fin].filter(Boolean).join(" → ")}` : "";
    const line4 = municipios ? `🏛 ${municipios}` : "";
    const line5 = espacios ? `🌿 ${espacios}` : "";

    return `
      <li>
        <strong>${escapeHTML(title)}</strong>
        ${line1 ? `<div class="muted">${escapeHTML(line1)}</div>` : ""}
        ${line2 ? `<div class="muted">${escapeHTML(line2)}</div>` : ""}
        ${line3 ? `<div class="muted">${escapeHTML(line3)}</div>` : ""}
        ${line4 ? `<div class="muted">${escapeHTML(line4)}</div>` : ""}
        ${line5 ? `<div class="muted">${escapeHTML(line5)}</div>` : ""}
      </li>
    `;
  }

  // ----- PUNTOS: render bonito + compartir -----
  if (datasetKey === "puntos") {
    const nombre = (it["punto_interes_nombre"] || "").trim();
    const tipo = (it["punto_interes_tipo"] || "").trim();
    const subtipo = (it["punto_interes_subtipo"] || "").trim();
    const espacio = (it["espacio_natural_nombre"] || "").trim();
    const desc = (it["punto_interes_descripcion"] || "").trim();

    const ll = getLatLon(it);
    const mapLinks = ll
      ? `<a href="${mapsViewUrl(ll.lat, ll.lon)}" target="_blank" rel="noreferrer">📍 Ver mapa</a> ·
         <a href="${mapsNavUrl(ll.lat, ll.lon)}" target="_blank" rel="noreferrer">🚗 Cómo llegar</a>`
      : "";

    const fullText = `${nombre}${tipo ? " (" + tipo + ")" : ""}${subtipo ? " - " + subtipo : ""}\n` +
      `${espacio ? "Espacio natural: " + espacio + "\n" : ""}` +
      `${desc ? desc + "\n" : ""}` +
      `${ll ? "Mapa: " + mapsViewUrl(ll.lat, ll.lon) : ""}`;

    const shortDesc = clampText(desc, 160);

    return `
      <li style="margin-bottom:12px">
        <strong>📍 ${escapeHTML(nombre || "Punto de interés")}</strong>
        <div style="margin-top:6px">
          ${badgeHTML(tipo)}
          ${badgeHTML(subtipo)}
        </div>

        ${espacio ? `<div class="muted" style="margin-top:6px">🌿 ${escapeHTML(espacio)}</div>` : ""}

        ${desc ? `<div class="muted" style="margin-top:6px">📝 ${escapeHTML(shortDesc)}</div>` : ""}

        ${mapLinks ? `<div class="muted" style="margin-top:6px">${mapLinks}</div>` : ""}

        <div class="muted" style="margin-top:6px">
          <a href="#" data-share="1" data-title="${escapeHTML(nombre || "Punto de interés")}" data-text="${escapeHTML(fullText)}">📤 Compartir</a>
        </div>
      </li>
    `;
  }

  // ----- RESTO: genérico -----
  const name = keys.nameKey ? (it[keys.nameKey] || "") : "";
  const place = keys.placeKey ? (it[keys.placeKey] || "") : "";

  let main = [name, place].filter(Boolean).join(" — ");
  if (!main) {
    const fb = pickFallbackFields(it);
    main = [fb.first, fb.second].filter(Boolean).join(" — ") || "Elemento";
  }

  const ll = getLatLon(it);
  let geoLine = "";
  if (ll) {
    geoLine = `<a href="${mapsViewUrl(ll.lat, ll.lon)}" target="_blank" rel="noreferrer">📍 Ver mapa</a> · ` +
              `<a href="${mapsNavUrl(ll.lat, ll.lon)}" target="_blank" rel="noreferrer">🚗 Cómo llegar</a>`;
  }

  const { email, phone } = getContact(it);
  const phoneClean = cleanPhone(phone);
  let contactLine = "";
  const parts = [];
  if (phoneClean) parts.push(`<a href="tel:${phoneClean}">📞 Llamar</a>`);
  if (email) parts.push(`<a href="mailto:${encodeURIComponent(email)}">✉️ Email</a>`);
  if (parts.length) contactLine = parts.join(" · ");

  return `
    <li>
      ${escapeHTML(main)}
      ${geoLine ? `<div class="muted">${geoLine}</div>` : ""}
      ${contactLine ? `<div class="muted">${contactLine}</div>` : ""}
    </li>
  `;
}

function renderFilters(datasetKey) {
  const st = cardState[datasetKey];
  const id = `card-${datasetKey}`;

  const diffUI = (datasetKey === "itinerarios" && st.keys.difficultyKey)
    ? `
      <select id="${id}-diff" class="smallbtn">
        <option value="all">Dificultad: Todas</option>
        <option value="facil">Fácil</option>
        <option value="medio">Medio</option>
        <option value="dificil">Difícil</option>
      </select>
    ` : "";

  const dateUI = (datasetKey === "naturaleza" && st.keys.dateKey)
    ? `
      <select id="${id}-date" class="smallbtn">
        <option value="all">Fecha: Todas</option>
        <option value="today">Hoy</option>
        <option value="weekend">Fin de semana</option>
        <option value="month">Este mes</option>
      </select>
    ` : "";

  const typeUI = (datasetKey === "puntos" && (st.poiTypes || []).length)
    ? `
      <select id="${id}-type" class="smallbtn">
        <option value="all">Tipo: Todos</option>
        ${(st.poiTypes || []).map(t => `<option value="${escapeHTML(t)}">${escapeHTML(t)}</option>`).join("")}
      </select>
    ` : "";

  const natureUI = (datasetKey === "naturaleza")
    ? `
      <label class="chip muted" style="margin-right:10px">
        <input type="checkbox" id="${id}-caravana" ${st.natCaravana ? "checked" : ""}/> 🚐 Caravana
      </label>
      <label class="chip muted" style="margin-right:10px">
        <input type="checkbox" id="${id}-pernocta" ${st.natPernocta ? "checked" : ""}/> 🏕 Pernocta
      </label>
      <label class="chip muted" style="margin-right:10px">
        <input type="checkbox" id="${id}-grupos" ${st.natGrupos ? "checked" : ""}/> 👥 Grupos
      </label>
      <select id="${id}-gsize" class="smallbtn">
        <option value="all">Grupo: cualquiera</option>
        <option value="4">4+</option>
        <option value="10">10+</option>
        <option value="20">20+</option>
        <option value="40">40+</option>
      </select>
      <button id="${id}-near" class="smallbtn" type="button">📍 Cerca de mí</button>
    ` : "";

  if (!diffUI && !dateUI && !typeUI && !natureUI) return "";
  return `<div class="row" style="margin-top:10px">${diffUI}${dateUI}${typeUI}${natureUI}</div>`;
}

function renderCard(datasetKey) {
  const st = cardState[datasetKey];
  const ds = st.ds;

  const id = `card-${datasetKey}`;
  const total = st.filtered.length;
  const shown = st.filtered.slice(0, st.limit);
  const listHTML = shown.map(it => buildItemHTML(datasetKey, it, st.keys)).join("");

  const canMore = st.limit < total;

  return `
    <div class="card" id="${id}">
      <h2>${escapeHTML(ds.name)} <span class="badge">${escapeHTML(`${total} registros`)}</span></h2>
      <div class="muted">${escapeHTML(ds.help)}</div>

      <div class="row" style="margin-top:10px">
        <input id="${id}-search" type="search" placeholder="Buscar..." value="${escapeHTML(st.query)}" style="flex:1;min-width:220px" />
      </div>

      ${renderFilters(datasetKey)}

      <div class="muted" id="${id}-meta" style="margin-top:8px">
        Mostrando ${Math.min(st.limit, total)} de ${total}.
      </div>

      ${
        total
          ? `<ul id="${id}-list">${listHTML}</ul>`
          : `<div class="muted" style="margin-top:10px">No hay registros para este municipio.</div>`
      }

      ${
        total && canMore
          ? `<button class="smallbtn" style="margin-top:10px" id="${id}-more">Ver más (+${STEP_MORE})</button>`
          : ``
      }

      <div class="muted footlink">
        <a href="${ds.source}" target="_blank" rel="noreferrer">Ver fuente oficial</a>
      </div>
    </div>
  `;
}

function recomputeFiltered(datasetKey) {
  const st = cardState[datasetKey];
  let out = st.items;

  if (datasetKey === "itinerarios" && st.keys.difficultyKey) {
    out = applyDifficultyFilter(out, st.keys.difficultyKey, st.diffLevel);
  }
  if (datasetKey === "naturaleza" && st.keys.dateKey) {
    out = applyDateQuickFilter(out, st.keys.dateKey, st.dateMode);
  }
  if (datasetKey === "puntos") {
    out = applyPoiTypeFilter(out, st.poiType);
  }
  if (datasetKey === "naturaleza") {
    out = applyNatureFilters(out, st);
  }

  out = applySearch(out, st.query);

  // Naturaleza: si hay ubicación y sortNear -> calcula distancia + ordena
  if (datasetKey === "naturaleza" && st.userLoc && st.sortNear) {
    const { lat, lon } = st.userLoc;
    out = out
      .map(it => {
        const ll = getLatLon(it);
        if (!ll) return { ...it, __distKm: null };
        const d = haversineKm(lat, lon, parseFloat(ll.lat), parseFloat(ll.lon));
        return { ...it, __distKm: Number.isFinite(d) ? d : null };
      })
      .sort((a,b) => {
        if (a.__distKm == null && b.__distKm == null) return 0;
        if (a.__distKm == null) return 1;
        if (b.__distKm == null) return -1;
        return a.__distKm - b.__distKm;
      });
  }

  st.filtered = out;
  if (st.limit > st.filtered.length) st.limit = Math.max(LIMIT_START, st.filtered.length);
}

function updateCardDOM(datasetKey) {
  const st = cardState[datasetKey];
  const id = `card-${datasetKey}`;

  const $list = document.getElementById(`${id}-list`);
  const $meta = document.getElementById(`${id}-meta`);
  const $more = document.getElementById(`${id}-more`);

  const total = st.filtered.length;
  const shown = st.filtered.slice(0, st.limit);

  if ($meta) $meta.textContent = `Mostrando ${Math.min(st.limit, total)} de ${total}.`;
  if ($list) $list.innerHTML = shown.map(it => buildItemHTML(datasetKey, it, st.keys)).join("");

  if ($more) {
    if (st.limit >= total) $more.style.display = "none";
    else {
      $more.style.display = "";
      $more.textContent = `Ver más (+${STEP_MORE})`;
    }
  }
}

function attachCardHandlers(datasetKey) {
  const st = cardState[datasetKey];
  const id = `card-${datasetKey}`;

  const $search = document.getElementById(`${id}-search`);
  const $more = document.getElementById(`${id}-more`);
  const $diff = document.getElementById(`${id}-diff`);
  const $date = document.getElementById(`${id}-date`);
  const $type = document.getElementById(`${id}-type`);

  // naturaleza filters
  const $caravana = document.getElementById(`${id}-caravana`);
  const $pernocta = document.getElementById(`${id}-pernocta`);
  const $grupos = document.getElementById(`${id}-grupos`);
  const $gsize = document.getElementById(`${id}-gsize`);
  const $near = document.getElementById(`${id}-near`);

  if ($search) {
    $search.addEventListener("input", () => {
      st.query = $search.value || "";
      recomputeFiltered(datasetKey);
      updateCardDOM(datasetKey);
    });
  }

  if ($diff) {
    $diff.addEventListener("change", () => {
      st.diffLevel = $diff.value;
      recomputeFiltered(datasetKey);
      updateCardDOM(datasetKey);
    });
  }

  if ($date) {
    $date.addEventListener("change", () => {
      st.dateMode = $date.value;
      recomputeFiltered(datasetKey);
      updateCardDOM(datasetKey);
    });
  }

  if ($type) {
    $type.addEventListener("change", () => {
      st.poiType = $type.value;
      recomputeFiltered(datasetKey);
      updateCardDOM(datasetKey);
    });
  }

  if ($caravana) {
    $caravana.addEventListener("change", () => {
      st.natCaravana = $caravana.checked;
      recomputeFiltered(datasetKey);
      updateCardDOM(datasetKey);
    });
  }
  if ($pernocta) {
    $pernocta.addEventListener("change", () => {
      st.natPernocta = $pernocta.checked;
      recomputeFiltered(datasetKey);
      updateCardDOM(datasetKey);
    });
  }
  if ($grupos) {
    $grupos.addEventListener("change", () => {
      st.natGrupos = $grupos.checked;
      recomputeFiltered(datasetKey);
      updateCardDOM(datasetKey);
    });
  }
  if ($gsize) {
    $gsize.addEventListener("change", () => {
      st.natGroupSize = $gsize.value;
      recomputeFiltered(datasetKey);
      updateCardDOM(datasetKey);
    });
  }

  if ($near) {
    $near.addEventListener("click", async () => {
      if (!navigator.geolocation) {
        alert("Tu navegador no soporta geolocalización.");
        return;
      }
      $near.textContent = "📍 Obteniendo ubicación…";
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          st.userLoc = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          st.sortNear = true;
          $near.textContent = "📍 Cerca de mí ✅";
          recomputeFiltered(datasetKey);
          updateCardDOM(datasetKey);
        },
        () => {
          $near.textContent = "📍 Cerca de mí";
          alert("No se pudo obtener tu ubicación (permiso denegado o error).");
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
      );
    });
  }

  if ($more) {
    $more.addEventListener("click", () => {
      st.limit = Math.min(st.limit + STEP_MORE, st.filtered.length);
      updateCardDOM(datasetKey);
    });
  }

  // Compartir puntos (delegación)
  if (datasetKey === "puntos") {
    const card = document.getElementById(`card-${datasetKey}`);
    if (card) {
      card.addEventListener("click", async (e) => {
        const a = e.target.closest("a[data-share='1']");
        if (!a) return;
        e.preventDefault();
        const title = a.getAttribute("data-title") || "Punto de interés";
        const text = a.getAttribute("data-text") || "";
        await shareText(title, text);
      });
    }
  }
}

// ====== Compartir ficha ======
async function shareMunicipio(m, summaryText) {
  const text = `Ficha de ${m}\n${summaryText}\n\nDatos: datos.tenerife.es`;
  await shareText(`Ficha de ${m}`, text);
}

// ====== Ficha por municipio ======
function showMunicipio(m) {
  const mNorm = normMunicipio(m);
  const mNormAlt = (mNorm === "san cristobal de la laguna") ? "la laguna" : mNorm;

  for (const [key, ds] of Object.entries(cache)) {
    const munKey = ds.keys.munKey;
    let items = ds.data;

    if (munKey) {
      items = items.filter(r => {
        const v = normMunicipio(r[munKey]);
        return v === mNorm || v === mNormAlt || (key === "itinerarios" && normText(r[munKey]).includes(normText(m)));
      });
    } else {
      items = filtroMunicipioFlexible(items, m);
    }

    let poiTypes = [];
    if (key === "puntos") {
      const set = new Set(
        items.map(r => (r["punto_interes_tipo"] || "").trim()).filter(Boolean)
      );
      poiTypes = Array.from(set).sort((a,b)=>a.localeCompare(b, "es"));
    }

    cardState[key] = {
      ds,
      keys: ds.keys,
      items,
      filtered: items,
      limit: LIMIT_START,
      query: "",
      diffLevel: "all",
      dateMode: "all",
      poiType: "all",
      poiTypes,

      // naturaleza extra
      natCaravana: false,
      natPernocta: false,
      natGrupos: false,
      natGroupSize: "all",
      userLoc: null,
      sortNear: false
    };
  }

  const totalNat = cardState.naturaleza?.items.length ?? 0;
  const totalIt = cardState.itinerarios?.items.length ?? 0;
  const totalPoi = cardState.puntos?.items.length ?? 0;

  const summary = `Resumen: ${totalNat} actividades naturaleza · ${totalIt} itinerarios · ${totalPoi} puntos de interés.`;

  $out.innerHTML = `
    <div class="card">
      <h2>Ficha de ${escapeHTML(m)}</h2>
      <div class="muted">
        Información generada a partir de conjuntos de datos abiertos del Cabildo de Tenerife.
        <br/>
        <strong>${escapeHTML(summary)}</strong>
      </div>
      <div class="btnbar" style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">
        <button id="shareBtn" class="smallbtn">📤 Compartir ficha</button>
      </div>
    </div>
    <div class="grid">
      ${renderCard("naturaleza")}
      ${renderCard("itinerarios")}
      ${renderCard("puntos")}
    </div>
  `;

  attachCardHandlers("naturaleza");
  attachCardHandlers("itinerarios");
  attachCardHandlers("puntos");

  const shareBtn = document.getElementById("shareBtn");
  if (shareBtn) shareBtn.addEventListener("click", () => shareMunicipio(m, summary));
}

// ====== Init ======
function initMunicipiosUI() {
const sel = document.getElementById("municipio");
const btn = document.getElementById("btn");

if (!sel || !btn) {
  console.error("Faltan elementos en el HTML:", { sel, btn });
  return;
}

  $municipio.innerHTML = "";
  MUNICIPIOS.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    $municipio.appendChild(opt);
  });

  $btn.addEventListener("click", () => showMunicipio($municipio.value));
}

function maybeAutoShow() {
  const saved = localStorage.getItem("favMunicipio");
  if (saved && MUNICIPIOS.includes(saved)) showMunicipio(saved);
}

initMunicipiosUI();

loadAll()
  .then(maybeAutoShow)
  .catch(err => {
    $status.innerHTML = `<span class="error">Error: ${escapeHTML(err.message || String(err))}</span>`;
  });

// ===== Install Banner (Android + iOS) =====
let deferredInstallPrompt = null;

function initInstallBanner() {
  const banner = document.getElementById("installBanner");
  const btn = document.getElementById("installBannerBtn");
  const close = document.getElementById("installBannerClose");
  const text = document.getElementById("installBannerText");

  if (!banner || !btn || !close) return;

  const ua = navigator.userAgent || "";
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  if (isStandalone) return; // si ya está instalada, no mostramos banner

  // Si quieres que SIEMPRE salga, comenta estas 2 líneas:
  const dismissed = localStorage.getItem("installBannerDismissed");
  if (dismissed === "1") return;

  // iOS: mostramos banner que abre instrucciones
  if (isIOS) {
    banner.style.display = "block";
    btn.textContent = "Cómo instalar";
    if (text) text.textContent = "Añádela a tu pantalla de inicio (Safari)";

    const modal = document.getElementById("iosInstallModal");
    const modalClose = document.getElementById("iosInstallClose");
    const modalOk = document.getElementById("iosInstallOk");

    const openModal = () => { if (modal) modal.style.display = "block"; };
    const closeModal = () => { if (modal) modal.style.display = "none"; };

    btn.addEventListener("click", openModal);
    if (modalClose) modalClose.addEventListener("click", closeModal);
    if (modalOk) modalOk.addEventListener("click", closeModal);
    if (modal) modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

  } else {
    // Android: esperamos a que Chrome dispare el evento
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      banner.style.display = "block";
      btn.textContent = "Instalar";
      if (text) text.textContent = "Instálala como app (sin navegador)";
    });

    btn.addEventListener("click", async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      banner.style.display = "none";
    });

    window.addEventListener("appinstalled", () => {
      deferredInstallPrompt = null;
      banner.style.display = "none";
    });
  }

  close.addEventListener("click", () => {
    banner.style.display = "none";
    localStorage.setItem("installBannerDismissed", "1");
  });
}
try { initInstallBanner(); } catch (e) { console.warn(e); }

