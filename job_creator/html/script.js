/* ============================================================
   Job Creator - lógica del panel NUI (vanilla JS)

   Trabajamos con un "modelo de editor" plano (fácil de mapear a inputs)
   y convertimos a/desde la forma que entiende el servidor al cargar/guardar.
   El servidor manda/recibe coords como {x,y,z} (JSON-friendly).
   ============================================================ */

const RESOURCE = (typeof GetParentResourceName === 'function')
    ? GetParentResourceName() : 'job_creator';

// Sprites de blip más usados (el nº sigue siendo editable a mano).
// El catálogo de blips (sprite -> imagen + nombre verificado) vive más abajo,
// junto al selector visual: `const BLIP_SPRITES = { ... }`.

// Animaciones de uso común para los steps (dict + clip).
const ANIM_PRESETS = [
    { label: 'Cavar / jardinería', dict: 'amb@world_human_gardener_plant@male@base', clip: 'base' },
    { label: 'Reparar (agachado)', dict: 'mini@repair', clip: 'fixing_a_player' },
    { label: 'Mecánico bajo capó', dict: 'amb@world_human_vehicle_mechanic@male@base', clip: 'base' },
    { label: 'Registrar / dar-tomar', dict: 'mp_common', clip: 'givetake1_a' },
    { label: 'Tablet / escribir', dict: 'amb@world_human_seat_wall_tablet@female@base', clip: 'base' },
    { label: 'Teléfono (leer)', dict: 'cellphone@', clip: 'cellphone_text_read_base' },
    { label: 'Recoger del suelo', dict: 'anim@mp_snowball', clip: 'pickup_snowball' },
    { label: 'Limpiar / barrer', dict: 'amb@world_human_maid_clean@base', clip: 'base' },
    { label: 'Cargar caja (idle)', dict: 'anim@heists@box_carry@', clip: 'idle' },
    { label: 'Soldar', dict: 'amb@world_human_welding@male@base', clip: 'base' },
    { label: 'Beber café', dict: 'amb@world_human_drinking@coffee@male@idle_a', clip: 'idle_c' },
    { label: 'Manos arriba', dict: 'random@arrests@busted', clip: 'idle_a' },
];

// Iconos FontAwesome comunes para los targets.
const ICONS = [
    'fa-solid fa-hand', 'fa-solid fa-box', 'fa-solid fa-boxes-stacked', 'fa-solid fa-truck',
    'fa-solid fa-trash', 'fa-solid fa-dumpster', 'fa-solid fa-recycle', 'fa-solid fa-broom',
    'fa-solid fa-wrench', 'fa-solid fa-screwdriver-wrench', 'fa-solid fa-hammer', 'fa-solid fa-toolbox',
    'fa-solid fa-car', 'fa-solid fa-gas-pump', 'fa-solid fa-key', 'fa-solid fa-warehouse',
    'fa-solid fa-leaf', 'fa-solid fa-seedling', 'fa-solid fa-tractor', 'fa-solid fa-fish',
    'fa-solid fa-cart-shopping', 'fa-solid fa-cash-register', 'fa-solid fa-money-bill', 'fa-solid fa-hand-holding-dollar',
    'fa-solid fa-shirt', 'fa-solid fa-user', 'fa-solid fa-users', 'fa-solid fa-briefcase',
    'fa-solid fa-clipboard', 'fa-solid fa-clipboard-check', 'fa-solid fa-door-open', 'fa-solid fa-utensils',
    'fa-solid fa-mug-hot', 'fa-solid fa-shield-halved', 'fa-solid fa-handcuffs', 'fa-solid fa-gun',
    'fa-solid fa-kit-medical', 'fa-solid fa-stethoscope', 'fa-solid fa-fire', 'fa-solid fa-bolt',
    'fa-solid fa-gear', 'fa-solid fa-magnifying-glass', 'fa-solid fa-location-dot', 'fa-solid fa-flag',
    'fa-solid fa-star', 'fa-solid fa-circle-info', 'fa-solid fa-phone', 'fa-solid fa-bell',
    'fa-solid fa-paint-roller', 'fa-solid fa-bag-shopping', 'fa-solid fa-fingerprint', 'fa-solid fa-camera',
];

// Colores de blip (índice FiveM -> hex aproximado para el picker).
const BLIP_COLORS = [
    { i: 0, hex: '#bfc4cc', name: 'Blanco' },
    { i: 1, hex: '#e23b3b', name: 'Rojo' },
    { i: 2, hex: '#5cb85c', name: 'Verde' },
    { i: 3, hex: '#4aa3e0', name: 'Azul claro' },
    { i: 5, hex: '#f0d54a', name: 'Amarillo' },
    { i: 17, hex: '#e08a3b', name: 'Naranja' },
    { i: 8, hex: '#e26ab5', name: 'Rosa' },
    { i: 27, hex: '#7ad6e0', name: 'Cian' },
    { i: 38, hex: '#2f6fd1', name: 'Azul' },
    { i: 48, hex: '#3bb0a8', name: 'Turquesa' },
    { i: 46, hex: '#9b6ad6', name: 'Morado' },
    { i: 6, hex: '#7e2fd1', name: 'Púrpura' },
    { i: 50, hex: '#b8e04a', name: 'Lima' },
    { i: 40, hex: '#8a8f99', name: 'Gris' },
    { i: 25, hex: '#15191f', name: 'Negro' },
];

const state = {
    jobs: [],        // modelos de editor
    settings: {},
    items: [],       // nombres de items para autocompletar (del inventario)
    stats: {},       // { [jobName]: { employees, onduty } } en vivo
    selected: -1,
    editorSection: 'general', // sección/página activa dentro del editor (no scroll infinito)
    filter: '',      // texto del buscador de la barra lateral
    dirty: false,    // hay cambios sin guardar en la sesión del panel
    pendingPlace: null, // campos a rellenar tras colocar un punto en el mundo
};

// ============================================================
//  i18n (idioma del panel) — el español es el respaldo por defecto
// ============================================================
let LANG = 'es';
const I18N = {
    es: {
        'tab.jobs': 'Jobs', 'tab.settings': 'Ajustes',
        'side.new': '+ Nuevo job', 'side.template': '📋 Desde plantilla', 'side.import': '⇪ Importar JSON',
        'side.backup': '⬇ Backup', 'side.restore': '⬆ Restaurar', 'side.searchPh': 'Buscar job…',
        'stats.legend': '👥 empleados · 🟢 en servicio',
        'foot.validate': '🔍 Validar', 'foot.duplicate': 'Duplicar', 'foot.export': 'Exportar JSON',
        'foot.save': 'Guardar job', 'foot.delete': 'Eliminar job',
        'set.title': 'Ajustes globales',
        'set.debug': 'Modo debug (zonas de target visibles + prints extra)',
        'set.markers': 'Mostrar marcadores al acercarse a las zonas',
        'set.syncranks': 'Rangos: job_creator manda (sincroniza a ESX al guardar)',
        'set.payint': 'Intervalo de pago por defecto (ms)',
        'set.interact': 'Modo de interacción',
        'set.accent': 'Color de acento del panel (se guarda en este equipo)',
        'set.lang': 'Idioma del panel', 'set.save': 'Guardar ajustes',
        'set.providers': 'Proveedores (requiere reiniciar el recurso)',
        'set.society': 'Caja de empresa (sociedad)',
        'set.society.internal': 'Interna (job_creator)', 'set.society.esx': 'esx_society (compartida ESX)',
        'empty': 'Selecciona un job de la izquierda o crea uno nuevo.',
        'ov.edit': 'Editar', 'ov.enable': 'Activar', 'ov.disable': 'Desactivar', 'ed.back': '← Volver',
        'eg.core': 'Básicos', 'eg.zones': 'Puntos y zonas', 'eg.work': 'Trabajo y economía',
        'sec.general': 'General', 'gen.active': 'Activo',
        'sec.blip': 'Blip del mapa', 'tg.blip': 'Mostrar blip',
        'sec.req': 'Requisitos (opcional)',
        'sec.duty': 'Duty (servicio)', 'tg.duty': 'Tiene punto de servicio',
        'sec.stash': 'Cofre de servicio (stash)', 'tg.stash': 'Tiene cofre',
        'sec.wardrobe': 'Vestuario (wardrobe)', 'tg.wardrobe': 'Tiene vestuario',
        'sec.garage': 'Garaje (vehículos)', 'tg.garage': 'Tiene garaje',
        'sec.boss': 'Jefe (gestión de empleados)', 'tg.boss': 'Tiene punto de jefe',
        'sec.grades': 'Grados y salarios', 'sec.steps': 'Steps (pasos)', 'gr.import': '⬇ Importar de ESX',
        'sec.locker': 'Armería / taquilla', 'tg.locker': 'Tiene taquilla',
        'lk.label': 'Etiqueta', 'lk.requireDuty': 'Requiere servicio',
        'lk.items': 'Items de la taquilla', 'lk.item': 'Item', 'lk.itemLabel': 'Etiqueta',
        'lk.amount': 'Cantidad/retiro', 'lk.limit': 'Límite (0 = sin límite)', 'lk.minGrade': 'Grado mín.',
        'st.minGrade': 'Grado mínimo (0 = ninguno)',
        'lk.hint': 'Los empleados sacan estos items. "Cantidad/retiro" es lo que dan por uso; "Límite" es el máximo que puedes tener (0 = sin tope). Ideal para armería: arma, chaleco, comida…',
        'sec.actions': 'Acciones', 'act.player': 'Acciones sobre jugadores', 'act.vehicle': 'Acciones sobre vehículos',
        'act.event': 'Evento extra (opcional)',
        'act.item': 'Item requerido (opcional)', 'act.consume': 'Consumir item al usar',
        'act.hint': 'Marca las acciones que permite este job (en servicio). Casi todas YA funcionan: esposar, arrastrar, cargar, derribar, multar, revivir, curar, meter/sacar del coche, reparar, limpiar, forzar e incautar. Solo "Cachear" necesita tu sistema de inventario (ponle un evento). El evento opcional se dispara ADEMÁS de la lógica integrada, para extenderla. También: exports[\'job_creator\']:CanDoAction(\'handcuff\') y :RegisterAction(\'clave\', def) para añadir las tuyas.',
        'sec.society': 'Sociedad / empresa', 'tg.society': 'Usa caja de empresa',
        'soc.salary': 'Pagar salarios desde la caja', 'soc.rewards': 'Pagar recompensas desde la caja',
        'soc.hint': 'Si está activo, los salarios y/o el dinero de los steps salen de la caja de la empresa. El jefe ingresa/retira fondos desde su punto de gestión. Si la caja se queda sin dinero, no se paga.',
    },
    en: {
        'tab.jobs': 'Jobs', 'tab.settings': 'Settings',
        'side.new': '+ New job', 'side.template': '📋 From template', 'side.import': '⇪ Import JSON',
        'side.backup': '⬇ Backup', 'side.restore': '⬆ Restore', 'side.searchPh': 'Search job…',
        'stats.legend': '👥 employees · 🟢 on duty',
        'foot.validate': '🔍 Validate', 'foot.duplicate': 'Duplicate', 'foot.export': 'Export JSON',
        'foot.save': 'Save job', 'foot.delete': 'Delete job',
        'set.title': 'Global settings',
        'set.debug': 'Debug mode (visible target zones + extra prints)',
        'set.markers': 'Show markers when near zones',
        'set.syncranks': 'Ranks: job_creator wins (sync to ESX on save)',
        'set.payint': 'Default pay interval (ms)',
        'set.interact': 'Interaction mode',
        'set.accent': 'Panel accent color (saved on this device)',
        'set.lang': 'Panel language', 'set.save': 'Save settings',
        'set.providers': 'Providers (requires resource restart)',
        'set.society': 'Company funds (society)',
        'set.society.internal': 'Internal (job_creator)', 'set.society.esx': 'esx_society (shared ESX)',
        'empty': 'Select a job on the left or create a new one.',
        'ov.edit': 'Edit', 'ov.enable': 'Enable', 'ov.disable': 'Disable', 'ed.back': '← Back',
        'eg.core': 'Basics', 'eg.zones': 'Points & zones', 'eg.work': 'Work & economy',
        'sec.general': 'General', 'gen.active': 'Active',
        'sec.blip': 'Map blip', 'tg.blip': 'Show blip',
        'sec.req': 'Requirements (optional)',
        'sec.duty': 'Duty (service)', 'tg.duty': 'Has service point',
        'sec.stash': 'Service stash', 'tg.stash': 'Has stash',
        'sec.wardrobe': 'Wardrobe', 'tg.wardrobe': 'Has wardrobe',
        'sec.garage': 'Garage (vehicles)', 'tg.garage': 'Has garage',
        'sec.boss': 'Boss (employee management)', 'tg.boss': 'Has boss point',
        'sec.grades': 'Grades & salaries', 'sec.steps': 'Steps', 'gr.import': '⬇ Import from ESX',
        'sec.locker': 'Armory / locker', 'tg.locker': 'Has locker',
        'lk.label': 'Label', 'lk.requireDuty': 'Requires duty',
        'lk.items': 'Locker items', 'lk.item': 'Item', 'lk.itemLabel': 'Label',
        'lk.amount': 'Amount/take', 'lk.limit': 'Limit (0 = no limit)', 'lk.minGrade': 'Min grade',
        'st.minGrade': 'Minimum grade (0 = none)',
        'lk.hint': 'Employees take these items. "Amount/take" is what each use gives; "Limit" is the max you can hold (0 = no cap). Great for an armory: weapon, vest, food…',
        'sec.actions': 'Actions', 'act.player': 'Player actions', 'act.vehicle': 'Vehicle actions',
        'act.event': 'Extra event (optional)',
        'act.item': 'Required item (optional)', 'act.consume': 'Consume item on use',
        'act.hint': 'Toggle the actions this job allows (while on duty). Almost all WORK out of the box: handcuff, drag, carry, tackle, bill, revive, heal, put/take out of vehicle, repair, clean, hijack and impound. Only "Search" needs your own inventory system (set an event). The optional event fires IN ADDITION to the built-in logic, to extend it. Also: exports[\'job_creator\']:CanDoAction(\'handcuff\') and :RegisterAction(\'key\', def) to add your own.',
        'sec.society': 'Society / company', 'tg.society': 'Use company funds',
        'soc.salary': 'Pay salaries from funds', 'soc.rewards': 'Pay rewards from funds',
        'soc.hint': 'If enabled, salaries and/or step money come from the company funds. The boss deposits/withdraws at the management point. If the funds run out, no payment is made.',
    },
};

// t(key) -> traducción; si falta, cae al español; si tampoco, a la propia clave.
function t(key) {
    if (I18N[LANG] && I18N[LANG][key] !== undefined) return I18N[LANG][key];
    if (I18N.es[key] !== undefined) return I18N.es[key];
    return key;
}

// Aplica i18n a los elementos estáticos del HTML (data-i18n / data-i18n-ph).
function applyStaticI18n() {
    document.querySelectorAll('[data-i18n]').forEach((e) => { e.textContent = t(e.dataset.i18n); });
    document.querySelectorAll('[data-i18n-ph]').forEach((e) => { e.placeholder = t(e.dataset.i18nPh); });
}

function loadLang() {
    try { LANG = localStorage.getItem('jc_lang') || 'es'; } catch (e) { LANG = 'es'; }
    return LANG;
}
function setLang(lang) {
    LANG = lang;
    try { localStorage.setItem('jc_lang', lang); } catch (e) { /* */ }
    applyStaticI18n();
    renderSidebar();
    if (state.selected >= 0) renderEditor();
}

