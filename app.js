/* ============================================================
   Suivi Carburant — HelloPermis · Auto-école
   Application 100 % locale : données en localStorage,
   exports CSV et Excel (.xlsx) générés dans le navigateur.
   ============================================================ */

(() => {
  'use strict';

  const STORAGE_KEY = 'hellopermis-carburant:v1';

  // ---------------------------------------------------------
  // Utilitaires
  // ---------------------------------------------------------

  const $ = (sel) => document.querySelector(sel);

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const uid = () =>
    (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);

  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  // 'AAAA-MM-JJ' -> 'JJ/MM/AAAA'
  const frDate = (iso) => (iso || '').split('-').reverse().join('/');

  const nfEUR  = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
  const nfEUR3 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const nfNum  = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
  const nfInt  = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
  }

  // ---------------------------------------------------------
  // État & persistance
  // ---------------------------------------------------------

  function loadState() {
    const fallback = { vehicles: [], fills: [], settings: { tva: 20 } };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return {
        vehicles: Array.isArray(parsed.vehicles) ? parsed.vehicles : [],
        fills: Array.isArray(parsed.fills) ? parsed.fills : [],
        settings: Object.assign({ tva: 20 }, parsed.settings),
      };
    } catch {
      return fallback;
    }
  }

  const state = loadState();

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      toast("⚠️ Impossible d'enregistrer : stockage du navigateur indisponible.");
    }
  }

  const vehicleById = (id) => state.vehicles.find((v) => v.id === id);

  const vehicleLabel = (v) =>
    `${v.immat} — ${[v.marque, v.modele].filter(Boolean).join(' ')}`.replace(/ — $/, '');

  let editingVehicleId = null;
  let editingFillId = null;

  // ---------------------------------------------------------
  // Navigation par onglets
  // ---------------------------------------------------------

  function switchView(view) {
    document.querySelectorAll('.tab').forEach((btn) => {
      const active = btn.dataset.view === view;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    $('#view-suivi').classList.toggle('hidden', view !== 'suivi');
    $('#view-vehicules').classList.toggle('hidden', view !== 'vehicules');
  }

  document.querySelectorAll('.tab').forEach((btn) =>
    btn.addEventListener('click', () => switchView(btn.dataset.view)));

  $('#notice-add-vehicle').addEventListener('click', () => {
    switchView('vehicules');
    $('#veh-immat').focus();
  });

  // ---------------------------------------------------------
  // Véhicules
  // ---------------------------------------------------------

  const vehForm = $('#vehicle-form');

  function resetVehicleForm() {
    editingVehicleId = null;
    vehForm.reset();
    $('#vehicle-form-title').textContent = 'Ajouter un véhicule';
    $('#vehicle-submit').textContent = 'Ajouter le véhicule';
    $('#vehicle-cancel').classList.add('hidden');
  }

  vehForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const immat = $('#veh-immat').value.trim().toUpperCase();
    const marque = $('#veh-marque').value.trim();
    const modele = $('#veh-modele').value.trim();

    if (!immat || !marque || !modele) {
      toast('Merci de renseigner l’immatriculation, la marque et le modèle.');
      return;
    }
    const duplicate = state.vehicles.some(
      (v) => v.id !== editingVehicleId && v.immat.toUpperCase() === immat);
    if (duplicate) {
      toast(`⚠️ Un véhicule avec l’immatriculation ${immat} existe déjà.`);
      return;
    }

    if (editingVehicleId) {
      const v = vehicleById(editingVehicleId);
      if (v) Object.assign(v, { immat, marque, modele });
      toast('✅ Véhicule modifié.');
    } else {
      state.vehicles.push({ id: uid(), immat, marque, modele, createdAt: Date.now() });
      toast(`✅ Véhicule ${immat} ajouté.`);
    }
    saveState();
    resetVehicleForm();
    renderAll();
  });

  $('#vehicle-cancel').addEventListener('click', resetVehicleForm);

  $('#vehicles-tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const v = vehicleById(btn.dataset.id);
    if (!v) return;

    if (btn.dataset.action === 'edit') {
      editingVehicleId = v.id;
      $('#veh-immat').value = v.immat;
      $('#veh-marque').value = v.marque;
      $('#veh-modele').value = v.modele;
      $('#vehicle-form-title').textContent = `Modifier le véhicule ${v.immat}`;
      $('#vehicle-submit').textContent = 'Enregistrer les modifications';
      $('#vehicle-cancel').classList.remove('hidden');
      vehForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('#veh-immat').focus();
    }

    if (btn.dataset.action === 'delete') {
      const linked = state.fills.filter((f) => f.vehicleId === v.id).length;
      const msg = linked
        ? `Supprimer le véhicule ${v.immat} ?\n\n⚠️ Les ${linked} plein(s) associé(s) seront aussi supprimés.`
        : `Supprimer le véhicule ${v.immat} ?`;
      if (!confirm(msg)) return;
      state.vehicles = state.vehicles.filter((x) => x.id !== v.id);
      state.fills = state.fills.filter((f) => f.vehicleId !== v.id);
      if (editingVehicleId === v.id) resetVehicleForm();
      if (editingFillId && !state.fills.some((f) => f.id === editingFillId)) resetFillForm();
      saveState();
      renderAll();
      toast('🗑️ Véhicule supprimé.');
    }
  });

  function renderVehicles() {
    const tbody = $('#vehicles-tbody');
    const sorted = [...state.vehicles].sort((a, b) => a.immat.localeCompare(b.immat, 'fr'));
    tbody.innerHTML = sorted.map((v) => {
      const fills = state.fills.filter((f) => f.vehicleId === v.id);
      const lastKm = fills.length ? Math.max(...fills.map((f) => f.km || 0)) : null;
      return `<tr>
        <td><span class="plate">${esc(v.immat)}</span></td>
        <td>${esc(v.marque)}</td>
        <td>${esc(v.modele)}</td>
        <td class="num">${fills.length}</td>
        <td class="num">${lastKm != null ? nfInt.format(lastKm) + ' km' : '—'}</td>
        <td class="actions">
          <button type="button" class="link-btn" data-action="edit" data-id="${v.id}">Modifier</button>
          <button type="button" class="link-btn danger" data-action="delete" data-id="${v.id}">Supprimer</button>
        </td>
      </tr>`;
    }).join('');
    $('#vehicles-empty').classList.toggle('hidden', sorted.length > 0);
    $('#vehicles-table').classList.toggle('hidden', sorted.length === 0);
  }

  // ---------------------------------------------------------
  // Pleins : calculs automatiques
  // ---------------------------------------------------------

  const prixInput = $('#fill-prix');
  const litresInput = $('#fill-litres');
  const tvaInput = $('#fill-tva');
  const htInput = $('#fill-ht');
  const ttcInput = $('#fill-ttc');

  const tvaRate = () => {
    const t = parseFloat(tvaInput.value);
    return Number.isFinite(t) && t >= 0 ? t : 20;
  };

  function recalcHTFromTTC() {
    const ttc = parseFloat(ttcInput.value);
    if (Number.isFinite(ttc)) htInput.value = round2(ttc / (1 + tvaRate() / 100)).toFixed(2);
  }

  function recalcTTCFromHT() {
    const ht = parseFloat(htInput.value);
    if (Number.isFinite(ht)) ttcInput.value = round2(ht * (1 + tvaRate() / 100)).toFixed(2);
  }

  function recalcTotals() {
    const prix = parseFloat(prixInput.value);
    const litres = parseFloat(litresInput.value);
    if (prix > 0 && litres > 0) {
      ttcInput.value = round2(prix * litres).toFixed(2);
      recalcHTFromTTC();
    }
  }

  prixInput.addEventListener('input', recalcTotals);
  litresInput.addEventListener('input', recalcTotals);
  ttcInput.addEventListener('input', recalcHTFromTTC);
  htInput.addEventListener('input', recalcTTCFromHT);
  tvaInput.addEventListener('input', () => {
    state.settings.tva = tvaRate();
    saveState();
    recalcHTFromTTC();
  });

  // ---------------------------------------------------------
  // Pleins : formulaire
  // ---------------------------------------------------------

  const fillForm = $('#fill-form');

  function resetFillForm() {
    editingFillId = null;
    const keepDate = $('#fill-date').value || todayISO();
    const keepVehicle = $('#fill-vehicle').value;
    fillForm.reset();
    $('#fill-date').value = keepDate;
    $('#fill-vehicle').value = keepVehicle;
    tvaInput.value = state.settings.tva;
    $('#fill-form-title').textContent = 'Ajouter un plein';
    $('#fill-submit').textContent = 'Ajouter le plein';
    $('#fill-cancel').classList.add('hidden');
  }

  fillForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const entry = {
      date: $('#fill-date').value,
      vehicleId: $('#fill-vehicle').value,
      prix: parseFloat(prixInput.value),
      litres: parseFloat(litresInput.value),
      ht: parseFloat(htInput.value),
      ttc: parseFloat(ttcInput.value),
      km: parseFloat($('#fill-km').value),
    };

    if (!entry.vehicleId) { toast('Merci de choisir un véhicule.'); return; }
    if (!entry.date) { toast('Merci de renseigner la date.'); return; }
    if (!(entry.prix > 0) || !(entry.litres > 0)) { toast('Merci de renseigner le prix au litre et les litres.'); return; }
    if (!Number.isFinite(entry.ht) || !Number.isFinite(entry.ttc)) { toast('Merci de renseigner les totaux HT et TTC.'); return; }
    if (!Number.isFinite(entry.km) || entry.km < 0) { toast('Merci de renseigner le kilométrage du véhicule.'); return; }

    if (editingFillId) {
      const f = state.fills.find((x) => x.id === editingFillId);
      if (f) Object.assign(f, entry);
      toast('✅ Plein modifié.');
    } else {
      state.fills.push({ id: uid(), createdAt: Date.now(), ...entry });
      toast('✅ Plein enregistré.');
    }
    saveState();
    resetFillForm();
    renderFills();
    renderVehicles();
  });

  $('#fill-cancel').addEventListener('click', resetFillForm);

  $('#fills-tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const f = state.fills.find((x) => x.id === btn.dataset.id);
    if (!f) return;

    if (btn.dataset.action === 'edit') {
      editingFillId = f.id;
      $('#fill-date').value = f.date;
      $('#fill-vehicle').value = f.vehicleId;
      prixInput.value = f.prix;
      litresInput.value = f.litres;
      tvaInput.value = state.settings.tva;
      htInput.value = Number.isFinite(f.ht) ? f.ht.toFixed(2) : '';
      ttcInput.value = Number.isFinite(f.ttc) ? f.ttc.toFixed(2) : '';
      $('#fill-km').value = f.km;
      $('#fill-form-title').textContent = 'Modifier le plein';
      $('#fill-submit').textContent = 'Enregistrer les modifications';
      $('#fill-cancel').classList.remove('hidden');
      fillForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
      prixInput.focus();
    }

    if (btn.dataset.action === 'delete') {
      const v = vehicleById(f.vehicleId);
      if (!confirm(`Supprimer le plein du ${frDate(f.date)}${v ? ' (' + v.immat + ')' : ''} ?`)) return;
      state.fills = state.fills.filter((x) => x.id !== f.id);
      if (editingFillId === f.id) resetFillForm();
      saveState();
      renderFills();
      renderVehicles();
      toast('🗑️ Plein supprimé.');
    }
  });

  // ---------------------------------------------------------
  // Pleins : filtres, tableau et statistiques
  // ---------------------------------------------------------

  const filterVehicle = $('#filter-vehicle');
  const filterMonth = $('#filter-month');

  function filteredFills() {
    const veh = filterVehicle.value;
    const month = filterMonth.value; // 'AAAA-MM'
    return state.fills
      .filter((f) => (!veh || f.vehicleId === veh) && (!month || (f.date || '').startsWith(month)))
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
  }

  filterVehicle.addEventListener('change', renderFills);
  filterMonth.addEventListener('change', renderFills);
  $('#filter-reset').addEventListener('click', () => {
    filterVehicle.value = '';
    filterMonth.value = '';
    renderFills();
  });

  function renderVehicleOptions() {
    const sorted = [...state.vehicles].sort((a, b) => a.immat.localeCompare(b.immat, 'fr'));
    const options = sorted.map((v) => `<option value="${v.id}">${esc(vehicleLabel(v))}</option>`).join('');

    const formSelect = $('#fill-vehicle');
    const prevForm = formSelect.value;
    formSelect.innerHTML = sorted.length
      ? `<option value="">— Choisir un véhicule —</option>${options}`
      : `<option value="">Ajoutez d'abord un véhicule</option>`;
    if ([...formSelect.options].some((o) => o.value === prevForm)) formSelect.value = prevForm;

    const prevFilter = filterVehicle.value;
    filterVehicle.innerHTML = `<option value="">Tous les véhicules</option>${options}`;
    if ([...filterVehicle.options].some((o) => o.value === prevFilter)) filterVehicle.value = prevFilter;

    $('#no-vehicle-notice').classList.toggle('hidden', sorted.length > 0);
    $('#fill-submit').disabled = sorted.length === 0;
  }

  function renderFills() {
    const rows = filteredFills();
    const tbody = $('#fills-tbody');

    tbody.innerHTML = rows.map((f) => {
      const v = vehicleById(f.vehicleId);
      const vehCell = v
        ? `<div class="veh-cell"><span class="plate">${esc(v.immat)}</span><span class="veh-name">${esc([v.marque, v.modele].filter(Boolean).join(' '))}</span></div>`
        : '<span class="veh-name">Véhicule supprimé</span>';
      return `<tr>
        <td>${frDate(f.date)}</td>
        <td>${vehCell}</td>
        <td class="num">${nfEUR3.format(f.prix)}</td>
        <td class="num">${nfNum.format(f.litres)} L</td>
        <td class="num">${nfEUR.format(f.ht)}</td>
        <td class="num strong">${nfEUR.format(f.ttc)}</td>
        <td class="num">${nfInt.format(f.km)} km</td>
        <td class="actions">
          <button type="button" class="link-btn" data-action="edit" data-id="${f.id}">Modifier</button>
          <button type="button" class="link-btn danger" data-action="delete" data-id="${f.id}">Supprimer</button>
        </td>
      </tr>`;
    }).join('');

    const hasFilter = Boolean(filterVehicle.value || filterMonth.value);
    $('#filter-reset').classList.toggle('hidden', !hasFilter);
    $('#fills-empty').textContent = hasFilter
      ? 'Aucun plein ne correspond aux filtres sélectionnés.'
      : 'Aucun plein enregistré pour le moment.';
    $('#fills-empty').classList.toggle('hidden', rows.length > 0);
    $('#fills-table').classList.toggle('hidden', rows.length === 0);

    // Statistiques (sur les lignes affichées)
    const sum = (fn) => rows.reduce((acc, f) => acc + (Number.isFinite(fn(f)) ? fn(f) : 0), 0);
    $('#stat-count').textContent = String(rows.length);
    $('#stat-litres').textContent = `${nfNum.format(sum((f) => f.litres))} L`;
    $('#stat-ht').textContent = nfEUR.format(sum((f) => f.ht));
    $('#stat-ttc').textContent = nfEUR.format(sum((f) => f.ttc));
  }

  function renderAll() {
    renderVehicleOptions();
    renderVehicles();
    renderFills();
  }

  // ---------------------------------------------------------
  // Exports (les lignes affichées, triées par date croissante)
  // ---------------------------------------------------------

  const EXPORT_HEADERS = ['Date', 'Immatriculation', 'Marque', 'Modèle',
    'Prix au litre (€)', 'Litres', 'Total HT (€)', 'Total TTC (€)', 'Kilométrage (km)'];

  function exportRows() {
    return filteredFills()
      .slice()
      .reverse() // ordre chronologique pour l'export
      .map((f) => {
        const v = vehicleById(f.vehicleId) || {};
        return {
          date: f.date,
          immat: v.immat || '',
          marque: v.marque || '',
          modele: v.modele || '',
          prix: f.prix,
          litres: f.litres,
          ht: f.ht,
          ttc: f.ttc,
          km: f.km,
        };
      });
  }

  function exportFilename(ext) {
    const parts = ['suivi-carburant'];
    const v = filterVehicle.value ? vehicleById(filterVehicle.value) : null;
    if (v) parts.push(v.immat.replace(/[^\wÀ-ÿ-]+/g, '-'));
    if (filterMonth.value) parts.push(filterMonth.value);
    parts.push(todayISO());
    return parts.join('_') + '.' + ext;
  }

  function download(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ---- CSV (séparateur « ; », décimales à virgule : compatible Excel français) ----

  const csvText = (s) => (/[";\n\r]/.test(String(s)) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s));
  const csvNum = (n) => (Number.isFinite(n) ? String(n).replace('.', ',') : '');

  $('#export-csv').addEventListener('click', () => {
    const rows = exportRows();
    if (!rows.length) { toast('Aucun plein à exporter.'); return; }
    const lines = [EXPORT_HEADERS.join(';')];
    rows.forEach((r) => {
      lines.push([
        frDate(r.date), csvText(r.immat), csvText(r.marque), csvText(r.modele),
        csvNum(r.prix), csvNum(r.litres), csvNum(r.ht), csvNum(r.ttc), csvNum(r.km),
      ].join(';'));
    });
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    download(exportFilename('csv'), blob);
    toast('📥 Export CSV téléchargé.');
  });

  // ---- Excel (.xlsx) généré sans dépendance externe ----

  const xmlEsc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

  // Numéro de série Excel d'une date 'AAAA-MM-JJ' (base 1900)
  function excelDateSerial(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
  }

  const COL_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];

  function buildSheetXml(rows) {
    const cell = (col, row, xml) => `<c r="${COL_LETTERS[col]}${row}"${xml}</c>`;
    const str = (col, row, value, style) =>
      cell(col, row, `${style ? ` s="${style}"` : ''} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(value)}</t></is>`);
    const num = (col, row, value, style) =>
      Number.isFinite(value)
        ? cell(col, row, `${style ? ` s="${style}"` : ''}><v>${value}</v>`)
        : str(col, row, '', style);

    let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      '<cols>' +
      [12, 18, 15, 15, 16, 10, 14, 14, 18]
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
        .join('') +
      '</cols><sheetData>';

    // Ligne d'en-tête (style 1 : gras)
    xml += '<row r="1">' + EXPORT_HEADERS.map((h, i) => str(i, 1, h, 1)).join('') + '</row>';

    rows.forEach((r, idx) => {
      const rowNum = idx + 2;
      xml += `<row r="${rowNum}">` +
        cell(0, rowNum, ` s="2"><v>${excelDateSerial(r.date)}</v>`) + // date
        str(1, rowNum, r.immat) +
        str(2, rowNum, r.marque) +
        str(3, rowNum, r.modele) +
        num(4, rowNum, r.prix, 4) +   // 0.000
        num(5, rowNum, r.litres, 3) + // 0.00
        num(6, rowNum, r.ht, 3) +
        num(7, rowNum, r.ttc, 3) +
        num(8, rowNum, r.km) +
        '</row>';
    });

    return xml + '</sheetData></worksheet>';
  }

  const XLSX_STYLES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="0.000"/></numFmts>' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="5">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '</cellXfs></styleSheet>';

  const XLSX_CONTENT_TYPES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>';

  const XLSX_RELS =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  const XLSX_WORKBOOK =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="Suivi carburant" sheetId="1" r:id="rId1"/></sheets></workbook>';

  const XLSX_WORKBOOK_RELS =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';

  // --- Mini-écriture ZIP (mode « stored », sans compression) ---

  let crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        crcTable[i] = c >>> 0;
      }
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 0xFF];
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function buildZip(files) {
    const encoder = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    let centralSize = 0;

    files.forEach((f) => {
      const nameBytes = encoder.encode(f.name);
      const data = encoder.encode(f.content);
      const crc = crc32(data);

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);  // signature
      local.setUint16(4, 20, true);          // version requise
      local.setUint16(6, 0, true);           // drapeaux
      local.setUint16(8, 0, true);           // méthode : stored
      local.setUint16(10, 0, true);          // heure
      local.setUint16(12, 0x21, true);       // date (1980-01-01)
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);
      parts.push(new Uint8Array(local.buffer), nameBytes, data);

      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true);
      cen.setUint16(4, 20, true);
      cen.setUint16(6, 20, true);
      cen.setUint16(8, 0, true);
      cen.setUint16(10, 0, true);
      cen.setUint16(12, 0, true);
      cen.setUint16(14, 0x21, true);
      cen.setUint32(16, crc, true);
      cen.setUint32(20, data.length, true);
      cen.setUint32(24, data.length, true);
      cen.setUint16(28, nameBytes.length, true);
      cen.setUint32(42, offset, true);
      central.push(new Uint8Array(cen.buffer), nameBytes);
      centralSize += 46 + nameBytes.length;

      offset += 30 + nameBytes.length + data.length;
    });

    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    parts.push(...central, new Uint8Array(end.buffer));

    return new Blob(parts, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  $('#export-xlsx').addEventListener('click', () => {
    const rows = exportRows();
    if (!rows.length) { toast('Aucun plein à exporter.'); return; }
    const blob = buildZip([
      { name: '[Content_Types].xml', content: XLSX_CONTENT_TYPES },
      { name: '_rels/.rels', content: XLSX_RELS },
      { name: 'xl/workbook.xml', content: XLSX_WORKBOOK },
      { name: 'xl/_rels/workbook.xml.rels', content: XLSX_WORKBOOK_RELS },
      { name: 'xl/styles.xml', content: XLSX_STYLES },
      { name: 'xl/worksheets/sheet1.xml', content: buildSheetXml(rows) },
    ]);
    download(exportFilename('xlsx'), blob);
    toast('📥 Export Excel téléchargé.');
  });

  // ---------------------------------------------------------
  // Initialisation
  // ---------------------------------------------------------

  $('#fill-date').value = todayISO();
  tvaInput.value = state.settings.tva;
  renderAll();
})();
