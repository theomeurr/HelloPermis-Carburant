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
  const nfCons = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
  const nfInt  = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

  // 'AAAA-MM' -> nom de mois
  const monthName = (ym, opts) => {
    const [y, m] = ym.split('-').map(Number);
    return new Intl.DateTimeFormat('fr-FR', opts).format(new Date(y, m - 1, 15));
  };
  const monthShort = (ym) => `${monthName(ym, { month: 'short' })} ${ym.slice(2, 4)}`;
  const monthFull = (ym) => monthName(ym, { month: 'long', year: 'numeric' });

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
    const fallback = { vehicles: [], moniteurs: [], fills: [], settings: { tva: 20 } };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return {
        vehicles: Array.isArray(parsed.vehicles) ? parsed.vehicles : [],
        moniteurs: Array.isArray(parsed.moniteurs) ? parsed.moniteurs : [],
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
  const moniteurById = (id) => state.moniteurs.find((m) => m.id === id);

  const vehicleLabel = (v) =>
    `${v.immat} — ${[v.marque, v.modele].filter(Boolean).join(' ')}`.replace(/ — $/, '');

  // Pastille du type de carburant (couleurs repères des pistolets : jaune
  // gazole, vert essence, bleu E85)
  const FUEL_CLASS = {
    'Gazole': 'fuel-gazole',
    'SP95-E10': 'fuel-essence',
    'SP95': 'fuel-essence',
    'SP98': 'fuel-essence',
    'E85': 'fuel-e85',
    'GPL': 'fuel-gpl',
  };
  const fuelTag = (c) => c
    ? `<span class="fuel-tag ${FUEL_CLASS[c] || ''}">${esc(c)}</span>`
    : '<span class="muted-cell">—</span>';

  let editingVehicleId = null;
  let editingMoniteurId = null;
  let editingFillId = null;

  // ---------------------------------------------------------
  // Consommation (L/100 km) et moyennes par véhicule
  // ---------------------------------------------------------

  function chronoFills(vehicleId) {
    return state.fills
      .filter((f) => f.vehicleId === vehicleId)
      .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || 0) - (b.createdAt || 0));
  }

  // conso de chaque plein, calculée sur la distance depuis le plein précédent du véhicule
  function buildConsoMap() {
    const map = new Map();
    state.vehicles.forEach((v) => {
      const fs = chronoFills(v.id);
      for (let i = 1; i < fs.length; i++) {
        const dist = fs[i].km - fs[i - 1].km;
        if (dist > 0 && fs[i].litres > 0) map.set(fs[i].id, (fs[i].litres / dist) * 100);
      }
    });
    return map;
  }

  // conso moyenne et coût TTC/km entre le premier et le dernier relevé du véhicule
  function vehicleAverages(vehicleId) {
    const fs = chronoFills(vehicleId);
    if (fs.length < 2) return null;
    const dist = fs[fs.length - 1].km - fs[0].km;
    if (!(dist > 0)) return null;
    const litres = fs.slice(1).reduce((s, f) => s + (f.litres || 0), 0);
    const ttc = fs.slice(1).reduce((s, f) => s + (f.ttc || 0), 0);
    return { conso: (litres / dist) * 100, coutKm: ttc / dist };
  }

  // alerte si le kilométrage saisi est incohérent avec les autres relevés du véhicule
  function kmWarning(entry, excludeId) {
    let prev = null;
    let next = null;
    state.fills.forEach((f) => {
      if (f.vehicleId !== entry.vehicleId || f.id === excludeId || !Number.isFinite(f.km)) return;
      if ((f.date || '') <= entry.date) {
        if (!prev || (f.date || '') > (prev.date || '') ||
            ((f.date || '') === (prev.date || '') && (f.createdAt || 0) > (prev.createdAt || 0))) prev = f;
      } else if (!next || (f.date || '') < (next.date || '') ||
            ((f.date || '') === (next.date || '') && (f.createdAt || 0) < (next.createdAt || 0))) {
        next = f;
      }
    });
    if (prev && entry.km < prev.km) {
      return `⚠️ Le kilométrage saisi (${nfInt.format(entry.km)} km) est inférieur au dernier relevé de ce véhicule (${nfInt.format(prev.km)} km le ${frDate(prev.date)}).\n\nEnregistrer quand même ?`;
    }
    if (next && entry.km > next.km) {
      return `⚠️ Le kilométrage saisi (${nfInt.format(entry.km)} km) est supérieur à un relevé plus récent de ce véhicule (${nfInt.format(next.km)} km le ${frDate(next.date)}).\n\nEnregistrer quand même ?`;
    }
    return null;
  }

  // ---------------------------------------------------------
  // Navigation par onglets
  // ---------------------------------------------------------

  const VIEWS = { suivi: '#view-suivi', base: '#view-base' };

  function switchView(view) {
    document.querySelectorAll('.tab').forEach((btn) => {
      const active = btn.dataset.view === view;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    Object.entries(VIEWS).forEach(([key, sel]) => $(sel).classList.toggle('hidden', key !== view));
    if (view === 'suivi') renderChart(lastChartRows); // la largeur n'est mesurable que vue visible
  }

  document.querySelectorAll('.tab').forEach((btn) =>
    btn.addEventListener('click', () => switchView(btn.dataset.view)));

  $('#notice-add-vehicle').addEventListener('click', () => {
    switchView('base');
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
    const carburant = $('#veh-carburant').value;
    const moniteurId = $('#veh-moniteur').value || null;

    if (!immat || !marque || !modele) {
      toast('Merci de renseigner l’immatriculation, la marque et le modèle.');
      return;
    }
    if (!carburant) {
      toast('Merci de choisir le type de carburant du véhicule.');
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
      if (v) Object.assign(v, { immat, marque, modele, carburant, moniteurId });
      toast('✅ Véhicule modifié.');
    } else {
      state.vehicles.push({ id: uid(), immat, marque, modele, carburant, moniteurId, createdAt: Date.now() });
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
      $('#veh-carburant').value = v.carburant || '';
      $('#veh-moniteur').value = (v.moniteurId && moniteurById(v.moniteurId)) ? v.moniteurId : '';
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
      const avg = vehicleAverages(v.id);
      const attitre = v.moniteurId ? moniteurById(v.moniteurId) : null;
      return `<tr>
        <td><span class="plate">${esc(v.immat)}</span></td>
        <td>${esc([v.marque, v.modele].filter(Boolean).join(' '))}</td>
        <td>${fuelTag(v.carburant)}</td>
        <td>${attitre ? '👤 ' + esc(attitre.nom) : '<span class="muted-cell">—</span>'}</td>
        <td class="num">${fills.length}</td>
        <td class="num">${lastKm != null ? nfInt.format(lastKm) + ' km' : '<span class="muted-cell">—</span>'}</td>
        <td class="num">${avg ? nfCons.format(avg.conso) + ' L/100' : '<span class="muted-cell">—</span>'}</td>
        <td class="num">${avg ? nfEUR3.format(avg.coutKm) + '/km' : '<span class="muted-cell">—</span>'}</td>
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
  // Moniteurs
  // ---------------------------------------------------------

  const monForm = $('#moniteur-form');

  function resetMoniteurForm() {
    editingMoniteurId = null;
    monForm.reset();
    $('#moniteur-form-title').textContent = 'Ajouter un moniteur';
    $('#moniteur-submit').textContent = 'Ajouter le moniteur';
    $('#moniteur-cancel').classList.add('hidden');
  }

  monForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const nom = $('#mon-nom').value.trim();
    if (!nom) {
      toast('Merci de renseigner le nom du moniteur.');
      return;
    }
    const duplicate = state.moniteurs.some(
      (m) => m.id !== editingMoniteurId && m.nom.toLowerCase() === nom.toLowerCase());
    if (duplicate) {
      toast(`⚠️ Le moniteur « ${nom} » existe déjà.`);
      return;
    }

    if (editingMoniteurId) {
      const m = moniteurById(editingMoniteurId);
      if (m) m.nom = nom;
      toast('✅ Moniteur modifié.');
    } else {
      state.moniteurs.push({ id: uid(), nom, createdAt: Date.now() });
      toast(`✅ Moniteur ${nom} ajouté.`);
    }
    saveState();
    resetMoniteurForm();
    renderAll();
  });

  $('#moniteur-cancel').addEventListener('click', resetMoniteurForm);

  $('#moniteurs-tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const m = moniteurById(btn.dataset.id);
    if (!m) return;

    if (btn.dataset.action === 'edit') {
      editingMoniteurId = m.id;
      $('#mon-nom').value = m.nom;
      $('#moniteur-form-title').textContent = `Modifier le moniteur ${m.nom}`;
      $('#moniteur-submit').textContent = 'Enregistrer les modifications';
      $('#moniteur-cancel').classList.remove('hidden');
      monForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('#mon-nom').focus();
    }

    if (btn.dataset.action === 'delete') {
      const linkedFills = state.fills.filter((f) => f.moniteurId === m.id).length;
      const linkedVehicles = state.vehicles.filter((v) => v.moniteurId === m.id).length;
      let msg = `Supprimer le moniteur ${m.nom} ?`;
      if (linkedFills) msg += `\n\nLes ${linkedFills} plein(s) associé(s) seront conservés, sans moniteur.`;
      if (linkedVehicles) msg += `\n\n${linkedVehicles} véhicule(s) attitré(s) à ce moniteur resteront sans moniteur attitré.`;
      if (!confirm(msg)) return;
      state.moniteurs = state.moniteurs.filter((x) => x.id !== m.id);
      state.fills.forEach((f) => { if (f.moniteurId === m.id) f.moniteurId = null; });
      state.vehicles.forEach((v) => { if (v.moniteurId === m.id) v.moniteurId = null; });
      if (editingMoniteurId === m.id) resetMoniteurForm();
      saveState();
      renderAll();
      toast('🗑️ Moniteur supprimé (pleins conservés).');
    }
  });

  function renderMoniteurs() {
    const tbody = $('#moniteurs-tbody');
    const sorted = [...state.moniteurs].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    tbody.innerHTML = sorted.map((m) => {
      const fills = state.fills.filter((f) => f.moniteurId === m.id);
      const ttc = fills.reduce((s, f) => s + (Number.isFinite(f.ttc) ? f.ttc : 0), 0);
      return `<tr>
        <td>👤 ${esc(m.nom)}</td>
        <td class="num">${fills.length}</td>
        <td class="num">${fills.length ? nfEUR.format(ttc) : '<span class="muted-cell">—</span>'}</td>
        <td class="actions">
          <button type="button" class="link-btn" data-action="edit" data-id="${m.id}">Modifier</button>
          <button type="button" class="link-btn danger" data-action="delete" data-id="${m.id}">Supprimer</button>
        </td>
      </tr>`;
    }).join('');
    $('#moniteurs-empty').classList.toggle('hidden', sorted.length > 0);
    $('#moniteurs-table').classList.toggle('hidden', sorted.length === 0);
  }

  function renderMoniteurOptions() {
    const sorted = [...state.moniteurs].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    const options = sorted.map((m) => `<option value="${m.id}">${esc(m.nom)}</option>`).join('');

    const formSelect = $('#fill-moniteur');
    const prevForm = formSelect.value;
    formSelect.innerHTML = `<option value="">— Aucun —</option>${options}`;
    if ([...formSelect.options].some((o) => o.value === prevForm)) formSelect.value = prevForm;

    const filterSelect = $('#filter-moniteur');
    const prevFilter = filterSelect.value;
    filterSelect.innerHTML = `<option value="">Tous les moniteurs</option>${options}`;
    if ([...filterSelect.options].some((o) => o.value === prevFilter)) filterSelect.value = prevFilter;

    const vehSelect = $('#veh-moniteur');
    const prevVeh = vehSelect.value;
    vehSelect.innerHTML = `<option value="">— Aucun —</option>${options}`;
    if ([...vehSelect.options].some((o) => o.value === prevVeh)) vehSelect.value = prevVeh;
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
    const keepMoniteur = $('#fill-moniteur').value;
    fillForm.reset();
    $('#fill-date').value = keepDate;
    $('#fill-vehicle').value = keepVehicle;
    $('#fill-moniteur').value = keepMoniteur;
    updateFuelHint();
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
      moniteurId: $('#fill-moniteur').value || null,
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

    const warning = kmWarning(entry, editingFillId);
    if (warning && !confirm(warning)) return;

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
    renderMoniteurs();
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
      updateFuelHint();
      $('#fill-moniteur').value = f.moniteurId || '';
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
      renderMoniteurs();
      toast('🗑️ Plein supprimé.');
    }
  });

  // ---------------------------------------------------------
  // Pleins : filtres, tableau et statistiques
  // ---------------------------------------------------------

  const filterVehicle = $('#filter-vehicle');
  const filterMoniteur = $('#filter-moniteur');
  const filterMonth = $('#filter-month');

  function filteredFills() {
    const veh = filterVehicle.value;
    const mon = filterMoniteur.value;
    const month = filterMonth.value; // 'AAAA-MM'
    return state.fills
      .filter((f) =>
        (!veh || f.vehicleId === veh) &&
        (!mon || f.moniteurId === mon) &&
        (!month || (f.date || '').startsWith(month)))
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
  }

  filterVehicle.addEventListener('change', renderFills);
  filterMoniteur.addEventListener('change', renderFills);
  filterMonth.addEventListener('change', renderFills);
  $('#filter-reset').addEventListener('click', () => {
    filterVehicle.value = '';
    filterMoniteur.value = '';
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
    updateFuelHint();
  }

  // Rappel du carburant du véhicule sélectionné (évite les erreurs à la pompe)
  function updateFuelHint() {
    const hint = $('#veh-fuel-hint');
    const v = vehicleById($('#fill-vehicle').value);
    if (v && v.carburant) {
      hint.innerHTML = `⛽ Carburant : ${fuelTag(v.carburant)}`;
      hint.classList.remove('hidden');
    } else {
      hint.classList.add('hidden');
    }
  }

  // Au changement de véhicule : préremplit le moniteur attitré et le rappel carburant
  $('#fill-vehicle').addEventListener('change', () => {
    const v = vehicleById($('#fill-vehicle').value);
    $('#fill-moniteur').value = (v && v.moniteurId && moniteurById(v.moniteurId)) ? v.moniteurId : '';
    updateFuelHint();
  });

  function renderFills() {
    const rows = filteredFills();
    const tbody = $('#fills-tbody');
    const consoMap = buildConsoMap();

    tbody.innerHTML = rows.map((f) => {
      const v = vehicleById(f.vehicleId);
      const m = f.moniteurId ? moniteurById(f.moniteurId) : null;
      const conso = consoMap.get(f.id);
      const vehCell = v
        ? `<div class="veh-cell"><span class="plate">${esc(v.immat)}</span><span class="veh-name">${esc([v.marque, v.modele].filter(Boolean).join(' '))}</span></div>`
        : '<span class="veh-name">Véhicule supprimé</span>';
      return `<tr>
        <td>${frDate(f.date)}</td>
        <td>${vehCell}</td>
        <td>${m ? esc(m.nom) : '<span class="muted-cell">—</span>'}</td>
        <td class="num">${nfEUR3.format(f.prix)}</td>
        <td class="num">${nfNum.format(f.litres)} L</td>
        <td class="num">${nfEUR.format(f.ht)}</td>
        <td class="num strong">${nfEUR.format(f.ttc)}</td>
        <td class="num">${nfInt.format(f.km)} km</td>
        <td class="num">${conso != null ? nfCons.format(conso) + ' L/100' : '<span class="muted-cell">—</span>'}</td>
        <td class="actions">
          <button type="button" class="link-btn" data-action="edit" data-id="${f.id}">Modifier</button>
          <button type="button" class="link-btn danger" data-action="delete" data-id="${f.id}">Supprimer</button>
        </td>
      </tr>`;
    }).join('');

    const hasFilter = Boolean(filterVehicle.value || filterMoniteur.value || filterMonth.value);
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

    renderChart(rows);
  }

  function renderAll() {
    renderVehicleOptions();
    renderMoniteurOptions();
    renderVehicles();
    renderMoniteurs();
    renderFills();
  }

  // ---------------------------------------------------------
  // Graphique : dépenses TTC par mois, empilées par véhicule
  // ---------------------------------------------------------

  // Palette catégorielle validée (daltonisme + contraste) — l'ordre des
  // couleurs est un mécanisme de lisibilité, ne pas le réordonner.
  const CHART_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
  const CHART_OTHER = '#898781';

  let lastChartRows = [];
  let chartOpen = false; // le graphique est masqué par défaut, derrière le bouton « Analyse »

  function tickStep(max) {
    const target = Math.max(max / 4, 1e-9);
    const pow = Math.pow(10, Math.floor(Math.log10(target)));
    for (const mult of [1, 2, 5, 10]) {
      const s = mult * pow;
      if (max / s <= 4.6) return s;
    }
    return 10 * pow;
  }

  function topRoundedPath(x, y, w, h, r) {
    r = Math.min(r, h, w / 2);
    return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
  }

  function renderChart(rows) {
    lastChartRows = rows;
    const card = $('#chart-card');
    const host = $('#chart-svg');
    const legend = $('#chart-legend');
    const tip = $('#chart-tip');
    tip.classList.add('hidden');

    if (!rows.length || !chartOpen) {
      card.classList.add('hidden');
      host.innerHTML = '';
      legend.innerHTML = '';
      return;
    }
    card.classList.remove('hidden');

    // La couleur suit le véhicule (ordre de création), jamais son rang dans le
    // filtre : filtrer ne repeint pas les séries restantes.
    const order = [...state.vehicles].sort((a, b) =>
      (a.createdAt || 0) - (b.createdAt || 0) || a.immat.localeCompare(b.immat, 'fr'));
    const slotOf = new Map(order.map((v, i) => [v.id, i]));
    const seriesKeyOf = (vid) =>
      slotOf.has(vid) && slotOf.get(vid) < CHART_COLORS.length ? vid : 'autres';

    // Agrégat mois -> série -> total TTC
    const byMonth = new Map();
    rows.forEach((f) => {
      const m = (f.date || '').slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(m) || !Number.isFinite(f.ttc)) return;
      if (!byMonth.has(m)) byMonth.set(m, new Map());
      const serie = byMonth.get(m);
      const key = seriesKeyOf(f.vehicleId);
      serie.set(key, (serie.get(key) || 0) + f.ttc);
    });
    if (!byMonth.size) { card.classList.add('hidden'); return; }

    // Mois continus du premier au dernier, limités aux 12 derniers
    const sortedMonths = [...byMonth.keys()].sort();
    let months = [];
    let [y, mo] = sortedMonths[0].split('-').map(Number);
    const lastMonth = sortedMonths[sortedMonths.length - 1];
    while (months.length <= 400) {
      const key = `${y}-${String(mo).padStart(2, '0')}`;
      months.push(key);
      if (key === lastMonth) break;
      mo++;
      if (mo > 12) { mo = 1; y++; }
    }
    const truncated = months.length > 12;
    if (truncated) months = months.slice(-12);
    $('#chart-note').classList.toggle('hidden', !truncated);

    // Séries présentes, dans l'ordre stable ; au-delà de 8 véhicules -> « Autres »
    const present = new Set();
    months.forEach((m) => (byMonth.get(m) || new Map()).forEach((_, k) => present.add(k)));
    const series = order
      .filter((v, i) => i < CHART_COLORS.length && present.has(v.id))
      .map((v) => ({ key: v.id, label: v.immat, full: vehicleLabel(v), color: CHART_COLORS[slotOf.get(v.id)] }));
    if (present.has('autres')) series.push({ key: 'autres', label: 'Autres', full: 'Autres véhicules', color: CHART_OTHER });

    // Légende (dès 2 séries ; une seule série = le titre suffit)
    legend.innerHTML = '';
    if (series.length >= 2) {
      series.forEach((s) => {
        const item = document.createElement('span');
        item.className = 'legend-item';
        item.title = s.full;
        const sw = document.createElement('span');
        sw.className = 'legend-swatch';
        sw.style.background = s.color;
        const txt = document.createElement('span');
        txt.textContent = s.label;
        item.append(sw, txt);
        legend.appendChild(item);
      });
    }

    // Géométrie
    const width = Math.max(320, Math.min(1200, host.clientWidth || 720));
    const height = 240;
    const mL = 48, mR = 6, mT = 12, mB = 26;
    const innerW = width - mL - mR;
    const innerH = height - mT - mB;
    const baseline = mT + innerH;

    const monthData = months.map((m) => {
      const values = series
        .map((s) => ({ ...s, value: (byMonth.get(m) || new Map()).get(s.key) || 0 }))
        .filter((s) => s.value > 0);
      return { month: m, values, total: values.reduce((acc, s) => acc + s.value, 0) };
    });

    const maxTotal = Math.max(...monthData.map((d) => d.total), 1);
    const step = tickStep(maxTotal);
    const yTop = Math.ceil(maxTotal / step) * step;
    const yScale = (val) => (val / yTop) * innerH;

    const bandW = innerW / months.length;
    const barW = Math.min(24, Math.max(8, bandW * 0.6));
    const GAP = 2; // écart couleur de surface entre segments empilés

    let svg = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Dépenses de carburant TTC par mois">`;

    // Grille : traits fins, unis, en retrait ; graduations arrondies
    for (let v = 0; v <= yTop + 1e-9; v += step) {
      const yy = baseline - yScale(v);
      svg += `<line x1="${mL}" y1="${yy.toFixed(1)}" x2="${width - mR}" y2="${yy.toFixed(1)}" class="${v === 0 ? 'chart-baseline' : 'chart-grid'}"/>`;
      svg += `<text x="${mL - 8}" y="${(yy + 3.5).toFixed(1)}" class="chart-tick" text-anchor="end">${v === 0 ? '0' : nfInt.format(v) + ' €'}</text>`;
    }

    // Barres empilées (segments séparés par un écart, sommet arrondi)
    monthData.forEach((d, i) => {
      const x = mL + i * bandW + (bandW - barW) / 2;
      svg += `<g class="month-g" data-i="${i}">`;
      let cum = 0;
      d.values.forEach((s, k) => {
        const isTop = k === d.values.length - 1;
        const yTopSeg = baseline - yScale(cum + s.value);
        const yBottomSeg = baseline - yScale(cum) - (k > 0 ? GAP : 0);
        cum += s.value;
        const h = yBottomSeg - yTopSeg;
        if (h < 1) return;
        svg += isTop
          ? `<path class="seg" d="${topRoundedPath(x, yTopSeg, barW, h, 4)}" fill="${s.color}"/>`
          : `<rect class="seg" x="${x.toFixed(1)}" y="${yTopSeg.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${s.color}"/>`;
      });
      svg += '</g>';

      // Étiquette de mois (une sur deux si l'espace manque, en gardant la dernière)
      if (bandW >= 34 || i % 2 === (months.length - 1) % 2) {
        svg += `<text x="${(mL + i * bandW + bandW / 2).toFixed(1)}" y="${height - 8}" class="chart-tick" text-anchor="middle">${esc(monthShort(d.month))}</text>`;
      }
    });

    // Zones de survol : une bande par mois, cible plus large que la marque
    monthData.forEach((d, i) => {
      const label = `${monthFull(d.month)} : ${d.total > 0 ? nfEUR.format(d.total) : 'aucun plein'}`;
      svg += `<rect class="month-hit" data-i="${i}" x="${(mL + i * bandW).toFixed(1)}" y="${mT}" width="${bandW.toFixed(1)}" height="${innerH}" tabindex="0" aria-label="${esc(label)}"/>`;
    });

    svg += '</svg>';
    host.innerHTML = svg;

    // Infobulle : toutes les séries du mois, la valeur d'abord (noms via textContent)
    const svgEl = host.querySelector('svg');
    const showTip = (i) => {
      const d = monthData[i];
      tip.innerHTML = '';
      const title = document.createElement('div');
      title.className = 'tip-title';
      title.textContent = monthFull(d.month);
      tip.appendChild(title);
      if (!d.values.length) {
        const none = document.createElement('div');
        none.className = 'tip-row';
        none.textContent = 'Aucun plein ce mois-ci';
        tip.appendChild(none);
      }
      d.values.forEach((s) => {
        const row = document.createElement('div');
        row.className = 'tip-row';
        const key = document.createElement('span');
        key.className = 'tip-key';
        key.style.background = s.color;
        const val = document.createElement('span');
        val.className = 'tip-value';
        val.textContent = nfEUR.format(s.value);
        const name = document.createElement('span');
        name.className = 'tip-name';
        name.textContent = s.label;
        row.append(key, val, name);
        tip.appendChild(row);
      });
      if (d.values.length > 1) {
        const row = document.createElement('div');
        row.className = 'tip-row tip-total';
        const val = document.createElement('span');
        val.className = 'tip-value';
        val.textContent = nfEUR.format(d.total);
        const name = document.createElement('span');
        name.className = 'tip-name';
        name.textContent = 'Total';
        row.append(val, name);
        tip.appendChild(row);
      }
      tip.classList.remove('hidden');
      const wrap = host.parentElement;
      const scale = svgEl.getBoundingClientRect().width / width || 1;
      const center = (mL + i * bandW + bandW / 2) * scale;
      const tw = tip.offsetWidth;
      tip.style.left = `${Math.max(4, Math.min(center - tw / 2, wrap.clientWidth - tw - 4))}px`;
      svgEl.querySelectorAll('.month-g').forEach((g) => g.classList.toggle('active', g.dataset.i === String(i)));
    };
    const hideTip = () => {
      tip.classList.add('hidden');
      svgEl.querySelectorAll('.month-g.active').forEach((g) => g.classList.remove('active'));
    };
    svgEl.querySelectorAll('.month-hit').forEach((hit) => {
      const i = Number(hit.dataset.i);
      hit.addEventListener('pointerenter', () => showTip(i));
      hit.addEventListener('focus', () => showTip(i));
      hit.addEventListener('pointerleave', hideTip);
      hit.addEventListener('blur', hideTip);
    });
  }

  const chartToggle = $('#toggle-chart');
  chartToggle.addEventListener('click', () => {
    chartOpen = !chartOpen;
    chartToggle.classList.toggle('active', chartOpen);
    chartToggle.setAttribute('aria-pressed', String(chartOpen));
    renderChart(lastChartRows);
    if (chartOpen && lastChartRows.length) {
      $('#chart-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else if (chartOpen) {
      toast('Aucun plein à analyser pour le moment.');
    }
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => renderChart(lastChartRows), 150);
  });

  // ---------------------------------------------------------
  // Exports (les lignes affichées, triées par date croissante)
  // ---------------------------------------------------------

  const EXPORT_HEADERS = ['Date', 'Immatriculation', 'Marque', 'Modèle', 'Carburant', 'Moniteur',
    'Prix au litre (€)', 'Litres', 'Total HT (€)', 'Total TTC (€)', 'Kilométrage (km)', 'Conso (L/100 km)'];

  function exportRows() {
    const consoMap = buildConsoMap();
    return filteredFills()
      .slice()
      .reverse() // ordre chronologique pour l'export
      .map((f) => {
        const v = vehicleById(f.vehicleId) || {};
        const m = f.moniteurId ? moniteurById(f.moniteurId) : null;
        const conso = consoMap.get(f.id);
        return {
          date: f.date,
          immat: v.immat || '',
          marque: v.marque || '',
          modele: v.modele || '',
          carburant: v.carburant || '',
          moniteur: m ? m.nom : '',
          prix: f.prix,
          litres: f.litres,
          ht: f.ht,
          ttc: f.ttc,
          km: f.km,
          conso: conso != null ? Math.round(conso * 100) / 100 : null,
        };
      });
  }

  function exportFilename(ext) {
    const parts = ['suivi-carburant'];
    const v = filterVehicle.value ? vehicleById(filterVehicle.value) : null;
    if (v) parts.push(v.immat.replace(/[^\wÀ-ÿ-]+/g, '-'));
    const m = filterMoniteur.value ? moniteurById(filterMoniteur.value) : null;
    if (m) parts.push(m.nom.replace(/[^\wÀ-ÿ-]+/g, '-'));
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
        frDate(r.date), csvText(r.immat), csvText(r.marque), csvText(r.modele), csvText(r.carburant), csvText(r.moniteur),
        csvNum(r.prix), csvNum(r.litres), csvNum(r.ht), csvNum(r.ttc), csvNum(r.km), csvNum(r.conso),
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

  const COL_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

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
      [12, 18, 15, 15, 12, 18, 16, 10, 14, 14, 16, 16]
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
        str(4, rowNum, r.carburant) +
        str(5, rowNum, r.moniteur) +
        num(6, rowNum, r.prix, 4) +   // 0.000
        num(7, rowNum, r.litres, 3) + // 0.00
        num(8, rowNum, r.ht, 3) +
        num(9, rowNum, r.ttc, 3) +
        num(10, rowNum, r.km) +
        num(11, rowNum, r.conso, 3) +
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
  // Sauvegarde / restauration complète (fichier JSON)
  // ---------------------------------------------------------

  $('#backup-save').addEventListener('click', () => {
    const payload = {
      app: 'hellopermis-carburant',
      version: 1,
      exportedAt: new Date().toISOString(),
      vehicles: state.vehicles,
      moniteurs: state.moniteurs,
      fills: state.fills,
      settings: state.settings,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    download(`sauvegarde-carburant_${todayISO()}.json`, blob);
    toast('💾 Sauvegarde téléchargée. Conservez ce fichier précieusement.');
  });

  $('#backup-restore').addEventListener('click', () => $('#backup-file').click());

  $('#backup-file').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    file.text().then((text) => {
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.vehicles) || !Array.isArray(data.fills)) throw new Error('format');
      const moniteurs = Array.isArray(data.moniteurs) ? data.moniteurs : [];
      const ok = confirm(
        'Restaurer cette sauvegarde ?\n\n' +
        `${data.vehicles.length} véhicule(s) · ${moniteurs.length} moniteur(s) · ${data.fills.length} plein(s)\n\n` +
        '⚠️ Les données actuelles de ce navigateur seront remplacées.');
      if (!ok) return;
      state.vehicles = data.vehicles;
      state.moniteurs = moniteurs;
      state.fills = data.fills;
      state.settings = Object.assign({ tva: 20 }, data.settings);
      saveState();
      resetVehicleForm();
      resetMoniteurForm();
      resetFillForm();
      tvaInput.value = state.settings.tva;
      renderAll();
      toast('♻️ Données restaurées.');
    }).catch(() => toast('⚠️ Fichier de sauvegarde invalide.'));
  });

  // ---------------------------------------------------------
  // Initialisation
  // ---------------------------------------------------------

  $('#fill-date').value = todayISO();
  tvaInput.value = state.settings.tva;
  renderAll();
})();