// ---------- Comunicación con el cliente Lua ----------
async function nui(cb, data) {
    try {
        const res = await fetch(`https://${RESOURCE}/${cb}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=UTF-8' },
            body: JSON.stringify(data || {}),
        });
        return await res.json();
    } catch (e) {
        return {};
    }
}

// ============================================================
//  Toasts (notificaciones internas, no bloqueantes)
// ============================================================
function toast(msg, type) {
    const c = document.getElementById('toasts');
    if (!c) return;
    const t = el('div', 'toast ' + (type || 'info'));
    t.textContent = msg; // textContent: evita inyección si el msg trae nombres de job
    c.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
        t.classList.remove('show');
        setTimeout(() => t.remove(), 260);
    }, 3200);
}

// ============================================================
//  Modal genérico (confirmaciones + import/export)
// ============================================================
let _onDismiss = null; // se llama al cerrar con ✕ / Escape / click fuera

function openModal(title, bodyEl, actions, onDismiss) {
    _onDismiss = onDismiss || null;
    document.getElementById('modalTitle').textContent = title;
    const body = document.getElementById('modalBody');
    body.innerHTML = '';
    body.appendChild(bodyEl);
    const foot = document.getElementById('modalFoot');
    foot.innerHTML = '';
    actions.forEach((a) => {
        const b = el('button', 'btn ' + (a.cls || ''), a.label);
        b.type = 'button';
        b.addEventListener('click', a.onClick);
        foot.appendChild(b);
    });
    document.getElementById('modalBackdrop').classList.remove('hidden');
}

function closeModalRaw() {
    document.getElementById('modalBackdrop').classList.add('hidden');
    _onDismiss = null;
}

// Cierre por ✕ / Escape / click fuera: respeta el callback de descarte.
function dismissModal() {
    if (_onDismiss) { const d = _onDismiss; _onDismiss = null; closeModalRaw(); d(); }
    else closeModalRaw();
}

function isModalOpen() {
    return !document.getElementById('modalBackdrop').classList.contains('hidden');
}

// Confirmación con promesa (reemplazo de confirm()).
function confirmModal(message, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
        let done = false;
        const finish = (v) => { if (done) return; done = true; closeModalRaw(); resolve(v); };
        const body = el('p', 'modal-text');
        body.textContent = message;
        openModal(opts.title || 'Confirmar', body, [
            { label: opts.cancelLabel || 'Cancelar', cls: 'ghost', onClick: () => finish(false) },
            { label: opts.okLabel || 'Aceptar', cls: opts.danger ? 'danger' : 'primary', onClick: () => finish(true) },
        ], () => finish(false));
    });
}

// ---------- Conversión servidor <-> editor ----------
function num(v, d) { const n = parseFloat(v); return isNaN(n) ? (d || 0) : n; }

// Campos que SÍ edita el panel. El resto (vehicles, boss, ...) se preserva
// intacto para no perderlo al guardar (passthrough vía _extra).
const EDITED_KEYS = ['name', 'label', 'type', 'enabled', 'blip', 'requirements', 'duty', 'stash', 'wardrobe', 'locker', 'steps', 'garage', 'boss', 'grades', 'society', 'actions'];

// Acciones de rol (estilo "Actions"): toggles con icono. La lógica la pones tú
// vía el evento que indiques; el job solo declara qué permite.
const ACTIONS = [
    { key: 'handcuff', label: 'Esposar', desc: 'Esposar a jugadores', icon: 'fa-solid fa-handcuffs', type: 'player' },
    { key: 'drag', label: 'Arrastrar', desc: 'Llevar a esposados', icon: 'fa-solid fa-hand-point-right', type: 'player' },
    { key: 'search', label: 'Cachear', desc: 'Registrar a otros', icon: 'fa-solid fa-magnifying-glass', type: 'player' },
    { key: 'carry', label: 'Cargar', desc: 'Llevar en brazos', icon: 'fa-solid fa-person-walking', type: 'player' },
    { key: 'tackle', label: 'Placar', desc: 'Derribar al suelo', icon: 'fa-solid fa-person-falling-burst', type: 'player' },
    { key: 'bill', label: 'Multar', desc: 'Cobrar multas', icon: 'fa-solid fa-file-invoice-dollar', type: 'player' },
    { key: 'revive', label: 'Revivir', desc: 'Revivir jugadores', icon: 'fa-solid fa-heart-pulse', type: 'player' },
    { key: 'heal', label: 'Curar', desc: 'Curar jugadores', icon: 'fa-solid fa-briefcase-medical', type: 'player' },
    { key: 'putInVehicle', label: 'Meter al vehículo', desc: 'Apunta al vehículo y mete al detenido (asiento trasero)', icon: 'fa-solid fa-car-side', type: 'vehicle' },
    { key: 'takeOutVehicle', label: 'Sacar del vehículo', desc: 'Apunta al vehículo y saca al ocupante', icon: 'fa-solid fa-door-open', type: 'vehicle' },
    { key: 'hijack', label: 'Forzar (hijack)', desc: 'Forzar un vehículo', icon: 'fa-solid fa-screwdriver', type: 'vehicle' },
    { key: 'repair', label: 'Reparar', desc: 'Reparar vehículos', icon: 'fa-solid fa-wrench', type: 'vehicle' },
    { key: 'clean', label: 'Limpiar', desc: 'Limpiar vehículos', icon: 'fa-solid fa-spray-can-sparkles', type: 'vehicle' },
    { key: 'impound', label: 'Incautar', desc: 'Incautar vehículos', icon: 'fa-solid fa-truck-ramp-box', type: 'vehicle' },
];

function actionsToEditor(a) {
    a = a || {};
    const out = {};
    ACTIONS.forEach((def) => {
        const m = a[def.key];
        out[def.key] = {
            enabled: !!m,
            event: (m && m.event) || '',
            item: (m && m.item) || '',
            consume: !!(m && m.consume),
        };
    });
    return out;
}

// ---------- Stations: servidor -> editor ----------
function dutyToEditor(d) {
    d = d || {}; const c = d.coords || {}, s = d.size || {};
    return {
        x: c.x || 0, y: c.y || 0, z: c.z || 0,
        sx: s.x || 1.6, sy: s.y || 1.6, sz: s.z || 2.0,
        labelOff: d.labelOff || '', labelOn: d.labelOn || '',
        blip: stationBlipToEditor(d.blip, 1),
    };
}
function stashToEditor(s2) {
    s2 = s2 || {}; const c = s2.coords || {}, s = s2.size || {};
    return {
        x: c.x || 0, y: c.y || 0, z: c.z || 0,
        sx: s.x || 1.6, sy: s.y || 1.6, sz: s.z || 2.0,
        id: s2.id || '', label: s2.label || '',
        slots: s2.slots || 50, weight: s2.weight || 100000,
        requireDuty: s2.requireDuty !== false,
        blip: stationBlipToEditor(s2.blip, 1),
    };
}
function wardrobeToEditor(w) {
    w = w || {}; const c = w.coords || {}, s = w.size || {};
    return {
        x: c.x || 0, y: c.y || 0, z: c.z || 0,
        sx: s.x || 1.6, sy: s.y || 1.6, sz: s.z || 2.0,
        label: w.label || '', requireDuty: w.requireDuty === true,
        outfits: (w.outfits || []).map(outfitToEditor),
        blip: stationBlipToEditor(w.blip, 73), // ropa
    };
}
function outfitToEditor(o) {
    o = o || {};
    const comps = [];
    if (o.components) Object.keys(o.components).forEach((id) => {
        const c = o.components[id];
        if (!c) return; // ignora huecos null (tablas Lua con claves enteras no contiguas)
        comps.push({ component: parseInt(id), drawable: c.drawable || 0, texture: c.texture || 0 });
    });
    const props = [];
    if (o.props) Object.keys(o.props).forEach((id) => {
        const p = o.props[id];
        if (!p) return;
        props.push({ prop: parseInt(id), drawable: p.drawable || 0, texture: p.texture || 0 });
    });
    return { label: o.label || '', civilian: !!o.civilian, components: comps, props: props };
}

function garageToEditor(g) {
    g = g || {}; const c = g.coords || {}, s = g.size || {}, sp = g.spawn || {};
    return {
        x: c.x || 0, y: c.y || 0, z: c.z || 0,
        sx: s.x || 3.0, sy: s.y || 3.0, sz: s.z || 2.0,
        label: g.label || '', requireDuty: g.requireDuty === true,
        spx: sp.x || 0, spy: sp.y || 0, spz: sp.z || 0, sph: sp.h || 0,
        vehicles: (g.vehicles || []).map((v) => ({ model: v.model || '', label: v.label || '' })),
        blip: stationBlipToEditor(g.blip, 357), // garaje
    };
}
function bossToEditor(b) {
    b = b || {}; const c = b.coords || {}, s = b.size || {};
    return {
        x: c.x || 0, y: c.y || 0, z: c.z || 0,
        sx: s.x || 1.6, sy: s.y || 1.6, sz: s.z || 2.0,
        label: b.label || '',
        blip: stationBlipToEditor(b.blip, 1),
    };
}
function lockerToEditor(l) {
    l = l || {}; const c = l.coords || {}, s = l.size || {};
    return {
        x: c.x || 0, y: c.y || 0, z: c.z || 0,
        sx: s.x || 1.6, sy: s.y || 1.6, sz: s.z || 2.0,
        label: l.label || '', requireDuty: l.requireDuty !== false,
        items: (l.items || []).map((i) => ({ name: i.name || '', label: i.label || '', amount: i.amount || 1, limit: i.limit || 0, minGrade: i.minGrade || 0 })),
        blip: stationBlipToEditor(l.blip, 110), // armería
    };
}

// ---------- Blip por estación (opcional, se dibuja en sus coords) ----------
// defSprite: sprite por defecto al activarlo (cuando la estación no tenía blip).
function stationBlipToEditor(b, defSprite) {
    return {
        enabled: !!b,
        sprite: b ? (b.sprite || 1) : (defSprite || 1),
        color: b ? (b.color || 0) : 0,
        scale: b ? (b.scale || 0.7) : 0.7,
        label: b ? (b.label || '') : '',
    };
}
function stationBlipToServer(b) {
    return {
        sprite: num(b.sprite, 1),
        color: num(b.color, 0),
        scale: num(b.scale, 0.7),
        label: (b.label || '').trim() || undefined,
    };
}

// ---------- Stations: editor -> servidor ----------
function vec3obj(o) { return { x: num(o.x), y: num(o.y), z: num(o.z) }; }
function sizeObj(o) { return { x: num(o.sx, 1.6), y: num(o.sy, 1.6), z: num(o.sz, 2.0) }; }
function outfitToServer(o) {
    const out = { label: o.label.trim() || 'Conjunto' };
    if (o.civilian) { out.civilian = true; return out; }
    const comps = {};
    o.components.filter((c) => c.component !== '' && c.component != null)
        .forEach((c) => { comps[num(c.component)] = { drawable: num(c.drawable), texture: num(c.texture) }; });
    if (Object.keys(comps).length) out.components = comps;
    const props = {};
    o.props.filter((p) => p.prop !== '' && p.prop != null)
        .forEach((p) => { props[num(p.prop)] = { drawable: num(p.drawable), texture: num(p.texture) }; });
    if (Object.keys(props).length) out.props = props;
    return out;
}

function toEditor(job) {
    const blip = job.blip || null;
    const req = job.requirements || {};
    let reqJobName = '', reqJobGrade = 0;
    if (typeof req.job === 'string') reqJobName = req.job;
    else if (req.job && typeof req.job === 'object') { reqJobName = req.job.name || ''; reqJobGrade = req.job.grade || 0; }

    const extra = {};
    Object.keys(job).forEach((k) => { if (!EDITED_KEYS.includes(k)) extra[k] = job[k]; });

    return {
        _extra: extra,
        name: job.name || '',
        label: job.label || '',
        enabled: job.enabled !== false, // por defecto activo
        hasBlip: !!blip,
        blip: {
            x: blip && blip.coords ? blip.coords.x : 0,
            y: blip && blip.coords ? blip.coords.y : 0,
            z: blip && blip.coords ? blip.coords.z : 0,
            sprite: blip ? (blip.sprite || 1) : 1,
            color: blip ? (blip.color || 0) : 0,
            scale: blip ? (blip.scale || 0.8) : 0.8,
            label: blip ? (blip.label || '') : '',
        },
        req: { jobName: reqJobName, jobGrade: reqJobGrade, item: req.item || '' },
        steps: (job.steps || []).map((s) => {
            const t = s.target || {};
            const c = t.coords || {}, sz = t.size || {};
            const money = (s.reward && s.reward.money) || null;
            return {
                id: s.id || '',
                label: s.label || '',
                tx: c.x || 0, ty: c.y || 0, tz: c.z || 0,
                sx: sz.x || 2.0, sy: sz.y || 2.0, sz: sz.z || 2.0,
                icon: t.icon || '', tlabel: t.label || '',
                progDuration: s.progress ? (s.progress.duration || 0) : 0,
                progLabel: s.progress ? (s.progress.label || '') : '',
                cooldown: s.cooldown || 0,
                minGrade: s.minGrade || 0,
                animDict: s.anim ? (s.anim.dict || '') : '',
                animClip: s.anim ? (s.anim.clip || '') : '',
                requires: (s.requires || []).map((r) => ({ name: r.name || '', count: r.count || 1 })),
                rewardItems: (s.reward && s.reward.items || []).map((r) => ({ name: r.name || '', min: r.min || 1, max: r.max || r.min || 1 })),
                money: {
                    enabled: !!money,
                    min: money ? (money.min || 0) : 0,
                    max: money ? (money.max || money.min || 0) : 0,
                    account: money ? (money.account || 'cash') : 'cash',
                },
            };
        }),
        type: job.type || '',
        hasDuty: !!job.duty,
        duty: dutyToEditor(job.duty),
        hasStash: !!job.stash,
        stash: stashToEditor(job.stash),
        hasWardrobe: !!job.wardrobe,
        wardrobe: wardrobeToEditor(job.wardrobe),
        hasLocker: !!job.locker,
        locker: lockerToEditor(job.locker),
        hasGarage: !!job.garage,
        garage: garageToEditor(job.garage),
        hasBoss: !!job.boss,
        boss: bossToEditor(job.boss),
        grades: (job.grades || []).map((g) => ({ grade: g.grade || 0, name: g.name || '', salary: g.salary || 0 })),
        society: {
            enabled: !!(job.society && job.society.enabled),
            salaryFromFund: job.society ? job.society.salaryFromFund !== false : true,
            rewardsFromFund: job.society ? job.society.rewardsFromFund !== false : true,
        },
        actions: actionsToEditor(job.actions),
    };
}

function toServer(ed) {
    const job = { name: ed.name.trim(), label: ed.label.trim(), enabled: ed.enabled !== false };

    if (ed.hasBlip) {
        job.blip = {
            coords: { x: num(ed.blip.x), y: num(ed.blip.y), z: num(ed.blip.z) },
            sprite: num(ed.blip.sprite, 1),
            color: num(ed.blip.color, 0),
            scale: num(ed.blip.scale, 0.8),
            label: ed.blip.label.trim() || undefined,
        };
    }

    job.requirements = {};
    if (ed.req.jobName.trim()) {
        job.requirements.job = { name: ed.req.jobName.trim(), grade: num(ed.req.jobGrade, 0) };
    }
    if (ed.req.item.trim()) job.requirements.item = ed.req.item.trim();

    job.steps = ed.steps.map((s) => {
        const step = {
            id: s.id.trim(),
            label: s.label.trim(),
            target: {
                coords: { x: num(s.tx), y: num(s.ty), z: num(s.tz) },
                size: { x: num(s.sx, 2), y: num(s.sy, 2), z: num(s.sz, 2) },
                icon: s.icon.trim() || undefined,
                label: s.tlabel.trim() || undefined,
            },
        };
        if (num(s.progDuration) > 0) {
            step.progress = { duration: num(s.progDuration), label: s.progLabel.trim() || undefined };
        }
        if (num(s.cooldown) > 0) step.cooldown = num(s.cooldown);
        if (num(s.minGrade) > 0) step.minGrade = num(s.minGrade);
        if (s.animDict.trim()) {
            step.anim = { dict: s.animDict.trim(), clip: s.animClip.trim() };
        }
        const reqs = s.requires.filter((r) => r.name.trim()).map((r) => ({ name: r.name.trim(), count: num(r.count, 1) }));
        if (reqs.length) step.requires = reqs;

        const reward = {};
        const items = s.rewardItems.filter((r) => r.name.trim()).map((r) => ({ name: r.name.trim(), min: num(r.min, 1), max: num(r.max, 1) }));
        if (items.length) reward.items = items;
        if (s.money.enabled) {
            reward.money = { min: num(s.money.min), max: num(s.money.max), account: s.money.account || 'cash' };
        }
        if (Object.keys(reward).length) step.reward = reward;

        return step;
    });

    // Stations (jobs de servicio)
    if (ed.hasDuty) {
        job.duty = {
            coords: vec3obj(ed.duty), size: sizeObj(ed.duty),
            labelOff: ed.duty.labelOff.trim() || undefined,
            labelOn: ed.duty.labelOn.trim() || undefined,
        };
        if (ed.duty.blip && ed.duty.blip.enabled) job.duty.blip = stationBlipToServer(ed.duty.blip);
    }
    if (ed.hasStash) {
        job.stash = {
            coords: vec3obj(ed.stash), size: sizeObj(ed.stash),
            id: ed.stash.id.trim() || undefined,
            label: ed.stash.label.trim() || undefined,
            slots: num(ed.stash.slots, 50),
            weight: num(ed.stash.weight, 100000),
            requireDuty: ed.stash.requireDuty,
        };
        if (ed.stash.blip && ed.stash.blip.enabled) job.stash.blip = stationBlipToServer(ed.stash.blip);
    }
    if (ed.hasWardrobe) {
        job.wardrobe = {
            coords: vec3obj(ed.wardrobe), size: sizeObj(ed.wardrobe),
            label: ed.wardrobe.label.trim() || undefined,
            requireDuty: ed.wardrobe.requireDuty,
            outfits: ed.wardrobe.outfits.map(outfitToServer),
        };
        if (ed.wardrobe.blip && ed.wardrobe.blip.enabled) job.wardrobe.blip = stationBlipToServer(ed.wardrobe.blip);
    }

    if (ed.hasLocker) {
        const items = ed.locker.items.filter((i) => i.name.trim())
            .map((i) => ({ name: i.name.trim(), label: i.label.trim() || i.name.trim(), amount: num(i.amount, 1), limit: num(i.limit, 0), minGrade: num(i.minGrade, 0) }));
        job.locker = {
            coords: vec3obj(ed.locker), size: sizeObj(ed.locker),
            label: ed.locker.label.trim() || undefined,
            requireDuty: ed.locker.requireDuty,
            items: items,
        };
        if (ed.locker.blip && ed.locker.blip.enabled) job.locker.blip = stationBlipToServer(ed.locker.blip);
    }
    if (ed.hasGarage) {
        const veh = ed.garage.vehicles.filter((v) => v.model.trim())
            .map((v) => ({ model: v.model.trim(), label: v.label.trim() || v.model.trim() }));
        job.garage = {
            coords: vec3obj(ed.garage), size: sizeObj(ed.garage),
            label: ed.garage.label.trim() || undefined,
            requireDuty: ed.garage.requireDuty,
            spawn: { x: num(ed.garage.spx), y: num(ed.garage.spy), z: num(ed.garage.spz), h: num(ed.garage.sph) },
            vehicles: veh,
        };
        if (ed.garage.blip && ed.garage.blip.enabled) job.garage.blip = stationBlipToServer(ed.garage.blip);
    }
    if (ed.hasBoss) {
        job.boss = {
            coords: vec3obj(ed.boss), size: sizeObj(ed.boss),
            label: ed.boss.label.trim() || undefined,
        };
        if (ed.boss.blip && ed.boss.blip.enabled) job.boss.blip = stationBlipToServer(ed.boss.blip);
    }
    const grades = (ed.grades || []).filter((g) => g.name.trim() || g.grade || g.salary)
        .map((g) => ({ grade: num(g.grade, 0), name: g.name.trim() || ('Grado ' + num(g.grade, 0)), salary: num(g.salary, 0) }));
    if (grades.length) job.grades = grades;

    if (ed.society && ed.society.enabled) {
        job.society = {
            enabled: true,
            salaryFromFund: ed.society.salaryFromFund !== false,
            rewardsFromFund: ed.society.rewardsFromFund !== false,
        };
    }

    if (ed.actions) {
        const acts = {};
        ACTIONS.forEach((def) => {
            const m = ed.actions[def.key];
            if (m && m.enabled) {
                acts[def.key] = {
                    event: (m.event || '').trim() || undefined,
                    item: (m.item || '').trim() || undefined,
                    consume: m.consume ? true : undefined,
                    label: def.label, icon: def.icon, type: def.type,
                };
            }
        });
        if (Object.keys(acts).length) job.actions = acts;
    }

    // type: 'service' si tiene alguna station; si no, conserva el que tuviera.
    if (ed.hasDuty || ed.hasStash || ed.hasWardrobe || ed.hasLocker || ed.hasGarage || ed.hasBoss) job.type = 'service';
    else if (ed.type) job.type = ed.type;

    // Re-inyecta los campos que el panel no edita (vehicles, boss, ...)
    if (ed._extra) {
        Object.keys(ed._extra).forEach((k) => {
            if (!(k in job)) job[k] = ed._extra[k];
        });
    }

    return job;
}

// ---------- Utilidades DOM ----------
function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
}

function field(label, path, type, value, attrs) {
    const wrap = el('label', 'field');
    wrap.appendChild(el('span', null, label));
    const input = el('input');
    input.type = type === 'number' ? 'number' : 'text';
    input.dataset.path = path;
    input.dataset.type = type;
    input.value = value === undefined || value === null ? '' : value;
    if (attrs) Object.keys(attrs).forEach((k) => {
        if (k !== 'autocomplete') input.setAttribute(k, attrs[k]);
    });
    wrap.appendChild(input);
    if (attrs && attrs.autocomplete === 'items') attachItemsAutocomplete(wrap, input);
    return wrap;
}

// Autocompletado propio (el <datalist> de HTML no renderiza bien en el NUI).
function attachItemsAutocomplete(wrap, input) {
    wrap.classList.add('ac-wrap');
    const box = el('div', 'ac-box hidden');
    const render = () => {
        const q = input.value.trim().toLowerCase();
        const items = state.items || [];
        const matches = (q ? items.filter((n) => n.toLowerCase().includes(q)) : items).slice(0, 8);
        box.innerHTML = '';
        if (!matches.length) { box.classList.add('hidden'); return; }
        matches.forEach((n) => {
            const opt = el('div', 'ac-opt', n);
            // mousedown (antes que blur) para que el clic registre.
            opt.addEventListener('mousedown', (e) => {
                e.preventDefault();
                input.value = n;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                box.classList.add('hidden');
            });
            box.appendChild(opt);
        });
        box.classList.remove('hidden');
    };
    input.addEventListener('focus', render);
    input.addEventListener('input', render);
    input.addEventListener('blur', () => setTimeout(() => box.classList.add('hidden'), 150));
    wrap.appendChild(box);
}

// Botón "usar mi posición": rellena X/Y/Z (y heading opcional) por data-path
function posButton(xPath, yPath, zPath, hPath) {
    const b = el('button', 'btn small ghost', '📍 Aquí');
    b.type = 'button';
    b.title = 'Usar mi posición actual';
    b.addEventListener('click', async () => {
        const c = await nui('getCoords');
        setInput(xPath, c.x); setInput(yPath, c.y); setInput(zPath, c.z);
        if (hPath && c.h !== undefined) setInput(hPath, c.h);
        state.dirty = true; renderSidebar();
    });
    return b;
}

// Botón "usar waypoint del mapa".
function waypointButton(xPath, yPath, zPath) {
    const b = el('button', 'btn small ghost', '🗺️ Mapa');
    b.type = 'button';
    b.title = 'Usar la marca del mapa (waypoint)';
    b.addEventListener('click', async () => {
        const c = await nui('getWaypoint');
        if (!c || !c.ok) { toast('No tienes ninguna marca en el mapa.', 'error'); return; }
        setInput(xPath, c.x); setInput(yPath, c.y); setInput(zPath, c.z);
        state.dirty = true; renderSidebar();
        toast('Coords del waypoint aplicadas. Revisa la Z.', 'ok');
    });
    return b;
}

// Botón "ir a la zona": teletransporta a las coords actuales de los inputs.
function gotoButton(xPath, yPath, zPath) {
    const b = el('button', 'btn small ghost', '🚀 Ir');
    b.type = 'button';
    b.title = 'Teletransportarte a esta zona para probarla';
    b.addEventListener('click', async () => {
        const x = parseFloat(getInput(xPath)), y = parseFloat(getInput(yPath)), z = parseFloat(getInput(zPath));
        if (isNaN(x) || isNaN(y) || isNaN(z)) { toast('Coords inválidas.', 'error'); return; }
        await nui('teleport', { x, y, z });
        toast('Teletransportado. Cierra el panel (Esc) para verlo.', 'info');
    });
    return b;
}

// Botón "ver zona": dibuja la caja de la zona en el mundo.
function zoneButton(xPath, yPath, zPath, sizePaths) {
    const b = el('button', 'btn small ghost', '📦 Zona');
    b.type = 'button';
    b.title = 'Dibujar la caja de la zona en el mundo (usa 🚀 Ir para verla)';
    b.addEventListener('click', async () => {
        await nui('previewZone', {
            x: parseFloat(getInput(xPath)) || 0,
            y: parseFloat(getInput(yPath)) || 0,
            z: parseFloat(getInput(zPath)) || 0,
            sx: parseFloat(getInput(sizePaths.sx)) || 1.6,
            sy: parseFloat(getInput(sizePaths.sy)) || 1.6,
            sz: parseFloat(getInput(sizePaths.sz)) || 2.0,
        });
        toast('Zona dibujada. Pulsa 🚀 Ir y cierra (Esc) para verla.', 'info');
    });
    return b;
}

// Botón "colocar en el mundo": entra en modo apuntado con la cámara.
function placeButton(xPath, yPath, zPath, hPath) {
    const b = el('button', 'btn small ghost', '🎯 Colocar');
    b.type = 'button';
    b.title = 'Colocar apuntando con la cámara en el mundo';
    b.addEventListener('click', async () => {
        state.pendingPlace = { xPath, yPath, zPath, hPath: hPath || null };
        await nui('startPlacement', { heading: !!hPath });
    });
    return b;
}

// Columna de utilidades junto a una fila de coords.
function coordTools(xPath, yPath, zPath, sizePaths) {
    const wrap = el('div', 'coord-tools');
    wrap.appendChild(posButton(xPath, yPath, zPath));
    wrap.appendChild(placeButton(xPath, yPath, zPath));
    wrap.appendChild(waypointButton(xPath, yPath, zPath));
    wrap.appendChild(gotoButton(xPath, yPath, zPath));
    if (sizePaths) wrap.appendChild(zoneButton(xPath, yPath, zPath, sizePaths));
    return wrap;
}

function setInput(path, val) {
    const input = document.querySelector(`#jobForm [data-path="${path}"]`);
    if (input) input.value = val;
}

function getInput(path) {
    const input = document.querySelector(`#jobForm [data-path="${path}"]`);
    return input ? input.value : '';
}

// Paleta de swatches que fija un input numérico (color de blip) al pulsar.
function colorSwatches(targetPath, current) {
    const wrap = el('div', 'swatches');
    BLIP_COLORS.forEach((c) => {
        const sw = el('button', 'swatch' + (Number(current) === c.i ? ' sel' : ''));
        sw.type = 'button';
        sw.style.background = c.hex;
        sw.title = `${c.name} (${c.i})`;
        sw.addEventListener('click', () => {
            setInput(targetPath, c.i);
            state.dirty = true; renderSidebar();
            wrap.querySelectorAll('.swatch').forEach((s) => s.classList.remove('sel'));
            sw.classList.add('sel');
        });
        wrap.appendChild(sw);
    });
    return wrap;
}

// Barra de animaciones: preset (rellena dict/clip) + probar/parar en el ped.
function animTools(dictPath, clipPath) {
    const wrap = el('div', 'anim-tools');
    const sel = el('select', 'anim-preset');
    sel.appendChild(new Option('Elegir preset de animación…', ''));
    ANIM_PRESETS.forEach((a, idx) => sel.appendChild(new Option(a.label, String(idx))));
    sel.addEventListener('change', () => {
        const a = ANIM_PRESETS[parseInt(sel.value)];
        if (!a) return;
        setInput(dictPath, a.dict);
        setInput(clipPath, a.clip);
        state.dirty = true; renderSidebar();
        sel.value = '';
    });
    wrap.appendChild(sel);

    const play = el('button', 'btn small ghost', '▶ Probar');
    play.type = 'button';
    play.addEventListener('click', async () => {
        const dict = getInput(dictPath), clip = getInput(clipPath);
        if (!dict || !clip) { toast('Rellena anim dict y clip primero.', 'error'); return; }
        const r = await nui('previewAnim', { dict, clip });
        if (!r || !r.ok) toast('No se pudo cargar esa animación (revisa dict/clip).', 'error');
    });
    const stop = el('button', 'btn small ghost', '⏹');
    stop.type = 'button';
    stop.title = 'Parar animación';
    stop.addEventListener('click', () => nui('stopAnim'));
    wrap.appendChild(play);
    wrap.appendChild(stop);
    return wrap;
}

// Campo de icono con vista previa del glifo + botón para abrir el selector.
function iconField(path, value) {
    const wrap = el('label', 'field');
    wrap.appendChild(el('span', null, 'Icono (target)'));
    const row = el('div', 'icon-row');
    const prev = el('i', 'icon-preview ' + (value || ''));
    const input = el('input');
    input.type = 'text';
    input.dataset.path = path; input.dataset.type = 'text';
    input.value = value || '';
    input.placeholder = 'fa-solid fa-trash';
    input.setAttribute('list', 'iconList');
    input.addEventListener('input', () => { prev.className = 'icon-preview ' + (input.value.trim() || ''); });
    const btn = el('button', 'btn small ghost', '🔍');
    btn.type = 'button'; btn.title = 'Elegir icono';
    btn.addEventListener('click', () => openIconPicker(path));
    row.appendChild(prev); row.appendChild(input); row.appendChild(btn);
    wrap.appendChild(row);
    return wrap;
}

// Modal selector de iconos con buscador.
function openIconPicker(path) {
    const body = el('div');
    const search = el('input', 'icon-search');
    search.type = 'text'; search.placeholder = 'Buscar icono…';
    body.appendChild(search);
    const grid = el('div', 'icon-grid');
    const render = (q) => {
        grid.innerHTML = '';
        ICONS.filter((c) => !q || c.includes(q)).forEach((c) => {
            const cell = el('button', 'icon-cell');
            cell.type = 'button'; cell.title = c;
            cell.appendChild(el('i', c));
            cell.appendChild(el('span', 'icon-cell-name', c.replace('fa-solid fa-', '')));
            cell.addEventListener('click', () => {
                setInput(path, c);
                const inp = document.querySelector(`#jobForm [data-path="${path}"]`);
                if (inp) inp.dispatchEvent(new Event('input', { bubbles: true }));
                closeModalRaw();
                toast('Icono seleccionado.', 'ok');
            });
            grid.appendChild(cell);
        });
    };
    search.addEventListener('input', () => render(search.value.trim().toLowerCase()));
    render('');
    body.appendChild(grid);
    openModal('Elegir icono (target)', body, [{ label: 'Cerrar', cls: 'ghost', onClick: closeModalRaw }]);
    search.focus();
}

// Datalist de iconos (autocompletado al escribir).
function buildIconDatalist() {
    let dl = document.getElementById('iconList');
    if (!dl) { dl = el('datalist'); dl.id = 'iconList'; document.body.appendChild(dl); }
    dl.innerHTML = '';
    ICONS.forEach((c) => { const o = document.createElement('option'); o.value = c; dl.appendChild(o); });
}

// Datalist de sprites de blip (autocompletado del campo Sprite).
function buildSpriteDatalist() {
    let dl = document.getElementById('spriteList');
    if (!dl) { dl = el('datalist'); dl.id = 'spriteList'; document.body.appendChild(dl); }
    dl.innerHTML = '';
    Object.keys(BLIP_SPRITES).forEach((id) => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.label = `${id} · ${BLIP_SPRITES[id].label}`;
        dl.appendChild(opt);
    });
}

// Intercambia dos elementos de un array (reordenar). Devuelve si hubo cambio.
function moveItem(arr, i, dir) {
    const j = i + dir;
    if (j < 0 || j >= arr.length) return false;
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    return true;
}

// Botones ↑ ↓ ⧉ para reordenar/duplicar un elemento de un array.
// makeCopy(item) -> copia a insertar tras el actual (opcional).
function reorderButtons(arr, i, makeCopy) {
    const frag = document.createDocumentFragment();
    const mk = (txt, title, fn, disabled) => {
        const b = el('button', 'btn small ghost icon', txt);
        b.type = 'button'; b.title = title;
        if (disabled) b.disabled = true;
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            syncFormToState();
            fn();
            renderEditor();
        });
        return b;
    };
    frag.appendChild(mk('↑', 'Subir', () => moveItem(arr, i, -1), i === 0));
    frag.appendChild(mk('↓', 'Bajar', () => moveItem(arr, i, 1), i === arr.length - 1));
    if (makeCopy) frag.appendChild(mk('⧉', 'Duplicar', () => arr.splice(i + 1, 0, makeCopy(arr[i]))));
    return frag;
}

// Genera un ID de step único dentro de un job (para duplicar steps).
function uniqueStepId(job, base) {
    base = (base || 'step').trim() || 'step';
    const taken = (id) => job.steps.some((s) => (s.id || '').trim() === id);
    if (!taken(base)) return base;
    let c = base + '_copia', i = 2;
    while (taken(c)) { c = `${base}_copia${i}`; i++; }
    return c;
}

// ---------- Sincroniza inputs del DOM -> modelo de editor ----------
function syncFormToState() {
    if (state.selected < 0) return;
    const job = state.jobs[state.selected];
    document.querySelectorAll('#jobForm [data-path]').forEach((input) => {
        const path = input.dataset.path;
        let val;
        if (input.type === 'checkbox') val = input.checked;
        else if (input.dataset.type === 'number') val = input.value === '' ? 0 : parseFloat(input.value);
        else val = input.value;
        setByPath(job, path, val);
    });
}

function setByPath(obj, path, val) {
    const parts = path.split('.');
    let ref = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        const k = /^\d+$/.test(parts[i]) ? parseInt(parts[i]) : parts[i];
        if (ref[k] === undefined) ref[k] = {};
        ref = ref[k];
    }
    const last = parts[parts.length - 1];
    ref[/^\d+$/.test(last) ? parseInt(last) : last] = val;
}

// ============================================================
//  Render: overview (tarjetas de jobs) + navegación
// ============================================================
function showOverview() {
    document.getElementById('jobsOverview').classList.remove('hidden');
    document.getElementById('jobsEditor').classList.add('hidden');
}
function showEditorScreen() {
    document.getElementById('jobsOverview').classList.add('hidden');
    document.getElementById('jobsEditor').classList.remove('hidden');
}

function updateEditorTitle() {
    const elt = document.getElementById('editorJobTitle');
    if (!elt || state.selected < 0) return;
    const job = state.jobs[state.selected];
    elt.textContent = (job.label || job.name || 'Job') + (state.dirty ? ' •' : '');
}

function renderJobCard(job, i) {
    const card = el('div', 'job-card' + (job.enabled === false ? ' disabled' : ''));

    const head = el('div', 'jc-head');
    const titles = el('div', 'jc-titles');
    titles.appendChild(el('div', 'jc-name', job.name || '(sin nombre)'));
    titles.appendChild(el('div', 'jc-label', job.label || '—'));
    head.appendChild(titles);
    if (job.enabled === false) head.appendChild(el('span', 'jl-off', 'OFF'));
    card.appendChild(head);

    const tags = el('div', 'jc-tags');
    if (job.steps.length) tags.appendChild(el('span', 'jc-tag', `${job.steps.length} steps`));
    [['hasDuty', 'duty'], ['hasStash', 'stash'], ['hasWardrobe', 'ropa'], ['hasLocker', 'taquilla'],
        ['hasGarage', 'garaje'], ['hasBoss', 'jefe']].forEach(([k, l]) => {
        if (job[k]) tags.appendChild(el('span', 'jc-tag', l));
    });
    if (job.grades && job.grades.length) tags.appendChild(el('span', 'jc-tag', 'grados'));
    card.appendChild(tags);

    // Estadísticas en vivo (por el job de framework = Job requerido).
    const fw = (job.req && job.req.jobName && job.req.jobName.trim()) || job.name;
    const stat = state.stats && state.stats[fw];
    if (stat && (stat.employees || stat.onduty)) {
        const s = el('div', 'jc-stat');
        s.appendChild(el('span', 'jl-emp', `👥 ${stat.employees || 0}`));
        s.appendChild(el('span', 'jl-duty', `🟢 ${stat.onduty || 0}`));
        card.appendChild(s);
    }

    const actions = el('div', 'jc-actions');
    const edit = el('button', 'btn small primary', t('ov.edit'));
    edit.type = 'button';
    edit.addEventListener('click', () => editJob(i));
    const dup = el('button', 'btn small ghost', '⧉');
    dup.type = 'button'; dup.title = 'Duplicar';
    dup.addEventListener('click', () => duplicateJobAt(i));
    const tgl = el('button', 'btn small ghost', job.enabled === false ? t('ov.enable') : t('ov.disable'));
    tgl.type = 'button';
    tgl.addEventListener('click', () => quickToggleEnabled(i));
    const del = el('button', 'btn small danger', '🗑');
    del.type = 'button'; del.title = 'Eliminar';
    del.addEventListener('click', () => deleteJobAt(i));
    actions.appendChild(edit); actions.appendChild(dup); actions.appendChild(tgl); actions.appendChild(del);
    card.appendChild(actions);

    return card;
}

// Renderiza la rejilla de jobs. (Mantiene el nombre renderSidebar por compatibilidad.)
function renderSidebar() {
    const cont = document.getElementById('jobCards');
    if (!cont) return;
    cont.innerHTML = '';
    const q = state.filter.trim().toLowerCase();
    let shown = 0;
    state.jobs.forEach((job, i) => {
        if (q && !`${job.name} ${job.label}`.toLowerCase().includes(q)) return;
        shown++;
        cont.appendChild(renderJobCard(job, i));
    });
    if (shown === 0) {
        cont.appendChild(el('div', 'jc-empty', q ? 'Sin resultados' : 'No hay jobs todavía. Crea uno con "+ Nuevo job".'));
    }
    const count = document.getElementById('jobCount');
    if (count) count.textContent = q ? `${shown}/${state.jobs.length}` : `${state.jobs.length}`;
}

// Abre el editor de un job (índice en state.jobs).
function editJob(i) {
    if (state.selected >= 0 && state.selected !== i) syncFormToState();
    state.selected = i;
    state.editorSection = recallSection(state.jobs[i]); // reabre en la última página usada
    renderEditor();
    updateEditorTitle();
    showEditorScreen();
    maybeOfferDraft(i); // si hay cambios sin guardar de otra sesión, ofrece restaurarlos
}
// Alias para acciones que crean un job y lo abren.
function selectJob(i) { editJob(i); }

function backToOverview() {
    if (state.selected >= 0) syncFormToState();
    renderSidebar();
    showOverview();
}

function duplicateJobAt(i) {
    const src = state.jobs[i];
    const copy = JSON.parse(JSON.stringify(src));
    copy.name = uniqueName(src.name);
    copy.label = src.label ? `${src.label} (copia)` : src.label;
    state.jobs.push(copy);
    state.dirty = true;
    editJob(state.jobs.length - 1);
    toast('Job duplicado. Revisa el nombre y pulsa Guardar.', 'ok');
}

async function deleteJobAt(i) {
    state.selected = i;
    await deleteJob();
}

async function quickToggleEnabled(i) {
    const job = state.jobs[i];
    job.enabled = job.enabled === false ? true : false;
    await nui('saveJob', toServer(job));
    renderSidebar();
    toast(job.enabled ? 'Job activado.' : 'Job desactivado.', 'ok');
}

// Tarjeta de una acción (toggle + icono + descripción + evento opcional).
function renderActionCard(job, a) {
    const m = job.actions[a.key] || { enabled: false, event: '' };
    const card = el('div', 'action-card' + (m.enabled ? ' on' : ''));
    const head = el('label', 'action-head');
    const chk = el('input');
    chk.type = 'checkbox'; chk.checked = m.enabled;
    chk.dataset.path = `actions.${a.key}.enabled`; chk.dataset.type = 'bool';
    chk.addEventListener('change', () => { syncFormToState(); renderEditor(); });
    head.appendChild(chk);
    head.appendChild(el('i', 'action-ic ' + a.icon));
    const txt = el('div', 'action-txt');
    txt.appendChild(el('div', 'action-name', a.label));
    txt.appendChild(el('div', 'action-desc', a.desc));
    head.appendChild(txt);
    card.appendChild(head);
    if (m.enabled) {
        // Item requerido para usar la acción (+ consumir al usarla).
        const ig = el('div', 'grid');
        ig.appendChild(field(t('act.item'), `actions.${a.key}.item`, 'text', m.item || '',
            { placeholder: 'ej: handcuff', autocomplete: 'items', title: 'Vacío = no requiere item.' }));
        ig.appendChild(checkField(t('act.consume'), `actions.${a.key}.consume`, m.consume));
        card.appendChild(ig);
        card.appendChild(field(t('act.event'), `actions.${a.key}.event`, 'text', m.event, { placeholder: 'ej: miscript:' + a.key }));
    }
    return card;
}

// ============================================================
//  Render: editor de un job (navegación por secciones, sin scroll infinito)
// ============================================================

// Cada "cosita" del editor es una página propia con su acción en el menú.
// group -> agrupación visual; icon -> FontAwesome; on()/count() -> indicador.
const EDITOR_SECTIONS = [
    { id: 'general',  group: 'eg.core',  icon: 'fa-sliders' },
    { id: 'req',      group: 'eg.core',  icon: 'fa-id-card-clip' },
    { id: 'grades',   group: 'eg.core',  icon: 'fa-ranking-star',     count: (j) => (j.grades || []).length },
    { id: 'blip',     group: 'eg.core',  icon: 'fa-location-dot',     on: (j) => j.hasBlip },
    { id: 'duty',     group: 'eg.zones', icon: 'fa-clipboard-check',  on: (j) => j.hasDuty },
    { id: 'stash',    group: 'eg.zones', icon: 'fa-box-archive',      on: (j) => j.hasStash },
    { id: 'wardrobe', group: 'eg.zones', icon: 'fa-shirt',            on: (j) => j.hasWardrobe },
    { id: 'locker',   group: 'eg.zones', icon: 'fa-toolbox',          on: (j) => j.hasLocker },
    { id: 'garage',   group: 'eg.zones', icon: 'fa-warehouse',        on: (j) => j.hasGarage },
    { id: 'boss',     group: 'eg.zones', icon: 'fa-user-tie',         on: (j) => j.hasBoss },
    { id: 'society',  group: 'eg.work',  icon: 'fa-building-columns', on: (j) => j.society && j.society.enabled },
    { id: 'actions',  group: 'eg.work',  icon: 'fa-bolt',             count: (j) => countEnabledActions(j) },
    { id: 'steps',    group: 'eg.work',  icon: 'fa-list-check',       count: (j) => (j.steps || []).length },
];

// Clase CSS por grupo, para colorear cada categoría del menú.
const GROUP_CLASS = { 'eg.core': 'g-core', 'eg.zones': 'g-zones', 'eg.work': 'g-work' };

// ¿Es un id de sección válido? (para validar lo recuperado de localStorage)
function isValidSection(id) {
    return EDITOR_SECTIONS.some((s) => s.id === id);
}

// Recuerda/recupera la última página abierta por job (persistido en este equipo).
// Sólo para jobs con nombre: los recién creados arrancan siempre en "General".
function lastSectionKey(job) { return 'jc_lastsec_' + (job.name || '').trim(); }
function rememberSection(job, secId) {
    if (!job || !(job.name || '').trim()) return;
    try { localStorage.setItem(lastSectionKey(job), secId); } catch (e) { /* */ }
}
function recallSection(job) {
    if (!job || !(job.name || '').trim()) return 'general';
    let v = 'general';
    try { v = localStorage.getItem(lastSectionKey(job)) || 'general'; } catch (e) { /* */ }
    return isValidSection(v) ? v : 'general';
}

// Subtítulo breve de cada página (es/en) — da contexto sin saturar el menú.
const SECTION_DESC = {
    general:  { es: 'Identidad del job: nombre interno y etiqueta visible.',          en: 'Job identity: internal name and visible label.' },
    req:      { es: 'Quién puede usar este job (rango, item de acceso).',             en: 'Who can use this job (rank, access item).' },
    grades:   { es: 'Rangos del job y el salario por intervalo de cada uno.',         en: 'Job ranks and the per-interval salary of each one.' },
    blip:     { es: 'Marcador en el mapa: posición, sprite y color.',                 en: 'Map blip: position, sprite and color.' },
    duty:     { es: 'Punto para fichar de entrada/salida del servicio.',              en: 'Point to clock in/out of duty.' },
    stash:    { es: 'Cofre compartido del trabajo.',                                  en: 'Shared job stash.' },
    wardrobe: { es: 'Vestuario y uniformes del trabajo.',                             en: 'Job wardrobe and uniforms.' },
    locker:   { es: 'Taquilla / armería con items por grado.',                        en: 'Locker / armory with items per grade.' },
    garage:   { es: 'Garaje: vehículos y punto de aparición.',                        en: 'Garage: vehicles and spawn point.' },
    boss:     { es: 'Punto de gestión: contratar, despedir y ascender.',              en: 'Management point: hire, fire and promote.' },
    society:  { es: 'Caja de empresa para salarios y recompensas.',                   en: 'Company funds for salaries and rewards.' },
    actions:  { es: 'Acciones permitidas sobre jugadores y vehículos.',              en: 'Allowed actions on players and vehicles.' },
    steps:    { es: 'Pasos del trabajo: requisitos, recompensas y zonas.',            en: 'Job steps: requirements, rewards and zones.' },
};

function sectionDesc(id) {
    const d = SECTION_DESC[id];
    if (!d) return '';
    return d[LANG] || d.es || '';
}

// Cuenta cuántas acciones (handcuff, etc.) están activadas en el job.
function countEnabledActions(job) {
    if (!job.actions) return 0;
    return Object.keys(job.actions).filter((k) => job.actions[k] && job.actions[k].enabled).length;
}

// Mapea un data-path a su sección, para poder saltar a ella al validar.
function sectionForPath(path) {
    if (!path) return 'general';
    const head = path.split('.')[0];
    const map = {
        name: 'general', label: 'general', enabled: 'general',
        req: 'req', grades: 'grades', blip: 'blip',
        duty: 'duty', stash: 'stash', wardrobe: 'wardrobe', locker: 'locker',
        garage: 'garage', boss: 'boss', society: 'society', actions: 'actions', steps: 'steps',
    };
    return map[head] || 'general';
}

// Asocia un elemento de sección a su id de página y lo cuelga del formulario.
function mountSection(secId, elem) {
    if (!elem) return elem;
    elem.dataset.sec = secId;
    // Subtítulo de la página, justo bajo el título (h3) de la sección.
    const desc = sectionDesc(secId);
    const h3 = elem.querySelector('h3');
    if (desc && h3) h3.insertAdjacentElement('afterend', el('div', 'sec-desc', desc));
    document.getElementById('jobForm').appendChild(elem);
    return elem;
}

// ---- Salud por sección: detecta lo que "necesita atención" en cada página ----
function isZeroXYZ(o) {
    return o && Math.abs(o.x || 0) < 0.01 && Math.abs(o.y || 0) < 0.01 && Math.abs(o.z || 0) < 0.01;
}
// Devuelve { sev: 'error'|'warn'|'ok', msg } para una sección concreta.
function sectionSeverity(job, id) {
    switch (id) {
        case 'general':
            if (!(job.name || '').trim()) return { sev: 'error', msg: 'Falta el nombre interno.' };
            if (!(job.label || '').trim()) return { sev: 'warn', msg: 'Sin etiqueta visible.' };
            return { sev: 'ok' };
        case 'grades':
            if (!job.grades || !job.grades.length) return { sev: 'warn', msg: 'Sin grados ni salarios.' };
            return { sev: 'ok' };
        case 'blip':
            if (job.hasBlip && isZeroXYZ(job.blip)) return { sev: 'warn', msg: 'Blip sin colocar (0,0,0).' };
            return { sev: 'ok' };
        case 'duty':
            if (job.hasDuty && isZeroXYZ(job.duty)) return { sev: 'warn', msg: 'Zona de duty sin colocar.' };
            return { sev: 'ok' };
        case 'stash':
            if (job.hasStash && isZeroXYZ(job.stash)) return { sev: 'warn', msg: 'Cofre sin colocar.' };
            return { sev: 'ok' };
        case 'wardrobe':
            if (job.hasWardrobe) {
                if (isZeroXYZ(job.wardrobe)) return { sev: 'warn', msg: 'Vestuario sin colocar.' };
                if (!(job.wardrobe.outfits || []).length) return { sev: 'warn', msg: 'Vestuario sin uniformes.' };
            }
            return { sev: 'ok' };
        case 'locker':
            if (job.hasLocker) {
                if (isZeroXYZ(job.locker)) return { sev: 'warn', msg: 'Taquilla sin colocar.' };
                if (!(job.locker.items || []).length) return { sev: 'warn', msg: 'Taquilla sin items.' };
            }
            return { sev: 'ok' };
        case 'garage':
            if (job.hasGarage) {
                if (isZeroXYZ(job.garage)) return { sev: 'warn', msg: 'Garaje sin colocar.' };
                if (!(job.garage.vehicles || []).length) return { sev: 'warn', msg: 'Garaje sin vehículos.' };
            }
            return { sev: 'ok' };
        case 'boss':
            if (job.hasBoss && isZeroXYZ(job.boss)) return { sev: 'warn', msg: 'Punto de jefe sin colocar.' };
            return { sev: 'ok' };
        case 'steps': {
            const ids = {};
            for (let i = 0; i < job.steps.length; i++) {
                const sid = (job.steps[i].id || '').trim();
                if (!sid) return { sev: 'error', msg: `El step #${i + 1} no tiene ID.` };
                if (ids[sid]) return { sev: 'error', msg: `ID de step duplicado: "${sid}".` };
                ids[sid] = true;
            }
            for (let i = 0; i < job.steps.length; i++) {
                const s = job.steps[i];
                if (isZeroXYZ({ x: s.tx, y: s.ty, z: s.tz })) return { sev: 'warn', msg: `Step "${s.id || i + 1}" sin colocar.` };
            }
            return { sev: 'ok' };
        }
        default:
            return { sev: 'ok' }; // req, society, actions: opcionales
    }
}

// Resumen de salud de todo el job (para el medidor del topbar).
function computeHealth(job) {
    const map = {};
    let ok = 0, warn = 0, error = 0;
    EDITOR_SECTIONS.forEach((s) => {
        const r = sectionSeverity(job, s.id) || { sev: 'ok' };
        map[s.id] = r;
        if (r.sev === 'error') error++; else if (r.sev === 'warn') warn++; else ok++;
    });
    const total = EDITOR_SECTIONS.length;
    return { map, ok, warn, error, total, percent: Math.round((ok / total) * 100) };
}

// Actualiza el medidor de salud del topbar (barra + texto + color).
function updateJobHealth(health) {
    const wrap = document.getElementById('jobHealth');
    if (!wrap) return;
    if (!health) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    const fill = wrap.querySelector('.jh-fill');
    const text = wrap.querySelector('.jh-text');
    const cls = health.error ? 'bad' : (health.warn ? 'warn' : 'good');
    wrap.classList.remove('good', 'warn', 'bad');
    wrap.classList.add(cls);
    if (fill) fill.style.width = health.percent + '%';
    if (text) text.textContent = health.percent + '%';
    const parts = [];
    if (health.error) parts.push(`${health.error} error(es)`);
    if (health.warn) parts.push(`${health.warn} aviso(s)`);
    wrap.title = `Salud ${health.percent}%` + (parts.length ? ' — ' + parts.join(', ') : ' — todo en orden') + '. Clic para el informe.';
}

// Pinta el menú lateral de páginas del editor con grupos, iconos e indicadores.
function renderEditorNav(job, health) {
    const nav = document.getElementById('editorNav');
    if (!nav) return;
    if (!health) health = computeHealth(job);
    const active = state.editorSection || 'general';
    nav.innerHTML = '';

    let currentGroup = null;
    EDITOR_SECTIONS.forEach((s) => {
        const gClass = GROUP_CLASS[s.group] || '';
        if (s.group !== currentGroup) {
            currentGroup = s.group;
            nav.appendChild(el('div', 'en-group ' + gClass, t(s.group)));
        }
        const item = el('button', 'en-item ' + gClass + (s.id === active ? ' active' : ''));
        item.type = 'button';
        item.dataset.sec = s.id;

        const ic = el('span', 'en-ic');
        ic.appendChild(el('i', 'fa-solid ' + s.icon));
        // Punto de estado: rojo (necesita atención) o ámbar (aviso) en la esquina del icono.
        const st = health.map[s.id];
        if (st && st.sev !== 'ok') {
            const dot = el('span', 'en-dot ' + st.sev);
            dot.title = st.msg || '';
            ic.appendChild(dot);
        }
        item.appendChild(ic);
        item.appendChild(el('span', 'en-label', t('sec.' + s.id)));

        // Indicador: pastilla ON para secciones activables, badge numérico para listas.
        if (typeof s.on === 'function') {
            const isOn = !!s.on(job);
            item.appendChild(el('span', 'en-pill' + (isOn ? ' on' : ''), isOn ? 'ON' : 'OFF'));
        } else if (typeof s.count === 'function') {
            const n = s.count(job);
            if (n > 0) item.appendChild(el('span', 'en-count', String(n)));
        }

        item.addEventListener('click', () => goToSection(s.id));
        nav.appendChild(item);
    });
}

// Cambia la página visible sin reconstruir el formulario (instantáneo).
function showEditorSection(secId) {
    const form = document.getElementById('jobForm');
    if (!form) return;
    let any = false;
    form.querySelectorAll('.section[data-sec]').forEach((sec) => {
        const match = sec.dataset.sec === secId;
        sec.classList.toggle('sec-off', !match);
        if (match) any = true;
    });
    // Si la sección pedida no existe, cae a la primera.
    if (!any) {
        const first = form.querySelector('.section[data-sec]');
        if (first) { first.classList.remove('sec-off'); state.editorSection = first.dataset.sec; }
    }
    // Resalta el item activo del menú.
    document.querySelectorAll('#editorNav .en-item').forEach((it) => {
        it.classList.toggle('active', it.dataset.sec === state.editorSection);
    });
    form.scrollTop = 0;
}

// Acción de navegar a una página concreta del editor.
function goToSection(secId) {
    if (state.selected < 0) return;
    syncFormToState();          // guarda lo editado en la página actual
    state.editorSection = secId;
    rememberSection(state.jobs[state.selected], secId); // recuerda dónde estaba
    showEditorSection(secId);
}

// ============================================================
//  Catálogo visual de blips (sprite -> imagen + nombre)
//  Imágenes del CDN oficial de FiveM: docs-backend.fivem.net/blips/<nombre>.png
//  (nombres verificados desde docs.fivem.net). Si un nombre fallara, el <img>
//  cae a "sin preview" gracias al manejador onerror.
// ============================================================
const BLIP_SPRITES = {
    6:   { name: 'radar_centre',              label: 'Estándar (punto)' },
    8:   { name: 'radar_waypoint',            label: 'Waypoint' },
    41:  { name: 'radar_police',              label: 'Policía (placa)' },
    60:  { name: 'radar_police_station',      label: 'Comisaría' },
    137: { name: 'radar_police_station_blue', label: 'Comisaría (azul)' },
    61:  { name: 'radar_hospital',            label: 'Hospital' },
    64:  { name: 'radar_helicopter',          label: 'Helicóptero' },
    68:  { name: 'radar_tow_truck',           label: 'Grúa' },
    71:  { name: 'radar_barber',              label: 'Barbería' },
    72:  { name: 'radar_car_mod_shop',        label: 'Taller (tuning)' },
    73:  { name: 'radar_clothes_store',       label: 'Tienda de ropa' },
    75:  { name: 'radar_tattoo',              label: 'Tatuajes' },
    80:  { name: 'radar_jewelry_heist',       label: 'Joyería' },
    93:  { name: 'radar_bar',                 label: 'Bar' },
    100: { name: 'radar_car_wash',            label: 'Lavadero' },
    102: { name: 'radar_comedy_club',         label: 'Club de comedia' },
    109: { name: 'radar_golf',                label: 'Golf' },
    110: { name: 'radar_gun_shop',            label: 'Armería' },
    119: { name: 'radar_shooting_range',      label: 'Campo de tiro' },
    121: { name: 'radar_strip_club',          label: 'Club nocturno' },
    135: { name: 'radar_cinema',              label: 'Cine' },
    138: { name: 'radar_airport',             label: 'Aeropuerto' },
    140: { name: 'radar_weed_stash',          label: 'Marihuana' },
    141: { name: 'radar_hunting',             label: 'Caza' },
    142: { name: 'radar_pool',                label: 'Billar' },
    198: { name: 'radar_taxi',                label: 'Taxi' },
    318: { name: 'radar_garbage',             label: 'Basura' },
    321: { name: 'radar_firetruck',           label: 'Bomberos' },
    356: { name: 'radar_dock',                label: 'Puerto / muelle' },
    357: { name: 'radar_garage',              label: 'Garaje' },
    360: { name: 'radar_helipad',             label: 'Helipuerto' },
    402: { name: 'radar_repair',              label: 'Reparación / mecánico' },
    410: { name: 'radar_boat',                label: 'Barco' },
    513: { name: 'radar_bus',                 label: 'Autobús' },
    679: { name: 'radar_casino',              label: 'Casino' },
};

function blipMeta(id) {
    id = parseInt(id, 10);
    const m = BLIP_SPRITES[id];
    return m ? { id, name: m.name, label: m.label } : null;
}
function blipImgUrl(name) { return 'https://docs-backend.fivem.net/blips/' + name + '.png'; }

// Recuadro de preview del sprite (imagen + nombre) + botón al selector visual.
// `spriteInput` es el <input> de blip.sprite ya creado (lo enlazamos en vivo).
function blipSpritePicker(spriteInput) {
    const wrap = el('div', 'sub-block');
    wrap.appendChild(el('h4', null, 'Sprite del blip'));
    const row = el('div', 'blip-pick');

    const pv = el('div', 'blip-pv');
    const img = el('img', 'blip-pv-img'); img.alt = '';
    const cap = el('div', 'blip-pv-cap');
    pv.appendChild(img);
    pv.appendChild(cap);

    const pickBtn = el('button', 'btn small primary', '🔍 Elegir blip…');
    pickBtn.type = 'button';

    row.appendChild(pv);
    row.appendChild(pickBtn);
    wrap.appendChild(row);

    const setCap = (idTxt, name, muted) => {
        cap.innerHTML = '';
        cap.appendChild(el('span', 'blip-pv-id', idTxt));
        cap.appendChild(el('span', 'blip-pv-name' + (muted ? ' muted' : ''), name));
    };
    const update = () => {
        const id = parseInt(spriteInput.value, 10);
        const meta = blipMeta(id);
        if (meta) {
            pv.classList.remove('empty');
            img.style.display = '';
            img.src = blipImgUrl(meta.name);
            setCap('#' + meta.id, meta.label, false);
        } else {
            pv.classList.add('empty');
            img.style.display = 'none';
            setCap(isNaN(id) ? '#—' : '#' + id, 'sin preview', true);
        }
    };
    // Si la imagen no existe (nombre no exacto / sin red) -> degradar a "sin preview".
    img.addEventListener('error', () => { pv.classList.add('empty'); img.style.display = 'none'; });
    spriteInput.addEventListener('input', update);

    pickBtn.addEventListener('click', () => {
        openBlipPicker(parseInt(spriteInput.value, 10) || 1, (id) => {
            spriteInput.value = id;
            // Notifica al formulario (dirty + salud) y refresca el preview.
            spriteInput.dispatchEvent(new Event('input', { bubbles: true }));
            spriteInput.dispatchEvent(new Event('change', { bubbles: true }));
            update();
        });
    });

    update(); // estado inicial
    return wrap;
}

// Selector visual: cuadrícula de blips con imagen + nombre + buscador.
function openBlipPicker(currentId, onPick) {
    const body = el('div', 'blip-picker');
    const search = el('input', 'blip-search');
    search.type = 'text'; search.placeholder = '🔎 Buscar por nombre o ID…';
    body.appendChild(search);
    const grid = el('div', 'blip-grid');
    body.appendChild(grid);
    body.appendChild(el('div', 'hint', 'Las imágenes son del catálogo oficial de FiveM. Puedes escribir cualquier ID a mano aunque no esté en la lista.'));

    const entries = Object.keys(BLIP_SPRITES)
        .map((id) => ({ id: parseInt(id, 10), name: BLIP_SPRITES[id].name, label: BLIP_SPRITES[id].label }))
        .sort((a, b) => a.label.localeCompare(b.label, 'es'));

    const renderGrid = (q) => {
        grid.innerHTML = '';
        q = (q || '').trim().toLowerCase();
        let shown = 0;
        entries.forEach((e) => {
            if (q && !(e.label.toLowerCase().includes(q) || String(e.id).includes(q) || e.name.includes(q))) return;
            shown++;
            const card = el('div', 'blip-card' + (e.id === currentId ? ' sel' : ''));
            const img = el('img'); img.src = blipImgUrl(e.name); img.alt = e.label; img.loading = 'lazy';
            img.addEventListener('error', () => card.classList.add('noimg'));
            card.appendChild(img);
            card.appendChild(el('div', 'blip-card-label', e.label));
            card.appendChild(el('div', 'blip-card-id', '#' + e.id));
            card.addEventListener('click', () => { onPick(e.id); closeModalRaw(); });
            grid.appendChild(card);
        });
        if (!shown) grid.appendChild(el('div', 'hint', 'Sin resultados.'));
    };
    search.addEventListener('input', () => renderGrid(search.value));
    renderGrid('');

    openModal('Elegir blip del mapa', body, [{ label: 'Cerrar', cls: 'ghost', onClick: closeModalRaw }]);
    setTimeout(() => search.focus(), 30);
}

// Bloque reutilizable: blip opcional de una estación (toggle + sprite/color/…).
// `prefix` es la ruta de la estación (p.ej. 'locker'); el blip se dibuja en sus coords.
function stationBlipBlock(prefix, blip, defaultLabel) {
    const wrap = el('div', 'sub-block');
    const head = el('h4', 'sb-toggle-head');
    head.appendChild(el('span', null, 'Blip en el mapa'));
    const tgl = el('label', 'field check');
    const chk = el('input'); chk.type = 'checkbox'; chk.checked = !!blip.enabled;
    chk.dataset.path = `${prefix}.blip.enabled`; chk.dataset.type = 'bool';
    chk.title = 'Muestra un marcador propio en el mapa en este punto.';
    chk.addEventListener('change', () => { syncFormToState(); renderEditor(); });
    tgl.appendChild(chk);
    tgl.appendChild(el('span', null, 'Mostrar'));
    head.appendChild(tgl);
    wrap.appendChild(head);

    if (blip.enabled) {
        const g = el('div', 'grid cols-4');
        const spriteField = field('Sprite', `${prefix}.blip.sprite`, 'number', blip.sprite, { list: 'spriteList' });
        g.appendChild(spriteField);
        g.appendChild(field('Color', `${prefix}.blip.color`, 'number', blip.color));
        g.appendChild(field('Escala', `${prefix}.blip.scale`, 'number', blip.scale, { step: '0.1' }));
        g.appendChild(field('Texto', `${prefix}.blip.label`, 'text', blip.label, { placeholder: defaultLabel || '' }));
        wrap.appendChild(g);
        wrap.appendChild(blipSpritePicker(spriteField.querySelector('input')));
        const pal = el('div', 'pal-inline');
        pal.appendChild(colorSwatches(`${prefix}.blip.color`, blip.color));
        wrap.appendChild(pal);
    }
    return wrap;
}

function renderEditor() {
    const form = document.getElementById('jobForm');
    if (state.selected < 0) {
        if (form) form.innerHTML = '';
        const nav = document.getElementById('editorNav');
        if (nav) nav.innerHTML = '';
        updateJobHealth(null);
        return;
    }

    const job = state.jobs[state.selected];
    form.innerHTML = '';

    // ---- General ----
    const general = el('div', 'section');
    const genHead = el('h3', null, t('sec.general'));
    const enToggle = el('label', 'field check');
    const enChk = el('input'); enChk.type = 'checkbox'; enChk.checked = job.enabled !== false;
    enChk.dataset.path = 'enabled'; enChk.dataset.type = 'bool';
    enChk.title = 'Si lo desactivas, el job deja de crear blips/zonas y no paga salario (no se borra).';
    enChk.addEventListener('change', () => { syncFormToState(); renderSidebar(); });
    enToggle.appendChild(enChk);
    enToggle.appendChild(el('span', null, t('gen.active')));
    genHead.appendChild(enToggle);
    general.appendChild(genHead);
    const gGrid = el('div', 'grid');
    gGrid.appendChild(field('Nombre interno (name)', 'name', 'text', job.name,
        { title: 'Identificador único del job (sin espacios). No se muestra al jugador.' }));
    gGrid.appendChild(field('Etiqueta (label)', 'label', 'text', job.label,
        { title: 'Nombre visible para el jugador (en blips, menús, notificaciones).' }));
    general.appendChild(gGrid);
    mountSection('general', general);

    // ---- Blip ----
    const blipSec = el('div', 'section');
    const blipHead = el('h3', null, t('sec.blip'));
    const blipToggle = el('label', 'field check');
    const blipCheck = el('input'); blipCheck.type = 'checkbox'; blipCheck.checked = job.hasBlip;
    blipCheck.dataset.path = 'hasBlip'; blipCheck.dataset.type = 'bool';
    blipCheck.addEventListener('change', () => { syncFormToState(); renderEditor(); });
    blipToggle.appendChild(blipCheck);
    blipToggle.appendChild(el('span', null, t('tg.blip')));
    blipHead.appendChild(blipToggle);
    blipSec.appendChild(blipHead);

    if (job.hasBlip) {
        const cr = el('div', 'coord-row');
        const cg = el('div', 'grid cols-3');
        cg.appendChild(field('X', 'blip.x', 'number', job.blip.x, { step: '0.01' }));
        cg.appendChild(field('Y', 'blip.y', 'number', job.blip.y, { step: '0.01' }));
        cg.appendChild(field('Z', 'blip.z', 'number', job.blip.z, { step: '0.01' }));
        cr.appendChild(cg);
        cr.appendChild(coordTools('blip.x', 'blip.y', 'blip.z'));
        blipSec.appendChild(cr);

        const bg = el('div', 'grid cols-4');
        const spriteField = field('Sprite', 'blip.sprite', 'number', job.blip.sprite, { list: 'spriteList' });
        bg.appendChild(spriteField);
        bg.appendChild(field('Color', 'blip.color', 'number', job.blip.color));
        bg.appendChild(field('Escala', 'blip.scale', 'number', job.blip.scale, { step: '0.1' }));
        bg.appendChild(field('Texto', 'blip.label', 'text', job.blip.label));
        blipSec.appendChild(el('div', null, '<div style="height:12px"></div>'));
        blipSec.appendChild(bg);

        // Recuadro de preview del sprite + selector visual de blips.
        blipSec.appendChild(blipSpritePicker(spriteField.querySelector('input')));

        // Paleta de colores: al pulsar un swatch fija blip.color.
        const palWrap = el('div', 'sub-block');
        palWrap.appendChild(el('h4', null, 'Color del blip'));
        palWrap.appendChild(colorSwatches('blip.color', job.blip.color));
        blipSec.appendChild(palWrap);

        // Previsualizar el blip real en el mapa.
        const prev = el('div', 'outfit-tools');
        const seeBtn = el('button', 'btn small ghost', '👁 Ver en el mapa');
        seeBtn.type = 'button';
        seeBtn.title = 'Crea un blip temporal y centra el mapa';
        seeBtn.addEventListener('click', async () => {
            syncFormToState();
            await nui('previewBlip', {
                x: parseFloat(getInput('blip.x')) || 0,
                y: parseFloat(getInput('blip.y')) || 0,
                z: parseFloat(getInput('blip.z')) || 0,
                sprite: parseInt(getInput('blip.sprite')) || 1,
                color: parseInt(getInput('blip.color')) || 0,
                scale: parseFloat(getInput('blip.scale')) || 0.8,
                label: getInput('blip.label') || job.label || 'Preview',
            });
            toast('Blip de preview puesto. Abre el mapa (M) para verlo.', 'info');
        });
        const clrBtn = el('button', 'btn small ghost', '🧹 Quitar preview');
        clrBtn.type = 'button';
        clrBtn.addEventListener('click', async () => { await nui('clearBlip'); });
        prev.appendChild(seeBtn);
        prev.appendChild(clrBtn);
        blipSec.appendChild(prev);
    }
    mountSection('blip', blipSec);

    // ---- Requisitos ----
    const reqSec = el('div', 'section');
    reqSec.appendChild(el('h3', null, t('sec.req')));
    const rg = el('div', 'grid cols-3');
    rg.appendChild(field('Job requerido', 'req.jobName', 'text', job.req.jobName,
        { placeholder: 'ej: police', title: 'Nombre del job del framework que debe tener el jugador. Vacío = cualquiera.' }));
    rg.appendChild(field('Rango mínimo', 'req.jobGrade', 'number', job.req.jobGrade,
        { title: 'Grado mínimo del job del framework para acceder.' }));
    rg.appendChild(field('Item de acceso', 'req.item', 'text', job.req.item, { placeholder: 'no se consume', autocomplete: 'items' }));
    reqSec.appendChild(rg);
    mountSection('req', reqSec);

    // ---- Duty ----
    mountSection('duty', toggleSection(t('sec.duty'), 'hasDuty', job.hasDuty, t('tg.duty'), (sec) => {
        sec.appendChild(coordRow('duty', job.duty));
        sec.appendChild(sizeRow('duty', job.duty));
        const g = el('div', 'grid');
        g.appendChild(field('Texto "entrar"', 'duty.labelOff', 'text', job.duty.labelOff, { placeholder: 'Fichar (entrar)' }));
        g.appendChild(field('Texto "salir"', 'duty.labelOn', 'text', job.duty.labelOn, { placeholder: 'Fichar (salir)' }));
        sec.appendChild(g);
        sec.appendChild(stationBlipBlock('duty', job.duty.blip, 'Servicio'));
    }));

    // ---- Stash ----
    mountSection('stash', toggleSection(t('sec.stash'), 'hasStash', job.hasStash, t('tg.stash'), (sec) => {
        sec.appendChild(coordRow('stash', job.stash));
        sec.appendChild(sizeRow('stash', job.stash));
        const g = el('div', 'grid');
        g.appendChild(field('ID del stash', 'stash.id', 'text', job.stash.id, { placeholder: 'jc_<job>' }));
        g.appendChild(field('Etiqueta', 'stash.label', 'text', job.stash.label));
        sec.appendChild(g);
        const g2 = el('div', 'grid cols-3');
        g2.appendChild(field('Slots', 'stash.slots', 'number', job.stash.slots));
        g2.appendChild(field('Peso máx (g)', 'stash.weight', 'number', job.stash.weight));
        g2.appendChild(checkField('Requiere servicio', 'stash.requireDuty', job.stash.requireDuty));
        sec.appendChild(g2);
        sec.appendChild(stationBlipBlock('stash', job.stash.blip, 'Cofre'));
    }));

    // ---- Wardrobe ----
    mountSection('wardrobe', toggleSection(t('sec.wardrobe'), 'hasWardrobe', job.hasWardrobe, t('tg.wardrobe'), (sec) => {
        sec.appendChild(coordRow('wardrobe', job.wardrobe));
        sec.appendChild(sizeRow('wardrobe', job.wardrobe));
        const g = el('div', 'grid');
        g.appendChild(field('Etiqueta', 'wardrobe.label', 'text', job.wardrobe.label));
        g.appendChild(checkField('Requiere servicio', 'wardrobe.requireDuty', job.wardrobe.requireDuty));
        sec.appendChild(g);

        const ob = el('div', 'sub-block');
        const oh = el('h4', null, 'Uniformes / conjuntos');
        const ohBtns = el('div', 'h4-actions');
        const restore = el('button', 'btn small ghost', '↩️ Restaurar mi ropa');
        restore.type = 'button';
        restore.title = 'Quita cualquier uniforme de preview';
        restore.addEventListener('click', async () => { await nui('restoreAppearance'); toast('Ropa civil restaurada.', 'ok'); });
        const addO = el('button', 'btn small ghost', '+ Añadir conjunto');
        addO.type = 'button';
        addO.addEventListener('click', () => { syncFormToState(); job.wardrobe.outfits.push(newOutfit()); renderEditor(); });
        ohBtns.appendChild(restore);
        ohBtns.appendChild(addO);
        oh.appendChild(ohBtns);
        ob.appendChild(oh);
        job.wardrobe.outfits.forEach((o, oi) => ob.appendChild(renderOutfit(job, o, oi)));
        sec.appendChild(ob);
        sec.appendChild(stationBlipBlock('wardrobe', job.wardrobe.blip, 'Vestuario'));
    }));

    // ---- Armería / taquilla ----
    mountSection('locker', toggleSection(t('sec.locker'), 'hasLocker', job.hasLocker, t('tg.locker'), (sec) => {
        sec.appendChild(coordRow('locker', job.locker));
        sec.appendChild(sizeRow('locker', job.locker));
        const g = el('div', 'grid');
        g.appendChild(field(t('lk.label'), 'locker.label', 'text', job.locker.label, { placeholder: 'Taquilla / Armería' }));
        g.appendChild(checkField(t('lk.requireDuty'), 'locker.requireDuty', job.locker.requireDuty));
        sec.appendChild(g);
        sec.appendChild(renderRowList(t('lk.items'), job.locker.items,
            (r, ri) => [
                { label: t('lk.item'), path: `locker.items.${ri}.name`, type: 'text', value: r.name, attrs: { autocomplete: 'items' } },
                { label: t('lk.itemLabel'), path: `locker.items.${ri}.label`, type: 'text', value: r.label },
                { label: t('lk.amount'), path: `locker.items.${ri}.amount`, type: 'number', value: r.amount },
                { label: t('lk.limit'), path: `locker.items.${ri}.limit`, type: 'number', value: r.limit },
                { label: t('lk.minGrade'), path: `locker.items.${ri}.minGrade`, type: 'number', value: r.minGrade },
            ],
            () => { syncFormToState(); job.locker.items.push({ name: '', label: '', amount: 1, limit: 0, minGrade: 0 }); renderEditor(); },
            (ri) => { syncFormToState(); job.locker.items.splice(ri, 1); renderEditor(); },
        ));
        sec.appendChild(el('div', 'hint', t('lk.hint')));
        sec.appendChild(stationBlipBlock('locker', job.locker.blip, 'Armería'));
    }));

    // ---- Garaje ----
    mountSection('garage', toggleSection(t('sec.garage'), 'hasGarage', job.hasGarage, t('tg.garage'), (sec) => {
        sec.appendChild(coordRow('garage', job.garage));
        sec.appendChild(sizeRow('garage', job.garage));
        const g = el('div', 'grid');
        g.appendChild(field('Etiqueta', 'garage.label', 'text', job.garage.label, { placeholder: 'Garaje' }));
        g.appendChild(checkField('Requiere servicio', 'garage.requireDuty', job.garage.requireDuty));
        sec.appendChild(g);

        // Punto de aparición del vehículo (con heading).
        const sp = el('div', 'sub-block');
        sp.appendChild(el('h4', null, 'Punto de aparición del vehículo'));
        const spRow = el('div', 'coord-row');
        const spGrid = el('div', 'grid cols-4');
        spGrid.appendChild(field('Spawn X', 'garage.spx', 'number', job.garage.spx, { step: '0.01' }));
        spGrid.appendChild(field('Spawn Y', 'garage.spy', 'number', job.garage.spy, { step: '0.01' }));
        spGrid.appendChild(field('Spawn Z', 'garage.spz', 'number', job.garage.spz, { step: '0.01' }));
        spGrid.appendChild(field('Heading', 'garage.sph', 'number', job.garage.sph, { step: '0.1' }));
        spRow.appendChild(spGrid);
        const spTools = el('div', 'coord-tools');
        spTools.appendChild(posButton('garage.spx', 'garage.spy', 'garage.spz', 'garage.sph'));
        spTools.appendChild(placeButton('garage.spx', 'garage.spy', 'garage.spz', 'garage.sph'));
        spTools.appendChild(gotoButton('garage.spx', 'garage.spy', 'garage.spz'));
        spRow.appendChild(spTools);
        sp.appendChild(spRow);
        sec.appendChild(sp);

        sec.appendChild(renderRowList('Vehículos', job.garage.vehicles,
            (r, ri) => [
                { label: 'Modelo (spawn name)', path: `garage.vehicles.${ri}.model`, type: 'text', value: r.model },
                { label: 'Etiqueta', path: `garage.vehicles.${ri}.label`, type: 'text', value: r.label },
            ],
            () => { syncFormToState(); job.garage.vehicles.push({ model: '', label: '' }); renderEditor(); },
            (ri) => { syncFormToState(); job.garage.vehicles.splice(ri, 1); renderEditor(); },
        ));
        sec.appendChild(stationBlipBlock('garage', job.garage.blip, 'Garaje'));
    }));

    // ---- Jefe ----
    mountSection('boss', toggleSection(t('sec.boss'), 'hasBoss', job.hasBoss, t('tg.boss'), (sec) => {
        sec.appendChild(coordRow('boss', job.boss));
        sec.appendChild(sizeRow('boss', job.boss));
        const g = el('div', 'grid');
        g.appendChild(field('Etiqueta', 'boss.label', 'text', job.boss.label, { placeholder: 'Gestión de empleados' }));
        sec.appendChild(g);
        sec.appendChild(el('div', 'hint',
            'Contratar/despedir/ascender. Pueden usarlo los admins o quien tenga el grado más alto del job (el "jefe"). Requiere framework (ESX/QB/Qbox).'));
        sec.appendChild(stationBlipBlock('boss', job.boss.blip, 'Jefe'));
    }));

    // ---- Grados y salarios ----
    const gradesSec = el('div', 'section');
    const gradesHead = el('h3', null, t('sec.grades'));
    const importG = el('button', 'btn small ghost', t('gr.import'));
    importG.type = 'button';
    importG.title = 'Rellena los grados con los del job de ESX (Job requerido)';
    importG.addEventListener('click', () => {
        syncFormToState();
        const reqJob = (job.req.jobName || '').trim();
        if (!reqJob) { toast('Pon primero el "Job requerido" (ej: police).', 'error'); return; }
        nui('importGrades', { jobName: reqJob });
        toast('Importando grados de ESX…', 'info');
    });
    gradesHead.appendChild(importG);
    gradesSec.appendChild(gradesHead);
    gradesSec.appendChild(el('div', 'hint',
        'El salario se paga por intervalo a quien esté en servicio, según su grado en el framework. El grado más alto es el "jefe". Usa "Importar de ESX" para traer los rangos reales.'));
    gradesSec.appendChild(renderRowList('Grados', job.grades,
        (r, ri) => [
            { label: 'Grado (nº)', path: `grades.${ri}.grade`, type: 'number', value: r.grade },
            { label: 'Nombre', path: `grades.${ri}.name`, type: 'text', value: r.name },
            { label: 'Salario', path: `grades.${ri}.salary`, type: 'number', value: r.salary },
        ],
        () => { syncFormToState(); job.grades.push({ grade: job.grades.length, name: '', salary: 0 }); renderEditor(); },
        (ri) => { syncFormToState(); job.grades.splice(ri, 1); renderEditor(); },
    ));
    mountSection('grades', gradesSec);

    // ---- Sociedad / empresa ----
    mountSection('society', toggleSection(t('sec.society'), 'society.enabled', job.society.enabled, t('tg.society'), (sec) => {
        const g = el('div', 'grid');
        g.appendChild(checkField(t('soc.salary'), 'society.salaryFromFund', job.society.salaryFromFund));
        g.appendChild(checkField(t('soc.rewards'), 'society.rewardsFromFund', job.society.rewardsFromFund));
        sec.appendChild(g);
        sec.appendChild(el('div', 'hint', t('soc.hint')));
    }));

    // ---- Acciones ----
    const actSec = el('div', 'section');
    actSec.appendChild(el('h3', null, t('sec.actions')));
    actSec.appendChild(el('div', 'hint', t('act.hint')));
    [['player', t('act.player')], ['vehicle', t('act.vehicle')]].forEach(([type, title]) => {
        actSec.appendChild(el('h4', null, title));
        const grid = el('div', 'action-grid');
        ACTIONS.filter((a) => a.type === type).forEach((a) => grid.appendChild(renderActionCard(job, a)));
        actSec.appendChild(grid);
    });
    mountSection('actions', actSec);

    // ---- Steps ----
    const stepsSec = el('div', 'section');
    const sh = el('h3', null, t('sec.steps'));
    const shTools = el('div', 'h4-actions');
    const collapseAll = el('button', 'btn small ghost', 'Plegar');
    collapseAll.type = 'button'; collapseAll.title = 'Plegar todos los steps';
    collapseAll.addEventListener('click', () => stepsSec.querySelectorAll('.step-card').forEach((c) => c.classList.add('collapsed')));
    const expandAll = el('button', 'btn small ghost', 'Expandir');
    expandAll.type = 'button'; expandAll.title = 'Expandir todos los steps';
    expandAll.addEventListener('click', () => stepsSec.querySelectorAll('.step-card').forEach((c) => c.classList.remove('collapsed')));
    const addStep = el('button', 'btn small primary', '+ Añadir step');
    addStep.type = 'button';
    addStep.addEventListener('click', () => {
        syncFormToState();
        job.steps.push(newStep());
        renderEditor();
    });
    shTools.appendChild(collapseAll);
    shTools.appendChild(expandAll);
    shTools.appendChild(addStep);
    sh.appendChild(shTools);
    stepsSec.appendChild(sh);

    // Buscador de steps (filtra por ID/etiqueta sin re-renderizar).
    if (job.steps.length > 3) {
        const sb = el('input', 'step-search');
        sb.type = 'text'; sb.placeholder = '🔎 Filtrar steps por ID o etiqueta…';
        sb.addEventListener('input', () => {
            const q = sb.value.trim().toLowerCase();
            stepsSec.querySelectorAll('.step-card').forEach((c) => {
                c.style.display = (!q || (c.dataset.search || '').includes(q)) ? '' : 'none';
            });
        });
        stepsSec.appendChild(sb);
    }

    job.steps.forEach((step, si) => stepsSec.appendChild(renderStep(job, step, si)));
    mountSection('steps', stepsSec);

    // Cada sección ahora es una página: pinta el menú y muestra solo la activa.
    const health = computeHealth(job);
    renderEditorNav(job, health);
    updateJobHealth(health);
    showEditorSection(state.editorSection || 'general');

    // Captura cambios estructurales (añadir/quitar/reordenar) en el historial.
    scheduleSnapshot();
    updateEditorTitle();
}

// Sección con checkbox para activar/desactivar (blip, duty, stash, wardrobe).
function toggleSection(title, togglePath, checked, label, bodyFn) {
    const sec = el('div', 'section');
    const head = el('h3', null, title);
    const tgl = el('label', 'field check');
    const chk = el('input'); chk.type = 'checkbox'; chk.checked = checked;
    chk.dataset.path = togglePath; chk.dataset.type = 'bool';
    chk.addEventListener('change', () => { syncFormToState(); renderEditor(); });
    tgl.appendChild(chk);
    tgl.appendChild(el('span', null, label));
    head.appendChild(tgl);
    sec.appendChild(head);
    if (checked) bodyFn(sec);
    return sec;
}

// Fila de coords X/Y/Z + botón "usar mi posición".
function coordRow(prefix, v) {
    const cr = el('div', 'coord-row');
    const cg = el('div', 'grid cols-3');
    cg.appendChild(field('X', `${prefix}.x`, 'number', v.x, { step: '0.01' }));
    cg.appendChild(field('Y', `${prefix}.y`, 'number', v.y, { step: '0.01' }));
    cg.appendChild(field('Z', `${prefix}.z`, 'number', v.z, { step: '0.01' }));
    cr.appendChild(cg);
    cr.appendChild(coordTools(`${prefix}.x`, `${prefix}.y`, `${prefix}.z`,
        { sx: `${prefix}.sx`, sy: `${prefix}.sy`, sz: `${prefix}.sz` }));
    return cr;
}

// Fila de tamaño de la zona.
function sizeRow(prefix, v) {
    const g = el('div', 'grid cols-3');
    g.appendChild(field('Tamaño X', `${prefix}.sx`, 'number', v.sx, { step: '0.1' }));
    g.appendChild(field('Tamaño Y', `${prefix}.sy`, 'number', v.sy, { step: '0.1' }));
    g.appendChild(field('Tamaño Z', `${prefix}.sz`, 'number', v.sz, { step: '0.1' }));
    return g;
}

// Campo checkbox simple (no re-renderiza; se lee al guardar).
function checkField(label, path, checked) {
    const wrap = el('label', 'field check');
    const chk = el('input'); chk.type = 'checkbox'; chk.checked = checked;
    chk.dataset.path = path; chk.dataset.type = 'bool';
    wrap.appendChild(chk);
    wrap.appendChild(el('span', null, label));
    return wrap;
}

function newOutfit() {
    return { label: 'Nuevo conjunto', civilian: false, components: [], props: [] };
}

// Tarjeta de un uniforme/conjunto del vestuario.
function renderOutfit(job, o, oi) {
    const card = el('div', 'step-card collapsed');
    const head = el('div', 'step-head');
    head.appendChild(el('span', 'chev', '▾'));
    const tw = el('div'); tw.style.flex = '1';
    tw.appendChild(el('div', 'step-title', o.label || `Conjunto ${oi + 1}`));
    tw.appendChild(el('div', 'step-sub', o.civilian ? 'Ropa civil (restaura)' : `${o.components.length} comp · ${o.props.length} props`));
    head.appendChild(tw);
    head.appendChild(reorderButtons(job.wardrobe.outfits, oi, (o2) => JSON.parse(JSON.stringify(o2))));
    const del = el('button', 'btn small danger', 'Quitar');
    del.type = 'button';
    del.addEventListener('click', (e) => { e.stopPropagation(); syncFormToState(); job.wardrobe.outfits.splice(oi, 1); renderEditor(); });
    head.appendChild(del);
    head.addEventListener('click', () => card.classList.toggle('collapsed'));
    card.appendChild(head);

    const body = el('div', 'step-body');
    const p = `wardrobe.outfits.${oi}`;

    const g = el('div', 'grid');
    g.appendChild(field('Etiqueta', `${p}.label`, 'text', o.label));
    const cv = el('label', 'field check');
    const cc = el('input'); cc.type = 'checkbox'; cc.checked = o.civilian;
    cc.dataset.path = `${p}.civilian`; cc.dataset.type = 'bool';
    cc.addEventListener('change', () => { syncFormToState(); renderEditor(); });
    cv.appendChild(cc);
    cv.appendChild(el('span', null, 'Es "ropa civil" (restaura tu ropa)'));
    g.appendChild(cv);
    body.appendChild(g);

    if (!o.civilian) {
        // Toolbar: capturar la ropa puesta y probar el uniforme in-game.
        const tools = el('div', 'outfit-tools');
        const grab = el('button', 'btn small ghost', '👕 Copiar mi ropa actual');
        grab.type = 'button';
        grab.title = 'Rellena este conjunto con lo que llevas puesto';
        grab.addEventListener('click', async () => {
            syncFormToState();
            const a = await nui('getAppearance');
            o.components = (a && a.components) || [];
            o.props = (a && a.props) || [];
            state.dirty = true;
            renderEditor();
            toast('Ropa actual copiada al conjunto.', 'ok');
        });
        const test = el('button', 'btn small ghost', '🧪 Probar uniforme');
        test.type = 'button';
        test.title = 'Te lo pone temporalmente (no guarda)';
        test.addEventListener('click', async () => {
            syncFormToState();
            await nui('previewOutfit', outfitToServer(o));
            toast('Uniforme aplicado (preview). Usa "Restaurar mi ropa" para quitarlo.', 'info');
        });
        tools.appendChild(grab);
        tools.appendChild(test);
        body.appendChild(tools);

        body.appendChild(renderRowList('Componentes (ropa)', o.components,
            (r, ri) => [
                { label: 'Componente', path: `${p}.components.${ri}.component`, type: 'number', value: r.component },
                { label: 'Drawable', path: `${p}.components.${ri}.drawable`, type: 'number', value: r.drawable },
                { label: 'Textura', path: `${p}.components.${ri}.texture`, type: 'number', value: r.texture },
            ],
            () => { syncFormToState(); o.components.push({ component: 11, drawable: 0, texture: 0 }); renderEditor(); },
            (ri) => { syncFormToState(); o.components.splice(ri, 1); renderEditor(); },
        ));
        body.appendChild(renderRowList('Props (gorra, gafas...)', o.props,
            (r, ri) => [
                { label: 'Prop', path: `${p}.props.${ri}.prop`, type: 'number', value: r.prop },
                { label: 'Drawable', path: `${p}.props.${ri}.drawable`, type: 'number', value: r.drawable },
                { label: 'Textura', path: `${p}.props.${ri}.texture`, type: 'number', value: r.texture },
            ],
            () => { syncFormToState(); o.props.push({ prop: 0, drawable: 0, texture: 0 }); renderEditor(); },
            (ri) => { syncFormToState(); o.props.splice(ri, 1); renderEditor(); },
        ));
        body.appendChild(el('div', 'hint',
            'Componentes: 11 torso · 3 brazos · 8 camiseta · 4 pantalón · 6 calzado · 1 máscara · 9 chaleco · 5 mochila. Props: 0 sombrero · 1 gafas.'));
    }

    card.appendChild(body);
    return card;
}

// Prueba un step en vivo. Requiere el job guardado (el servidor usa la versión
// en BD), así que avisamos si hay cambios sin guardar.
function testStep(job, si) {
    const step = job.steps[si];
    if (!step.id || !step.id.trim()) { toast('El step necesita un ID.', 'error'); return; }
    if (state.dirty) { toast('Guarda el job antes de probar (Ctrl+S).', 'error'); return; }
    nui('testStep', { jobName: job.name.trim(), stepId: step.id.trim() });
    toast('Probando step…', 'info');
}

function newStep() {
    return {
        id: '', label: '',
        tx: 0, ty: 0, tz: 0, sx: 2.0, sy: 2.0, sz: 2.0, icon: '', tlabel: '',
        progDuration: 0, progLabel: '', animDict: '', animClip: '', cooldown: 0, minGrade: 0,
        requires: [], rewardItems: [],
        money: { enabled: false, min: 0, max: 0, account: 'cash' },
    };
}

function renderStep(job, step, si) {
    const card = el('div', 'step-card');
    card.dataset.search = `${step.id || ''} ${step.label || ''}`.toLowerCase();
    const head = el('div', 'step-head');
    head.appendChild(el('span', 'chev', '▾'));
    const titleWrap = el('div'); titleWrap.style.flex = '1';
    titleWrap.appendChild(el('div', 'step-title', step.id || `Step ${si + 1}`));
    titleWrap.appendChild(el('div', 'step-sub', step.label || '—'));
    head.appendChild(titleWrap);

    head.appendChild(reorderButtons(job.steps, si, (s) => {
        const c = JSON.parse(JSON.stringify(s));
        c.id = uniqueStepId(job, c.id);
        return c;
    }));

    const testBtn = el('button', 'btn small ghost', '🧪');
    testBtn.type = 'button';
    testBtn.title = 'Probar este step (simular)';
    testBtn.addEventListener('click', (e) => { e.stopPropagation(); testStep(job, si); });
    head.appendChild(testBtn);

    const del = el('button', 'btn small danger', 'Quitar');
    del.type = 'button';
    del.addEventListener('click', (e) => {
        e.stopPropagation();
        syncFormToState();
        job.steps.splice(si, 1);
        renderEditor();
    });
    head.appendChild(del);
    head.addEventListener('click', () => card.classList.toggle('collapsed'));
    card.appendChild(head);

    const body = el('div', 'step-body');
    const p = `steps.${si}`;

    const idGrid = el('div', 'grid');
    idGrid.appendChild(field('ID del step', `${p}.id`, 'text', step.id));
    idGrid.appendChild(field('Etiqueta', `${p}.label`, 'text', step.label));
    body.appendChild(idGrid);

    // Target
    const tBlock = el('div', 'sub-block');
    tBlock.appendChild(el('h4', null, 'Zona (target)'));
    const tcr = el('div', 'coord-row');
    const tcg = el('div', 'grid cols-3');
    tcg.appendChild(field('X', `${p}.tx`, 'number', step.tx, { step: '0.01' }));
    tcg.appendChild(field('Y', `${p}.ty`, 'number', step.ty, { step: '0.01' }));
    tcg.appendChild(field('Z', `${p}.tz`, 'number', step.tz, { step: '0.01' }));
    tcr.appendChild(tcg);
    tcr.appendChild(coordTools(`${p}.tx`, `${p}.ty`, `${p}.tz`,
        { sx: `${p}.sx`, sy: `${p}.sy`, sz: `${p}.sz` }));
    tBlock.appendChild(tcr);

    const tsz = el('div', 'grid cols-3');
    tsz.appendChild(field('Tamaño X', `${p}.sx`, 'number', step.sx, { step: '0.1' }));
    tsz.appendChild(field('Tamaño Y', `${p}.sy`, 'number', step.sy, { step: '0.1' }));
    tsz.appendChild(field('Tamaño Z', `${p}.sz`, 'number', step.sz, { step: '0.1' }));
    tBlock.appendChild(tsz);

    const tmeta = el('div', 'grid');
    tmeta.appendChild(iconField(`${p}.icon`, step.icon));
    tmeta.appendChild(field('Texto del target', `${p}.tlabel`, 'text', step.tlabel));
    tBlock.appendChild(tmeta);
    body.appendChild(tBlock);

    // Progreso + anim
    const pBlock = el('div', 'sub-block');
    pBlock.appendChild(el('h4', null, 'Progreso y animación'));
    const pg = el('div', 'grid cols-4');
    pg.appendChild(field('Duración (ms)', `${p}.progDuration`, 'number', step.progDuration));
    pg.appendChild(field('Texto progreso', `${p}.progLabel`, 'text', step.progLabel));
    pg.appendChild(field('Anim dict', `${p}.animDict`, 'text', step.animDict));
    pg.appendChild(field('Anim clip', `${p}.animClip`, 'text', step.animClip));
    pBlock.appendChild(pg);
    const cdGrid = el('div', 'grid');
    cdGrid.appendChild(field('Cooldown anti-spam (ms, 0 = automático)', `${p}.cooldown`, 'number', step.cooldown,
        { placeholder: '0 = usa la duración del progreso' }));
    cdGrid.appendChild(field(t('st.minGrade'), `${p}.minGrade`, 'number', step.minGrade,
        { title: 'Grado mínimo del job para completar este step (0 = sin requisito).' }));
    pBlock.appendChild(cdGrid);
    pBlock.appendChild(animTools(`${p}.animDict`, `${p}.animClip`));
    body.appendChild(pBlock);

    // Requires (items a consumir)
    body.appendChild(renderRowList(
        'Materiales requeridos (se consumen)',
        step.requires,
        (r, ri) => [
            { label: 'Item', path: `${p}.requires.${ri}.name`, type: 'text', value: r.name, attrs: { autocomplete: 'items' } },
            { label: 'Cantidad', path: `${p}.requires.${ri}.count`, type: 'number', value: r.count },
        ],
        () => { syncFormToState(); step.requires.push({ name: '', count: 1 }); renderEditor(); },
        (ri) => { syncFormToState(); step.requires.splice(ri, 1); renderEditor(); },
    ));

    // Reward items
    body.appendChild(renderRowList(
        'Recompensa: items',
        step.rewardItems,
        (r, ri) => [
            { label: 'Item', path: `${p}.rewardItems.${ri}.name`, type: 'text', value: r.name, attrs: { autocomplete: 'items' } },
            { label: 'Min', path: `${p}.rewardItems.${ri}.min`, type: 'number', value: r.min },
            { label: 'Max', path: `${p}.rewardItems.${ri}.max`, type: 'number', value: r.max },
        ],
        () => { syncFormToState(); step.rewardItems.push({ name: '', min: 1, max: 1 }); renderEditor(); },
        (ri) => { syncFormToState(); step.rewardItems.splice(ri, 1); renderEditor(); },
    ));

    // Reward money
    const mBlock = el('div', 'sub-block');
    const mh = el('h4', null, 'Recompensa: dinero');
    const mToggle = el('label', 'field check');
    const mCheck = el('input'); mCheck.type = 'checkbox'; mCheck.checked = step.money.enabled;
    mCheck.dataset.path = `${p}.money.enabled`; mCheck.dataset.type = 'bool';
    mCheck.addEventListener('change', () => { syncFormToState(); renderEditor(); });
    mToggle.appendChild(mCheck);
    mToggle.appendChild(el('span', null, 'Pagar dinero'));
    mh.appendChild(mToggle);
    mBlock.appendChild(mh);
    if (step.money.enabled) {
        const mg = el('div', 'grid cols-3');
        mg.appendChild(field('Min', `${p}.money.min`, 'number', step.money.min));
        mg.appendChild(field('Max', `${p}.money.max`, 'number', step.money.max));
        const acc = el('label', 'field');
        acc.appendChild(el('span', null, 'Cuenta'));
        const sel = el('select'); sel.dataset.path = `${p}.money.account`; sel.dataset.type = 'text';
        ['cash', 'bank'].forEach((a) => {
            const o = el('option', null, a); o.value = a;
            if (step.money.account === a) o.selected = true;
            sel.appendChild(o);
        });
        acc.appendChild(sel);
        mg.appendChild(acc);
        mBlock.appendChild(mg);
    }
    body.appendChild(mBlock);

    card.appendChild(body);
    return card;
}

// Lista genérica de filas (requires / reward items) con añadir/quitar
function renderRowList(title, rows, fieldsFn, onAdd, onRemove) {
    const block = el('div', 'sub-block');
    const h = el('h4', null, title);
    const add = el('button', 'btn small ghost', '+ Añadir');
    add.type = 'button';
    add.addEventListener('click', onAdd);
    h.appendChild(add);
    block.appendChild(h);

    const list = el('div', 'row-list');
    rows.forEach((row, ri) => {
        const r = el('div', 'mini-row');
        fieldsFn(row, ri).forEach((f) => {
            r.appendChild(field(f.label, f.path, f.type, f.value, f.attrs));
        });
        const rm = el('button', 'btn small danger', '✕');
        rm.type = 'button';
        rm.addEventListener('click', () => onRemove(ri));
        r.appendChild(rm);
        list.appendChild(r);
    });
    block.appendChild(list);
    return block;
}

// ============================================================
//  Acciones
// ============================================================
// Modelo de editor vacío (base para "nuevo" y para las plantillas).
function blankJobModel(name, label) {
    return {
        _extra: {},
        name: name || 'nuevo_job', label: label || 'Nuevo Job', type: '', enabled: true, hasBlip: false,
        blip: { x: 0, y: 0, z: 0, sprite: 1, color: 0, scale: 0.8, label: '' },
        req: { jobName: '', jobGrade: 0, item: '' },
        hasDuty: false, duty: dutyToEditor(null),
        hasStash: false, stash: stashToEditor(null),
        hasWardrobe: false, wardrobe: wardrobeToEditor(null),
        hasLocker: false, locker: lockerToEditor(null),
        hasGarage: false, garage: garageToEditor(null),
        hasBoss: false, boss: bossToEditor(null),
        grades: [],
        society: { enabled: false, salaryFromFund: true, rewardsFromFund: true },
        actions: actionsToEditor(null),
        steps: [],
    };
}

function newJob() {
    if (state.selected >= 0) syncFormToState();
    const ed = blankJobModel();
    state.jobs.push(ed);
    state.dirty = true;
    selectJob(state.jobs.length - 1);
}

// ---------- Plantillas ----------
const TEMPLATES = [
    {
        label: 'En blanco',
        desc: 'Job vacío para empezar de cero.',
        build: () => blankJobModel(),
    },
    {
        label: 'Recolector',
        desc: '1 zona donde recoges un material (con animación y recompensa de item).',
        build: () => {
            const ed = blankJobModel('recolector', 'Recolector');
            ed.hasBlip = true; ed.blip.sprite = 478; ed.blip.color = 2; ed.blip.label = 'Recolector';
            const s = newStep();
            s.id = 'recoger'; s.label = 'Recoger material'; s.icon = 'fa-solid fa-hand';
            s.tlabel = 'Recoger'; s.progDuration = 4000; s.progLabel = 'Recogiendo…';
            s.animDict = 'amb@world_human_gardener_plant@male@base'; s.animClip = 'base';
            s.rewardItems = [{ name: '', min: 1, max: 2 }];
            ed.steps = [s];
            return ed;
        },
    },
    {
        label: 'Entrega A → B',
        desc: 'Recoge un paquete en A y entrégalo en B por dinero.',
        build: () => {
            const ed = blankJobModel('entrega', 'Entrega');
            ed.hasBlip = true; ed.blip.sprite = 280; ed.blip.color = 5; ed.blip.label = 'Entregas';
            const a = newStep();
            a.id = 'recoger'; a.label = 'Recoger paquete'; a.tlabel = 'Recoger'; a.icon = 'fa-solid fa-box';
            a.progDuration = 2000; a.progLabel = 'Cargando…'; a.rewardItems = [{ name: 'paquete', min: 1, max: 1 }];
            const b = newStep();
            b.id = 'entregar'; b.label = 'Entregar paquete'; b.tlabel = 'Entregar'; b.icon = 'fa-solid fa-truck';
            b.progDuration = 2000; b.progLabel = 'Entregando…';
            b.requires = [{ name: 'paquete', count: 1 }];
            b.money = { enabled: true, min: 150, max: 300, account: 'cash' };
            ed.steps = [a, b];
            return ed;
        },
    },
    {
        label: 'Servicio (duty + stash + ropa)',
        desc: 'Tipo policía/EMS: punto de servicio, cofre y vestuario con un uniforme.',
        build: () => {
            const ed = blankJobModel('servicio', 'Servicio');
            ed.type = 'service';
            ed.hasBlip = true; ed.blip.sprite = 280; ed.blip.color = 3; ed.blip.label = 'Servicio';
            ed.hasDuty = true; ed.duty.labelOff = 'Fichar (entrar)'; ed.duty.labelOn = 'Fichar (salir)';
            ed.hasStash = true; ed.stash.id = 'jc_servicio'; ed.stash.label = 'Cofre de servicio'; ed.stash.requireDuty = true;
            ed.hasWardrobe = true; ed.wardrobe.label = 'Vestuario'; ed.wardrobe.requireDuty = true;
            const o = newOutfit();
            o.label = 'Uniforme';
            o.components = [
                { component: 11, drawable: 0, texture: 0 },
                { component: 4, drawable: 0, texture: 0 },
                { component: 6, drawable: 0, texture: 0 },
            ];
            ed.wardrobe.outfits = [o];
            return ed;
        },
    },
];

function addJobFromTemplate(build) {
    if (state.selected >= 0) syncFormToState();
    const ed = build();
    ed.name = uniqueName(ed.name);
    state.jobs.push(ed);
    state.dirty = true;
    selectJob(state.jobs.length - 1);
    toast('Job creado desde plantilla. Ajusta las coords y guarda.', 'ok');
}

// ---------- Tema: color de acento (localStorage) ----------
const ACCENT_KEY = 'jc_accent';
const ACCENTS = ['#5b8dff', '#34d27b', '#f5b042', '#ef4565', '#9b6ad6', '#22b8cf', '#ff7849', '#e84393'];

function hexToRgb(h) {
    h = (h || '').replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function darken(h, f) {
    const [r, g, b] = hexToRgb(h);
    const d = (x) => Math.max(0, Math.round(x * (1 - f)));
    return `rgb(${d(r)}, ${d(g)}, ${d(b)})`;
}
function applyAccent(hex) {
    const root = document.documentElement.style;
    root.setProperty('--accent', hex);
    root.setProperty('--accent-2', darken(hex, 0.22));
    const [r, g, b] = hexToRgb(hex);
    root.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, 0.15)`);
}
function loadAccent() {
    let h;
    try { h = localStorage.getItem(ACCENT_KEY); } catch (e) { h = null; }
    if (h) applyAccent(h);
    return h || '#5b8dff';
}
function buildAccentPicker() {
    const wrap = document.getElementById('accentSwatches');
    if (!wrap) return;
    wrap.innerHTML = '';
    let current = '#5b8dff';
    try { current = localStorage.getItem(ACCENT_KEY) || current; } catch (e) { /* */ }
    const persist = (hex) => { try { localStorage.setItem(ACCENT_KEY, hex); } catch (e) { /* */ } };
    ACCENTS.forEach((hex) => {
        const sw = el('button', 'swatch' + (hex.toLowerCase() === current.toLowerCase() ? ' sel' : ''));
        sw.type = 'button'; sw.style.background = hex; sw.title = hex;
        sw.addEventListener('click', () => {
            applyAccent(hex); persist(hex);
            wrap.querySelectorAll('.swatch').forEach((s) => s.classList.remove('sel'));
            sw.classList.add('sel');
        });
        wrap.appendChild(sw);
    });
    const custom = el('input', 'accent-custom');
    custom.type = 'color'; custom.value = current; custom.title = 'Color personalizado';
    custom.addEventListener('input', () => {
        applyAccent(custom.value); persist(custom.value);
        wrap.querySelectorAll('.swatch').forEach((s) => s.classList.remove('sel'));
    });
    wrap.appendChild(custom);
}

// ---------- Plantillas propias (localStorage) ----------
const TPL_KEY = 'jc_user_templates';
function loadUserTemplates() {
    try { return JSON.parse(localStorage.getItem(TPL_KEY) || '[]'); } catch (e) { return []; }
}
function saveUserTemplates(arr) {
    try { localStorage.setItem(TPL_KEY, JSON.stringify(arr)); } catch (e) { /* sin persistencia */ }
}

function saveCurrentAsTemplate() {
    if (state.selected < 0) { toast('Selecciona un job primero.', 'error'); return; }
    syncFormToState();
    const ed = state.jobs[state.selected];
    const body = el('div');
    body.appendChild(el('p', 'modal-text', 'Nombre para la plantilla:'));
    const input = el('input', 'icon-search');
    input.type = 'text';
    input.value = ed.label || ed.name || 'Mi plantilla';
    body.appendChild(input);
    openModal('Guardar como plantilla', body, [
        { label: 'Cancelar', cls: 'ghost', onClick: closeModalRaw },
        {
            label: 'Guardar', cls: 'primary', onClick: () => {
                const nm = input.value.trim();
                if (!nm) { toast('Pon un nombre.', 'error'); return; }
                const arr = loadUserTemplates();
                arr.push({ name: nm, job: toServer(ed) });
                saveUserTemplates(arr);
                closeModalRaw();
                toast('Plantilla guardada.', 'ok');
            },
        },
    ]);
    input.focus(); input.select();
}

function chooseTemplate() {
    const body = el('div', 'tpl-list');
    TEMPLATES.forEach((t) => {
        const card = el('button', 'tpl-card');
        card.type = 'button';
        card.appendChild(el('div', 'tpl-name', t.label));
        card.appendChild(el('div', 'tpl-desc', t.desc));
        card.addEventListener('click', () => { closeModalRaw(); addJobFromTemplate(t.build); });
        body.appendChild(card);
    });

    const user = loadUserTemplates();
    if (user.length) {
        body.appendChild(el('div', 'tpl-sep', 'Tus plantillas'));
        user.forEach((t, idx) => {
            const card = el('div', 'tpl-card tpl-user');
            const main = el('button', 'tpl-card-main');
            main.type = 'button';
            main.appendChild(el('div', 'tpl-name', t.name));
            main.appendChild(el('div', 'tpl-desc', 'Plantilla guardada por ti'));
            main.addEventListener('click', () => { closeModalRaw(); addJobFromTemplate(() => toEditor(t.job)); });
            const del = el('button', 'btn small danger', '✕');
            del.type = 'button'; del.title = 'Borrar plantilla';
            del.addEventListener('click', (e) => {
                e.stopPropagation();
                const arr = loadUserTemplates();
                arr.splice(idx, 1);
                saveUserTemplates(arr);
                chooseTemplate(); // refresca el modal
            });
            card.appendChild(main);
            card.appendChild(del);
            body.appendChild(card);
        });
    }

    openModal('Nuevo job desde plantilla', body, [
        { label: '💾 Guardar job actual', cls: 'ghost', onClick: () => { closeModalRaw(); saveCurrentAsTemplate(); } },
        { label: 'Cerrar', cls: 'primary', onClick: closeModalRaw },
    ]);
}

// Genera un nombre interno único a partir de uno base (para duplicar/importar).
function uniqueName(base) {
    base = (base || 'job').trim() || 'job';
    const taken = (nm) => state.jobs.some((j) => j.name.trim() === nm);
    if (!taken(base)) return base;
    let candidate = base + '_copia', i = 2;
    while (taken(candidate)) { candidate = `${base}_copia${i}`; i++; }
    return candidate;
}

function duplicateJob() {
    if (state.selected < 0) return;
    syncFormToState();
    const src = state.jobs[state.selected];
    const copy = JSON.parse(JSON.stringify(src)); // el modelo de editor es plano (JSON-safe)
    copy.name = uniqueName(src.name);
    copy.label = src.label ? `${src.label} (copia)` : src.label;
    state.jobs.push(copy);
    state.dirty = true;
    selectJob(state.jobs.length - 1);
    toast('Job duplicado. Revisa el nombre y pulsa Guardar.', 'ok');
}

// Reúne las zonas (con coords) de un job para validarlas.
function collectZones(ed) {
    const z = [];
    if (ed.hasBlip) z.push({ name: 'blip', x: ed.blip.x, y: ed.blip.y, z: ed.blip.z });
    if (ed.hasDuty) z.push({ name: 'duty', x: ed.duty.x, y: ed.duty.y, z: ed.duty.z });
    if (ed.hasStash) z.push({ name: 'stash', x: ed.stash.x, y: ed.stash.y, z: ed.stash.z });
    if (ed.hasWardrobe) z.push({ name: 'vestuario', x: ed.wardrobe.x, y: ed.wardrobe.y, z: ed.wardrobe.z });
    if (ed.hasLocker) z.push({ name: 'taquilla', x: ed.locker.x, y: ed.locker.y, z: ed.locker.z });
    if (ed.hasGarage) z.push({ name: 'garaje', x: ed.garage.x, y: ed.garage.y, z: ed.garage.z });
    if (ed.hasBoss) z.push({ name: 'jefe', x: ed.boss.x, y: ed.boss.y, z: ed.boss.z });
    ed.steps.forEach((s, i) => z.push({ name: `step "${s.id || i + 1}"`, x: s.tx, y: s.ty, z: s.tz }));
    return z;
}

// Avisos no bloqueantes (items desconocidos, coords sin colocar, solapes...).
function validateWarnings(ed, selfIndex) {
    const warnings = [];
    const known = (state.items && state.items.length) ? new Set(state.items) : null;
    const checkItem = (name, where) => {
        const n = (name || '').trim();
        if (n && known && !known.has(n)) warnings.push(`Item desconocido en ${where}: "${n}".`);
    };
    checkItem(ed.req.item, 'requisito de acceso');
    ed.steps.forEach((s) => {
        (s.requires || []).forEach((r) => checkItem(r.name, `materiales de "${s.id}"`));
        (s.rewardItems || []).forEach((r) => checkItem(r.name, `recompensa de "${s.id}"`));
    });

    collectZones(ed).forEach((zn) => {
        if (Math.abs(zn.x) < 0.01 && Math.abs(zn.y) < 0.01 && Math.abs(zn.z) < 0.01) {
            warnings.push(`La zona ${zn.name} está en 0,0,0 (sin colocar).`);
        }
    });

    // Zonas casi solapadas dentro del job (ignoramos el blip).
    const zs = collectZones(ed).filter((z) => z.name !== 'blip');
    for (let i = 0; i < zs.length; i++) {
        for (let j = i + 1; j < zs.length; j++) {
            const a = zs[i], b = zs[j];
            if (Math.abs(a.x - b.x) < 0.3 && Math.abs(a.y - b.y) < 0.3 && Math.abs(a.z - b.z) < 0.3) {
                warnings.push(`Zonas casi solapadas: ${a.name} y ${b.name}.`);
            }
        }
    }

    // ID de stash repetido en otro job (compartirían el mismo cofre).
    if (ed.hasStash) {
        const sid = (ed.stash.id || '').trim();
        if (sid) {
            state.jobs.forEach((j, i) => {
                if (i !== selfIndex && j.hasStash && (j.stash.id || '').trim() === sid) {
                    warnings.push(`El ID de stash "${sid}" ya lo usa el job "${j.name}".`);
                }
            });
        }
    }
    return warnings;
}

// Reporte completo (para el botón "Validar"): errores duros + avisos.
function validateReport() {
    if (state.selected < 0) return;
    syncFormToState();
    const ed = state.jobs[state.selected];
    const errors = [];
    if (!ed.name.trim()) errors.push('Falta el nombre interno del job.');
    if (ed.name.trim() && state.jobs.some((j, i) => i !== state.selected && j.name.trim() === ed.name.trim())) {
        errors.push('Otro job ya usa ese nombre interno.');
    }
    const ids = {};
    ed.steps.forEach((s, i) => {
        const id = (s.id || '').trim();
        if (!id) errors.push(`El step #${i + 1} no tiene ID.`);
        else if (ids[id]) errors.push(`ID de step duplicado: "${id}".`);
        else ids[id] = true;
    });
    const warnings = validateWarnings(ed, state.selected);

    const body = el('div');
    if (!errors.length && !warnings.length) {
        body.appendChild(el('p', 'modal-text', '✅ Todo correcto. No se han encontrado problemas.'));
    } else {
        if (errors.length) {
            body.appendChild(el('p', 'modal-text', `❌ ${errors.length} error(es) (impiden guardar):`));
            const ul = el('ul', 'vlist err');
            errors.forEach((e) => ul.appendChild(el('li', null, e)));
            body.appendChild(ul);
        }
        if (warnings.length) {
            body.appendChild(el('p', 'modal-text', `⚠️ ${warnings.length} aviso(s) (no bloquean):`));
            const ul = el('ul', 'vlist warn');
            warnings.forEach((w) => ul.appendChild(el('li', null, w)));
            body.appendChild(ul);
        }
    }
    openModal('Validación del job', body, [{ label: 'Cerrar', cls: 'primary', onClick: closeModalRaw }]);
}

// Quita el resaltado de error de todos los campos.
function clearInvalid() {
    document.querySelectorAll('#jobForm .invalid').forEach((e) => e.classList.remove('invalid'));
}

// Resalta un campo inválido por su data-path, lo expande si está en un step
// colapsado, hace scroll hasta él y avisa con un toast.
function markInvalid(path, msg) {
    if (msg) toast(msg, 'error');
    // El campo puede estar en otra página del editor: navega a su sección primero.
    const target = sectionForPath(path);
    if (state.editorSection !== target) { state.editorSection = target; showEditorSection(target); }
    const input = document.querySelector(`#jobForm [data-path="${path}"]`);
    if (!input) return;
    input.classList.add('invalid');
    const card = input.closest('.step-card');
    if (card) card.classList.remove('collapsed');
    input.scrollIntoView({ block: 'center', behavior: 'smooth' });
    input.focus();
}

async function saveJob() {
    syncFormToState();
    clearInvalid();
    const ed = state.jobs[state.selected];
    if (!ed.name.trim()) { markInvalid('name', 'El job necesita un nombre interno.'); return; }
    const dup = state.jobs.some((j, i) => i !== state.selected && j.name.trim() === ed.name.trim());
    if (dup) { markInvalid('name', 'Ya existe otro job con ese nombre.'); return; }
    // Espeja la validación del servidor (validateJob) para dar feedback preciso.
    const ids = {};
    for (let i = 0; i < ed.steps.length; i++) {
        const id = (ed.steps[i].id || '').trim();
        if (!id) { markInvalid(`steps.${i}.id`, `El step #${i + 1} necesita un ID.`); return; }
        if (ids[id]) { markInvalid(`steps.${i}.id`, `ID de step duplicado: ${id}`); return; }
        ids[id] = true;
    }

    // Avisos no bloqueantes: dejamos guardar, pero confirmamos antes.
    const warnings = validateWarnings(ed, state.selected);
    if (warnings.length) {
        const list = warnings.slice(0, 8).map((w) => '• ' + w).join('\n')
            + (warnings.length > 8 ? `\n…y ${warnings.length - 8} más` : '');
        const ok = await confirmModal(
            `Hay ${warnings.length} aviso(s):\n\n${list}\n\n¿Guardar de todas formas?`,
            { title: 'Avisos de validación', okLabel: 'Guardar igualmente', cancelLabel: 'Revisar' });
        if (!ok) return;
    }

    await nui('saveJob', toServer(ed));
    state.dirty = false;
    clearDraft(ed);            // ya está en el servidor: el borrador deja de hacer falta
    draftOffered.delete((ed.name || '').trim());
    renderSidebar();
    updateEditorTitle();
    toast(`Job "${ed.name.trim()}" guardado.`, 'ok');
}

async function deleteJob() {
    if (state.selected < 0) return;
    const ed = state.jobs[state.selected];
    const ok = await confirmModal(
        `¿Eliminar el job "${ed.name}"? Esto borra su definición de la base de datos.`,
        { title: 'Eliminar job', okLabel: 'Eliminar', danger: true });
    if (!ok) return;
    await nui('deleteJob', { name: ed.name });
    state.jobs.splice(state.selected, 1);
    state.selected = -1;
    renderSidebar();
    showOverview(); // tras borrar, volvemos a la lista
    toast(`Job "${ed.name}" eliminado.`, 'ok');
}

// ---------- Import / Export JSON ----------
function copyText(txt) {
    const fallback = () => {
        const ta = document.createElement('textarea');
        ta.value = txt;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        ta.remove();
        toast(ok ? 'Copiado al portapapeles.' : 'No se pudo copiar; selecciona y copia manualmente.', ok ? 'ok' : 'error');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(() => toast('Copiado al portapapeles.', 'ok'), fallback);
    } else {
        fallback();
    }
}

function exportJob() {
    if (state.selected < 0) return;
    syncFormToState();
    const ed = state.jobs[state.selected];
    const jsonStr = JSON.stringify(toServer(ed), null, 2);
    const ta = el('textarea', 'modal-textarea');
    ta.value = jsonStr;
    ta.readOnly = true;
    openModal(`Exportar "${ed.name}"`, ta, [
        { label: 'Cerrar', cls: 'ghost', onClick: closeModalRaw },
        { label: 'Copiar', cls: 'primary', onClick: () => copyText(jsonStr) },
    ]);
    ta.focus();
    ta.select();
}

function importJob() {
    const ta = el('textarea', 'modal-textarea');
    ta.placeholder = 'Pega aquí el JSON de un job exportado…';
    openModal('Importar job (JSON)', ta, [
        { label: 'Cancelar', cls: 'ghost', onClick: closeModalRaw },
        { label: 'Importar', cls: 'primary', onClick: () => doImport(ta.value) },
    ]);
    ta.focus();
}

// ---------- Backup total: exportar / importar TODOS los jobs ----------
function exportAll() {
    if (!state.jobs.length) { toast('No hay jobs que exportar.', 'error'); return; }
    if (state.selected >= 0) syncFormToState();
    const jsonStr = JSON.stringify(state.jobs.map(toServer), null, 2);
    const ta = el('textarea', 'modal-textarea');
    ta.value = jsonStr;
    ta.readOnly = true;
    openModal(`Backup de ${state.jobs.length} job(s)`, ta, [
        { label: 'Cerrar', cls: 'ghost', onClick: closeModalRaw },
        { label: 'Copiar', cls: 'primary', onClick: () => copyText(jsonStr) },
    ]);
    ta.focus();
    ta.select();
}

function importAll() {
    const ta = el('textarea', 'modal-textarea');
    ta.placeholder = 'Pega aquí el JSON de un backup (lista de jobs)…';
    openModal('Restaurar backup (varios jobs)', ta, [
        { label: 'Cancelar', cls: 'ghost', onClick: closeModalRaw },
        { label: 'Restaurar', cls: 'primary', onClick: () => doImportAll(ta.value) },
    ]);
    ta.focus();
}

async function doImportAll(text) {
    let arr;
    try { arr = JSON.parse(text); }
    catch (e) { toast('JSON inválido: ' + e.message, 'error'); return; }
    if (!Array.isArray(arr)) { toast('El backup debe ser una lista [ ... ] de jobs.', 'error'); return; }
    const valid = arr.filter((o) => o && typeof o === 'object' && !Array.isArray(o)
        && typeof o.name === 'string' && o.name.trim());
    if (!valid.length) { toast('No hay jobs válidos en el JSON.', 'error'); return; }

    const ok = await confirmModal(
        `Se guardarán ${valid.length} job(s) en la base de datos. Los que tengan un nombre ya existente se sobrescribirán. ¿Continuar?`,
        { title: 'Restaurar backup', okLabel: 'Restaurar', cancelLabel: 'Cancelar' });
    if (!ok) return;

    for (const job of valid) await nui('saveJob', job);

    // Refleja el resultado en el panel: fusiona por nombre (importados ganan).
    const byName = {};
    state.jobs.forEach((j) => { byName[j.name.trim()] = j; });
    valid.forEach((o) => { byName[o.name.trim()] = toEditor(o); });
    state.jobs = Object.values(byName);
    state.selected = -1;
    state.dirty = false;
    closeModalRaw();
    renderSidebar();
    showOverview();
    toast(`${valid.length} job(s) restaurados y guardados.`, 'ok');
}

function doImport(text) {
    let obj;
    try { obj = JSON.parse(text); }
    catch (e) { toast('JSON inválido: ' + e.message, 'error'); return; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        toast('El JSON debe ser un objeto de job.', 'error'); return;
    }
    if (typeof obj.name !== 'string' || !obj.name.trim()) {
        toast('El job necesita un campo "name".', 'error'); return;
    }
    if (state.selected >= 0) syncFormToState();
    const ed = toEditor(obj);
    ed.name = uniqueName(ed.name); // evita colisiones con jobs existentes
    state.jobs.push(ed);
    state.dirty = true;
    closeModalRaw();
    selectJob(state.jobs.length - 1);
    toast('Job importado. Revisa y pulsa Guardar.', 'ok');
}

// ============================================================
//  Ayuda y atajos
// ============================================================
function showHelp() {
    const body = el('div', 'help-body');
    const shortcuts = [
        ['Ctrl + K', 'Paleta de comandos (saltar a sección / job / acción)'],
        ['Alt + ↑ / ↓', 'Página anterior / siguiente del editor'],
        ['Esc', 'Cerrar paleta, modal o panel'],
        ['Ctrl + S', 'Guardar el job en edición'],
        ['Ctrl + Z', 'Deshacer el último cambio'],
        ['Ctrl + Y  /  Ctrl + Shift + Z', 'Rehacer'],
        ['?', 'Abrir esta ayuda'],
    ];
    body.appendChild(el('h4', 'help-h', 'Atajos de teclado'));
    const kb = el('div', 'help-keys');
    shortcuts.forEach(([k, d]) => {
        const row = el('div', 'help-row');
        row.appendChild(el('span', 'help-kbd', k));
        row.appendChild(el('span', 'help-desc', d));
        kb.appendChild(row);
    });
    body.appendChild(kb);

    body.appendChild(el('h4', 'help-h', 'Herramientas de coordenadas'));
    const tips = el('ul', 'help-list');
    [
        ['📍 Aquí', 'usa tu posición actual'],
        ['🎯 Colocar', 'apunta con la cámara en el mundo y confirma con Enter/clic'],
        ['🗺️ Mapa', 'usa la marca (waypoint) del mapa'],
        ['🚀 Ir', 'te teletransporta a esas coordenadas'],
        ['📦 Zona', 'dibuja la caja de la zona en el mundo'],
        ['👁 Ver en el mapa', 'crea un blip temporal de preview'],
    ].forEach(([b, d]) => {
        const li = el('li');
        li.appendChild(el('b', null, b));
        li.appendChild(document.createTextNode(' — ' + d));
        tips.appendChild(li);
    });
    body.appendChild(tips);

    body.appendChild(el('h4', 'help-h', 'Consejos'));
    const tips2 = el('ul', 'help-list');
    [
        'Usa 🔍 Validar antes de guardar para detectar items inexistentes o zonas sin colocar.',
        'El botón 💾 Guardar job actual (en plantillas) guarda el job como plantilla reutilizable.',
        'El color de acento se cambia en Ajustes y se recuerda en este equipo.',
        'Salario y menú de jefe necesitan framework (ESX/QB/Qbox).',
    ].forEach((t) => tips2.appendChild(el('li', null, t)));
    body.appendChild(tips2);

    openModal('Ayuda y atajos', body, [{ label: 'Cerrar', cls: 'primary', onClick: closeModalRaw }]);
}

// ============================================================
//  Vistas / tabs
// ============================================================
function switchTab(tab) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    document.getElementById('view-jobs').classList.toggle('hidden', tab !== 'jobs');
    document.getElementById('view-settings').classList.toggle('hidden', tab !== 'settings');
    // Al volver a la pestaña Jobs, mostramos siempre el overview (no el editor).
    if (tab === 'jobs') { renderSidebar(); showOverview(); }
}

function loadSettings() {
    document.getElementById('set-debug').checked = !!state.settings.Debug;
    document.getElementById('set-markers').checked = state.settings.ShowMarkers !== false;
    document.getElementById('set-syncranks').checked = !!state.settings.SyncRanksToESX;
    document.getElementById('set-payinterval').value = state.settings.DefaultPayInterval || 60000;
    document.getElementById('set-interactmode').value = state.settings.InteractMode || 'target';
    document.getElementById('set-society').value = state.settings.SocietyBackend || 'internal';
    const prov = state.settings.Providers || {};
    document.querySelectorAll('[data-prov]').forEach((sel) => {
        sel.value = prov[sel.dataset.prov] || 'auto';
    });
}

// ============================================================
//  Apertura / cierre
// ============================================================
// ============================================================
//  Historial (deshacer / rehacer)
// ============================================================
const history = { stack: [], index: -1, limit: 60, applying: false, timer: null };

function resetHistory() {
    history.stack = [];
    history.index = -1;
    snapshot(); // estado inicial
}

// Toma una instantánea del estado actual (de-duplicada).
function snapshot() {
    if (history.applying) return;
    if (state.selected >= 0) syncFormToState();
    const json = JSON.stringify(state.jobs);
    const top = history.stack[history.index];
    if (top && top.json === json) return; // sin cambios reales
    history.stack = history.stack.slice(0, history.index + 1);
    history.stack.push({ json, selected: state.selected });
    if (history.stack.length > history.limit) history.stack.shift();
    history.index = history.stack.length - 1;
    // Auto-guardado de borrador del job en edición (recuperación tras recarga/crash).
    if (state.selected >= 0) saveDraft(state.jobs[state.selected]);
}

// Programa una instantánea (debounce) tras editar.
function scheduleSnapshot() {
    if (history.applying) return;
    clearTimeout(history.timer);
    history.timer = setTimeout(snapshot, 400);
}

function applySnapshot(snap) {
    history.applying = true;
    state.jobs = JSON.parse(snap.json);
    state.selected = Math.min(snap.selected, state.jobs.length - 1);
    if (state.selected < 0 && state.jobs.length) state.selected = 0;
    state.dirty = true;
    renderSidebar();
    renderEditor();
    history.applying = false;
}

function undo() {
    clearTimeout(history.timer);
    snapshot(); // captura ediciones pendientes antes de retroceder
    if (history.index <= 0) { toast('Nada que deshacer.', 'info'); return; }
    history.index--;
    applySnapshot(history.stack[history.index]);
    toast('Deshecho.', 'info');
}

function redo() {
    if (history.index >= history.stack.length - 1) { toast('Nada que rehacer.', 'info'); return; }
    history.index++;
    applySnapshot(history.stack[history.index]);
    toast('Rehecho.', 'info');
}

// Construye/actualiza el <datalist> de items para autocompletar inputs.
function buildItemDatalist() {
    let dl = document.getElementById('itemList');
    if (!dl) { dl = el('datalist'); dl.id = 'itemList'; document.body.appendChild(dl); }
    dl.innerHTML = '';
    state.items.forEach((name) => {
        const opt = document.createElement('option');
        opt.value = name;
        dl.appendChild(opt);
    });
}

function open(payload) {
    state.jobs = (payload.jobs || []).map(toEditor);
    state.settings = payload.settings || {};
    state.items = Array.isArray(payload.items) ? payload.items : [];
    state.stats = payload.stats || {};
    buildItemDatalist();
    buildSpriteDatalist();
    buildIconDatalist();
    state.selected = -1; // arrancamos en el overview, sin job abierto
    state.filter = '';
    state.dirty = false;
    const search = document.getElementById('jobSearch');
    if (search) search.value = '';
    document.getElementById('overlay').classList.remove('hidden');
    switchTab('jobs'); // muestra overview + renderSidebar
    showOverview();
    loadSettings();
    resetHistory();
}

function close() {
    document.getElementById('overlay').classList.add('hidden');
}

async function requestClose() {
    if (state.dirty) {
        const ok = await confirmModal(
            'Tienes cambios sin guardar en el panel. Si cierras se perderán (no afecta lo ya guardado en la base de datos).',
            { title: 'Cambios sin guardar', okLabel: 'Cerrar sin guardar', cancelLabel: 'Seguir editando', danger: true });
        if (!ok) return;
    }
    close();
    await nui('close');
}

// ---------- Listeners globales ----------
// Oculta/muestra el panel durante el modo de colocación.
function togglePlacement(on) {
    document.getElementById('overlay').classList.toggle('hidden', !!on);
}

// Aplica las coords colocadas al campo pendiente.
function applyPlacement(d) {
    togglePlacement(false);
    const t = state.pendingPlace;
    state.pendingPlace = null;
    if (!t) return;
    setInput(t.xPath, d.x); setInput(t.yPath, d.y); setInput(t.zPath, d.z);
    if (t.hPath && d.h !== undefined) setInput(t.hPath, d.h);
    state.dirty = true;
    renderSidebar();
    toast('Punto colocado.', 'ok');
}

// Rellena los grados del job seleccionado con los importados de ESX.
function applyJobGrades(d) {
    if (state.selected < 0) return;
    const job = state.jobs[state.selected];
    if ((job.req.jobName || '').trim() !== d.jobName) return; // cambió de job mientras tanto
    if (!d.grades || !d.grades.length) {
        toast(`ESX no devolvió grados para "${d.jobName}".`, 'error');
        return;
    }
    job.grades = d.grades.map((g) => ({ grade: g.grade || 0, name: g.name || '', salary: g.salary || 0 }));
    state.dirty = true;
    renderEditor();
    toast(`${d.grades.length} grado(s) importados de ESX.`, 'ok');
}

// ============================================================
//  Paleta de comandos (Ctrl+K): saltar a secciones/jobs + acciones
// ============================================================
let paletteCmds = [];
let paletteFiltered = [];
let paletteIndex = 0;

function isPaletteOpen() {
    const bd = document.getElementById('paletteBackdrop');
    return bd && !bd.classList.contains('hidden');
}

// Puntuación "fuzzy": premia coincidencias en orden, al principio y consecutivas.
function fuzzyScore(text, q) {
    text = (text || '').toLowerCase();
    q = (q || '').toLowerCase();
    if (!q) return 1;
    let ti = 0, score = 0, streak = 0;
    for (let qi = 0; qi < q.length; qi++) {
        let found = -1;
        for (let k = ti; k < text.length; k++) { if (text[k] === q[qi]) { found = k; break; } }
        if (found === -1) return 0;
        streak = (found === ti) ? streak + 2 : 0;
        score += 1 + streak + (found === 0 ? 3 : 0);
        ti = found + 1;
    }
    return score;
}

// Construye la lista de comandos según el contexto (job abierto o no).
function buildPaletteCommands() {
    const cmds = [];
    if (state.selected >= 0) {
        EDITOR_SECTIONS.forEach((s) => {
            cmds.push({
                group: 'Ir a sección', icon: s.icon, gclass: GROUP_CLASS[s.group],
                label: t('sec.' + s.id), hint: t(s.group), run: () => goToSection(s.id),
            });
        });
        cmds.push({ group: 'Acciones', icon: 'fa-floppy-disk', label: 'Guardar job', hint: 'Ctrl+S', run: saveJob });
        cmds.push({ group: 'Acciones', icon: 'fa-map-location-dot', label: 'Ver mapa de zonas', run: openZoneMap });
        cmds.push({ group: 'Acciones', icon: 'fa-circle-check', label: 'Validar job', run: validateReport });
        cmds.push({ group: 'Acciones', icon: 'fa-clone', label: 'Duplicar job', run: duplicateJob });
        cmds.push({ group: 'Acciones', icon: 'fa-file-export', label: 'Exportar JSON', run: exportJob });
        cmds.push({ group: 'Acciones', icon: 'fa-arrow-left-long', label: 'Volver a la lista', run: backToOverview });
        cmds.push({ group: 'Acciones', icon: 'fa-trash-can', label: 'Eliminar job', danger: true, run: deleteJob });
    }
    cmds.push({ group: 'General', icon: 'fa-plus', label: 'Nuevo job', run: newJob });
    cmds.push({ group: 'General', icon: 'fa-clipboard-list', label: 'Nuevo desde plantilla', run: chooseTemplate });
    cmds.push({ group: 'General', icon: 'fa-file-import', label: 'Importar JSON', run: importJob });
    cmds.push({ group: 'General', icon: 'fa-download', label: 'Backup (exportar todos)', run: exportAll });
    cmds.push({ group: 'General', icon: 'fa-upload', label: 'Restaurar varios', run: importAll });
    cmds.push({ group: 'General', icon: 'fa-gear', label: 'Ir a Ajustes', run: () => switchTab('settings') });
    cmds.push({ group: 'General', icon: 'fa-briefcase', label: 'Ir a Jobs', run: () => switchTab('jobs') });
    state.jobs.forEach((j, i) => {
        cmds.push({
            group: 'Abrir job', icon: 'fa-briefcase',
            label: j.label || j.name || '(sin nombre)',
            hint: (j.name && j.label) ? j.name : '',
            run: () => { switchTab('jobs'); editJob(i); },
        });
    });
    return cmds;
}

function openPalette() {
    paletteCmds = buildPaletteCommands();
    paletteIndex = 0;
    document.getElementById('paletteBackdrop').classList.remove('hidden');
    const input = document.getElementById('paletteInput');
    input.value = '';
    renderPalette('');
    input.focus();
}

function closePalette() {
    document.getElementById('paletteBackdrop').classList.add('hidden');
}

function renderPalette(query) {
    const list = document.getElementById('paletteList');
    list.innerHTML = '';
    const q = (query || '').trim();
    let scored;
    if (!q) {
        scored = paletteCmds.map((c) => ({ c }));
    } else {
        scored = paletteCmds
            .map((c) => ({ c, s: fuzzyScore(c.label + ' ' + (c.hint || '') + ' ' + c.group, q) }))
            .filter((x) => x.s > 0)
            .sort((a, b) => b.s - a.s);
    }
    paletteFiltered = scored.map((x) => x.c);
    if (paletteIndex >= paletteFiltered.length) paletteIndex = 0;

    if (!paletteFiltered.length) {
        list.appendChild(el('div', 'pal-empty', 'Sin resultados'));
        return;
    }
    let lastGroup = null;
    paletteFiltered.forEach((c, i) => {
        if (!q && c.group !== lastGroup) { lastGroup = c.group; list.appendChild(el('div', 'pal-group', c.group)); }
        const row = el('div', 'pal-row' + (i === paletteIndex ? ' active' : '') + (c.danger ? ' danger' : ''));
        row.dataset.i = i;
        const ic = el('span', 'pal-ic' + (c.gclass ? ' ' + c.gclass : ''));
        ic.appendChild(el('i', 'fa-solid ' + c.icon));
        row.appendChild(ic);
        const txt = el('div', 'pal-txt');
        txt.appendChild(el('div', 'pal-label', c.label));
        if (c.hint) txt.appendChild(el('div', 'pal-hint', c.hint));
        row.appendChild(txt);
        if (q) row.appendChild(el('span', 'pal-tag', c.group)); // en búsqueda, muestra la categoría
        row.addEventListener('click', () => runPaletteIndex(i));
        row.addEventListener('mousemove', () => setPaletteIndex(i));
        list.appendChild(row);
    });
}

function setPaletteIndex(i) {
    paletteIndex = i;
    const rows = document.querySelectorAll('#paletteList .pal-row');
    rows.forEach((r) => r.classList.toggle('active', parseInt(r.dataset.i, 10) === i));
    const act = document.querySelector('#paletteList .pal-row.active');
    if (act) act.scrollIntoView({ block: 'nearest' });
}

function movePalette(delta) {
    if (!paletteFiltered.length) return;
    let i = paletteIndex + delta;
    if (i < 0) i = paletteFiltered.length - 1;
    if (i >= paletteFiltered.length) i = 0;
    setPaletteIndex(i);
}

function runPaletteIndex(i) {
    const c = paletteFiltered[i];
    if (!c) return;
    closePalette();
    try { c.run(); } catch (e) { console.error('palette cmd error', e); }
}

// Refresca solo el menú lateral + el medidor de salud (sin reconstruir el form).
function refreshNavHealth() {
    if (state.selected < 0) return;
    syncFormToState();
    const job = state.jobs[state.selected];
    const health = computeHealth(job);
    renderEditorNav(job, health);
    updateJobHealth(health);
}

// ============================================================
//  Mapa de zonas (SVG): vista cenital de todas las zonas del job
// ============================================================
function svgEl(tag, attrs) {
    const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
}

// Estilo (color + etiqueta) por tipo de zona, según el nombre de collectZones().
function zoneStyle(name) {
    const M = {
        blip: { color: '#5b8dff', label: 'Blip' },
        duty: { color: '#34d27b', label: 'Duty' },
        stash: { color: '#f5b042', label: 'Cofre' },
        vestuario: { color: '#8b8bff', label: 'Vestuario' },
        taquilla: { color: '#39c7d6', label: 'Taquilla' },
        garaje: { color: '#ff8a5b', label: 'Garaje' },
        jefe: { color: '#f25271', label: 'Jefe' },
    };
    if (name.indexOf('step') === 0) return { color: '#b1f25b', label: name };
    return M[name] || { color: '#9aa3b8', label: name };
}

function openZoneMap() {
    if (state.selected < 0) return;
    syncFormToState();
    const job = state.jobs[state.selected];
    const zones = collectZones(job).filter((z) => !isZeroXYZ(z));

    const body = el('div', 'zonemap');
    if (!zones.length) {
        body.appendChild(el('p', 'modal-text', 'Este job todavía no tiene zonas colocadas. Coloca puntos (📍/🎯) y vuelve a abrir el mapa.'));
        openModal('🗺️ Mapa de zonas — ' + (job.label || job.name || 'Job'), body, [{ label: 'Cerrar', cls: 'primary', onClick: closeModalRaw }]);
        return;
    }

    const W = 560, H = 440, pad = 42;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    zones.forEach((z) => {
        minX = Math.min(minX, z.x); maxX = Math.max(maxX, z.x);
        minY = Math.min(minY, z.y); maxY = Math.max(maxY, z.y);
    });
    // Evita rango cero (todas las zonas en el mismo punto) y añade margen.
    let rx = maxX - minX, ry = maxY - minY;
    if (rx < 1) { minX -= 10; maxX += 10; rx = maxX - minX; }
    if (ry < 1) { minY -= 10; maxY += 10; ry = maxY - minY; }
    const scale = Math.min((W - 2 * pad) / rx, (H - 2 * pad) / ry);
    // Centra el contenido dentro del lienzo.
    const offX = (W - rx * scale) / 2, offY = (H - ry * scale) / 2;
    const sx = (x) => offX + (x - minX) * scale;
    const sy = (y) => H - (offY + (y - minY) * scale); // norte arriba (Y mundo crece al norte)

    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'zm-svg', width: '100%' });

    // Rejilla de fondo.
    const grid = svgEl('g', { class: 'zm-grid' });
    for (let gx = 0; gx <= W; gx += 40) grid.appendChild(svgEl('line', { x1: gx, y1: 0, x2: gx, y2: H }));
    for (let gy = 0; gy <= H; gy += 40) grid.appendChild(svgEl('line', { x1: 0, y1: gy, x2: W, y2: gy }));
    svg.appendChild(grid);

    // Líneas centrales (centro de masa) para dar sensación de "radar".
    const cx = sx((minX + maxX) / 2), cy = sy((minY + maxY) / 2);
    svg.appendChild(svgEl('line', { x1: cx, y1: 10, x2: cx, y2: H - 10, class: 'zm-axis' }));
    svg.appendChild(svgEl('line', { x1: 10, y1: cy, x2: W - 10, y2: cy, class: 'zm-axis' }));

    // Indicador de Norte.
    const north = svgEl('g', { class: 'zm-north' });
    north.appendChild(svgEl('circle', { cx: W - 24, cy: 26, r: 13 }));
    const ntxt = svgEl('text', { x: W - 24, y: 30, 'text-anchor': 'middle', class: 'zm-ntxt' });
    ntxt.textContent = 'N';
    north.appendChild(ntxt);
    svg.appendChild(north);

    // Barra de escala (en metros del mundo).
    const barPx = 80;
    const meters = Math.round(barPx / scale);
    const bar = svgEl('g', { class: 'zm-scale' });
    bar.appendChild(svgEl('line', { x1: 16, y1: H - 18, x2: 16 + barPx, y2: H - 18 }));
    bar.appendChild(svgEl('line', { x1: 16, y1: H - 22, x2: 16, y2: H - 14 }));
    bar.appendChild(svgEl('line', { x1: 16 + barPx, y1: H - 22, x2: 16 + barPx, y2: H - 14 }));
    const stxt = svgEl('text', { x: 16 + barPx / 2, y: H - 24, 'text-anchor': 'middle', class: 'zm-stxt' });
    stxt.textContent = '~' + meters + ' m';
    bar.appendChild(stxt);
    svg.appendChild(bar);

    // Marcadores de zona (con click para teletransportarse).
    zones.forEach((z) => {
        const st = zoneStyle(z.name);
        const px = sx(z.x), py = sy(z.y);
        const g = svgEl('g', { class: 'zm-zone' });
        g.appendChild(svgEl('circle', { cx: px, cy: py, r: 14, fill: 'transparent', class: 'zm-hit' }));
        g.appendChild(svgEl('circle', { cx: px, cy: py, r: 6, fill: st.color, class: 'zm-dot', stroke: st.color }));
        const ring = svgEl('circle', { cx: px, cy: py, r: 6, fill: 'none', stroke: st.color, class: 'zm-ring' });
        g.appendChild(ring);
        const label = svgEl('text', { x: px + 11, y: py + 4, class: 'zm-label', fill: st.color });
        label.textContent = st.label;
        g.appendChild(label);
        const title = svgEl('title');
        title.textContent = `${st.label} — ${z.x.toFixed(1)}, ${z.y.toFixed(1)}, ${z.z.toFixed(1)} (clic para ir)`;
        g.appendChild(title);
        g.addEventListener('click', async () => {
            await nui('teleport', { x: z.x, y: z.y, z: z.z });
            toast(`Teletransportado a: ${st.label}.`, 'ok');
        });
        svg.appendChild(g);
    });

    body.appendChild(svg);

    // Leyenda.
    const legend = el('div', 'zm-legend');
    const seen = {};
    zones.forEach((z) => {
        const st = zoneStyle(z.name);
        const key = z.name.indexOf('step') === 0 ? 'steps' : z.name;
        if (seen[key]) return; seen[key] = true;
        const item = el('span', 'zm-leg');
        const sw = el('span', 'zm-leg-sw'); sw.style.background = st.color;
        item.appendChild(sw);
        item.appendChild(el('span', null, z.name.indexOf('step') === 0 ? 'Steps' : st.label));
        legend.appendChild(item);
    });
    body.appendChild(legend);
    body.appendChild(el('div', 'hint', 'Vista cenital (norte arriba). Haz clic en una zona para teletransportarte a ella.'));

    openModal('🗺️ Mapa de zonas — ' + (job.label || job.name || 'Job'), body, [{ label: 'Cerrar', cls: 'primary', onClick: closeModalRaw }]);
}

// ============================================================
//  Auto-guardado de borrador (recuperación de cambios sin guardar)
// ============================================================
const draftOffered = new Set();
function draftKey(job) { return 'jc_draft_' + (job.name || '').trim(); }
function saveDraft(job) {
    if (!job || !(job.name || '').trim()) return;
    try { localStorage.setItem(draftKey(job), JSON.stringify(job)); } catch (e) { /* */ }
}
function clearDraft(job) {
    if (!job) return;
    try { localStorage.removeItem(draftKey(job)); } catch (e) { /* */ }
}
function getDraft(job) {
    try { const s = localStorage.getItem(draftKey(job)); return s ? JSON.parse(s) : null; } catch (e) { return null; }
}

// Al abrir un job: si hay un borrador (de otra sesión) que difiere, ofrece restaurarlo.
async function maybeOfferDraft(i) {
    const job = state.jobs[i];
    if (!job) return;
    const name = (job.name || '').trim();
    if (!name || draftOffered.has(name)) return;
    const draft = getDraft(job);
    if (!draft) return;
    if (JSON.stringify(draft) === JSON.stringify(job)) return; // sin cambios pendientes
    draftOffered.add(name);
    const ok = await confirmModal(
        'Encontramos un borrador sin guardar de este job (de una sesión anterior). ¿Restaurar esos cambios?',
        { title: '💾 Borrador encontrado', okLabel: 'Restaurar', cancelLabel: 'Descartar' });
    if (state.selected !== i) return; // cambió de job mientras decidía
    if (ok) {
        state.jobs[i] = draft;
        state.dirty = true;
        renderEditor();
        updateEditorTitle();
        toast('Borrador restaurado. Revísalo y pulsa Guardar.', 'ok');
    } else {
        clearDraft(job);
        toast('Borrador descartado.', 'info');
    }
}

// Salta a la sección anterior/siguiente del editor (Alt + flechas).
function cycleSection(delta) {
    if (state.selected < 0) return;
    const ids = EDITOR_SECTIONS.map((s) => s.id);
    let idx = ids.indexOf(state.editorSection || 'general');
    if (idx < 0) idx = 0;
    idx = (idx + delta + ids.length) % ids.length;
    goToSection(ids[idx]);
}

window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (d.action === 'open') open(d);
    else if (d.action === 'close') close();
    else if (d.action === 'stats') { state.stats = d.stats || {}; renderSidebar(); }
    else if (d.action === 'jobGrades') applyJobGrades(d);
    else if (d.action === 'placementMode') togglePlacement(d.on);
    else if (d.action === 'placementResult') applyPlacement(d);
    else if (d.action === 'placementCancel') { togglePlacement(false); state.pendingPlace = null; }
});

document.addEventListener('keyup', (e) => {
    if (e.key === 'Escape') {
        if (isPaletteOpen()) { closePalette(); return; }  // Esc cierra primero la paleta
        if (isModalOpen()) { dismissModal(); return; }     // luego el modal
        requestClose();
    }
});

// Atajos de teclado (paleta, guardar, deshacer/rehacer, ayuda).
document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const onJobs = () => !document.getElementById('view-jobs').classList.contains('hidden');

    // Ctrl+K / Ctrl+P: abrir o cerrar la paleta de comandos.
    if (ctrl && (e.key === 'k' || e.key === 'K' || e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        if (isPaletteOpen()) closePalette(); else openPalette();
        return;
    }
    // Mientras la paleta está abierta, su propio input gestiona el teclado.
    if (isPaletteOpen()) return;

    if (ctrl && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (isModalOpen()) return;
        if (onJobs() && state.selected >= 0) saveJob();
    } else if (ctrl && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (!isModalOpen() && onJobs()) undo();
    } else if (ctrl && ((e.shiftKey && (e.key === 'z' || e.key === 'Z')) || e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        if (!isModalOpen() && onJobs()) redo();
    } else if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowRight')) {
        if (onJobs() && state.selected >= 0) { e.preventDefault(); cycleSection(1); }
    } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowLeft')) {
        if (onJobs() && state.selected >= 0) { e.preventDefault(); cycleSection(-1); }
    } else if (!ctrl && e.key === '?' && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ''))) {
        e.preventDefault();
        showHelp();
    }
});

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('closeBtn').addEventListener('click', requestClose);
    document.getElementById('newJobBtn').addEventListener('click', newJob);
    document.getElementById('templateJobBtn').addEventListener('click', chooseTemplate);
    loadAccent();
    buildAccentPicker();
    loadLang();
    applyStaticI18n();
    const langSel = document.getElementById('set-lang');
    if (langSel) {
        langSel.value = LANG;
        langSel.addEventListener('change', () => setLang(langSel.value));
    }
    document.getElementById('importJobBtn').addEventListener('click', importJob);
    document.getElementById('refreshStatsBtn').addEventListener('click', () => { nui('requestStats'); toast('Actualizando estadísticas…', 'info'); });
    document.getElementById('exportAllBtn').addEventListener('click', exportAll);
    document.getElementById('importAllBtn').addEventListener('click', importAll);
    document.getElementById('saveJobBtn').addEventListener('click', saveJob);
    document.getElementById('deleteJobBtn').addEventListener('click', deleteJob);
    document.getElementById('duplicateJobBtn').addEventListener('click', duplicateJob);
    document.getElementById('validateJobBtn').addEventListener('click', validateReport);
    document.getElementById('undoBtn').addEventListener('click', undo);
    document.getElementById('redoBtn').addEventListener('click', redo);
    document.getElementById('backToJobsBtn').addEventListener('click', backToOverview);
    document.getElementById('helpBtn').addEventListener('click', showHelp);
    document.getElementById('exportJobBtn').addEventListener('click', exportJob);

    // Buscador de la barra lateral
    document.getElementById('jobSearch').addEventListener('input', (e) => {
        state.filter = e.target.value;
        renderSidebar();
    });

    // Modal: cierre por ✕ y por click en el fondo
    document.getElementById('modalCloseBtn').addEventListener('click', dismissModal);
    document.getElementById('modalBackdrop').addEventListener('click', (e) => {
        if (e.target.id === 'modalBackdrop') dismissModal();
    });

    // Marca cambios sin guardar ante cualquier edición del formulario.
    // (Asignar .value por código no dispara estos eventos, así que no hay falsos positivos.)
    const form = document.getElementById('jobForm');
    const markDirty = (e) => {
        if (e && e.target && e.target.classList) e.target.classList.remove('invalid');
        if (!state.dirty) { state.dirty = true; updateEditorTitle(); }
        scheduleSnapshot();
    };
    form.addEventListener('input', markDirty);
    form.addEventListener('change', markDirty);
    // Al confirmar un cambio (blur/toggle) refrescamos puntos de estado y salud en vivo.
    form.addEventListener('change', refreshNavHealth);

    // Paleta de comandos: launcher del topbar + medidor de salud + teclado del input.
    const paletteBtn = document.getElementById('paletteBtn');
    if (paletteBtn) paletteBtn.addEventListener('click', openPalette);
    const zoneMapBtn = document.getElementById('zoneMapBtn');
    if (zoneMapBtn) zoneMapBtn.addEventListener('click', openZoneMap);
    const jobHealthBtn = document.getElementById('jobHealth');
    if (jobHealthBtn) jobHealthBtn.addEventListener('click', validateReport);
    const palInput = document.getElementById('paletteInput');
    if (palInput) {
        palInput.addEventListener('input', () => { paletteIndex = 0; renderPalette(palInput.value); });
        palInput.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); movePalette(1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); movePalette(-1); }
            else if (e.key === 'Enter') { e.preventDefault(); runPaletteIndex(paletteIndex); }
        });
    }
    const palBackdrop = document.getElementById('paletteBackdrop');
    if (palBackdrop) palBackdrop.addEventListener('click', (e) => { if (e.target.id === 'paletteBackdrop') closePalette(); });

    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
    document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
        const Providers = {};
        document.querySelectorAll('[data-prov]').forEach((sel) => { Providers[sel.dataset.prov] = sel.value; });
        await nui('saveSettings', {
            Debug: document.getElementById('set-debug').checked,
            ShowMarkers: document.getElementById('set-markers').checked,
            SyncRanksToESX: document.getElementById('set-syncranks').checked,
            DefaultPayInterval: parseInt(document.getElementById('set-payinterval').value) || 60000,
            InteractMode: document.getElementById('set-interactmode').value,
            SocietyBackend: document.getElementById('set-society').value,
            Providers: Providers,
        });
        toast('Ajustes guardados. Los proveedores se aplican al reiniciar el recurso.', 'info');
    });
});
