/* ============================================================
   Job Creator - lógica del panel NUI (vanilla JS)

   Trabajamos con un "modelo de editor" plano (fácil de mapear a inputs)
   y convertimos a/desde la forma que entiende el servidor al cargar/guardar.
   El servidor manda/recibe coords como {x,y,z} (JSON-friendly).
   ============================================================ */

const RESOURCE = (typeof GetParentResourceName === 'function')
    ? GetParentResourceName() : 'job_creator';

const state = {
    jobs: [],        // modelos de editor
    settings: {},
    selected: -1,
};

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

// ---------- Conversión servidor <-> editor ----------
function num(v, d) { const n = parseFloat(v); return isNaN(n) ? (d || 0) : n; }

function toEditor(job) {
    const blip = job.blip || null;
    const req = job.requirements || {};
    let reqJobName = '', reqJobGrade = 0;
    if (typeof req.job === 'string') reqJobName = req.job;
    else if (req.job && typeof req.job === 'object') { reqJobName = req.job.name || ''; reqJobGrade = req.job.grade || 0; }

    return {
        name: job.name || '',
        label: job.label || '',
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
    };
}

function toServer(ed) {
    const job = { name: ed.name.trim(), label: ed.label.trim() };

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
    if (attrs) Object.keys(attrs).forEach((k) => input.setAttribute(k, attrs[k]));
    wrap.appendChild(input);
    return wrap;
}

// Botón "usar mi posición": rellena 3 inputs por sus data-path
function posButton(xPath, yPath, zPath) {
    const b = el('button', 'btn small ghost', '📍 Aquí');
    b.type = 'button';
    b.title = 'Usar mi posición actual';
    b.addEventListener('click', async () => {
        const c = await nui('getCoords');
        setInput(xPath, c.x); setInput(yPath, c.y); setInput(zPath, c.z);
    });
    return b;
}

function setInput(path, val) {
    const input = document.querySelector(`#jobForm [data-path="${path}"]`);
    if (input) input.value = val;
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
//  Render: lista lateral
// ============================================================
function renderSidebar() {
    const list = document.getElementById('jobList');
    list.innerHTML = '';
    state.jobs.forEach((job, i) => {
        const li = el('li', i === state.selected ? 'active' : '');
        li.appendChild(el('span', 'jl-name', job.name || '(sin nombre)'));
        li.appendChild(el('span', 'jl-meta', `${job.label || '—'} · ${job.steps.length} steps`));
        li.addEventListener('click', () => selectJob(i));
        list.appendChild(li);
    });
}

function selectJob(i) {
    if (state.selected >= 0) syncFormToState();
    state.selected = i;
    renderSidebar();
    renderEditor();
}

// ============================================================
//  Render: editor de un job
// ============================================================
function renderEditor() {
    const form = document.getElementById('jobForm');
    const footer = document.getElementById('editorFooter');
    const empty = document.getElementById('emptyState');

    if (state.selected < 0) {
        form.classList.add('hidden');
        footer.classList.add('hidden');
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');
    form.classList.remove('hidden');
    footer.classList.remove('hidden');

    const job = state.jobs[state.selected];
    form.innerHTML = '';

    // ---- General ----
    const general = el('div', 'section');
    general.appendChild(el('h3', null, 'General'));
    const gGrid = el('div', 'grid');
    gGrid.appendChild(field('Nombre interno (name)', 'name', 'text', job.name));
    gGrid.appendChild(field('Etiqueta (label)', 'label', 'text', job.label));
    general.appendChild(gGrid);
    form.appendChild(general);

    // ---- Blip ----
    const blipSec = el('div', 'section');
    const blipHead = el('h3', null, 'Blip del mapa');
    const blipToggle = el('label', 'field check');
    const blipCheck = el('input'); blipCheck.type = 'checkbox'; blipCheck.checked = job.hasBlip;
    blipCheck.dataset.path = 'hasBlip'; blipCheck.dataset.type = 'bool';
    blipCheck.addEventListener('change', () => { syncFormToState(); renderEditor(); });
    blipToggle.appendChild(blipCheck);
    blipToggle.appendChild(el('span', null, 'Mostrar blip'));
    blipHead.appendChild(blipToggle);
    blipSec.appendChild(blipHead);

    if (job.hasBlip) {
        const cr = el('div', 'coord-row');
        const cg = el('div', 'grid cols-3');
        cg.appendChild(field('X', 'blip.x', 'number', job.blip.x, { step: '0.01' }));
        cg.appendChild(field('Y', 'blip.y', 'number', job.blip.y, { step: '0.01' }));
        cg.appendChild(field('Z', 'blip.z', 'number', job.blip.z, { step: '0.01' }));
        cr.appendChild(cg);
        cr.appendChild(posButton('blip.x', 'blip.y', 'blip.z'));
        blipSec.appendChild(cr);

        const bg = el('div', 'grid cols-4');
        bg.appendChild(field('Sprite', 'blip.sprite', 'number', job.blip.sprite));
        bg.appendChild(field('Color', 'blip.color', 'number', job.blip.color));
        bg.appendChild(field('Escala', 'blip.scale', 'number', job.blip.scale, { step: '0.1' }));
        bg.appendChild(field('Texto', 'blip.label', 'text', job.blip.label));
        blipSec.style.marginTop = '0';
        blipSec.appendChild(el('div', null, '<div style="height:12px"></div>'));
        blipSec.appendChild(bg);
    }
    form.appendChild(blipSec);

    // ---- Requisitos ----
    const reqSec = el('div', 'section');
    reqSec.appendChild(el('h3', null, 'Requisitos (opcional)'));
    const rg = el('div', 'grid cols-3');
    rg.appendChild(field('Job requerido', 'req.jobName', 'text', job.req.jobName, { placeholder: 'ej: police' }));
    rg.appendChild(field('Rango mínimo', 'req.jobGrade', 'number', job.req.jobGrade));
    rg.appendChild(field('Item de acceso', 'req.item', 'text', job.req.item, { placeholder: 'no se consume' }));
    reqSec.appendChild(rg);
    form.appendChild(reqSec);

    // ---- Steps ----
    const stepsSec = el('div', 'section');
    const sh = el('h3', null, 'Steps (pasos)');
    const addStep = el('button', 'btn small primary', '+ Añadir step');
    addStep.type = 'button';
    addStep.addEventListener('click', () => {
        syncFormToState();
        job.steps.push(newStep());
        renderEditor();
    });
    sh.appendChild(addStep);
    stepsSec.appendChild(sh);

    job.steps.forEach((step, si) => stepsSec.appendChild(renderStep(job, step, si)));
    form.appendChild(stepsSec);
}

function newStep() {
    return {
        id: '', label: '',
        tx: 0, ty: 0, tz: 0, sx: 2.0, sy: 2.0, sz: 2.0, icon: '', tlabel: '',
        progDuration: 0, progLabel: '', animDict: '', animClip: '',
        requires: [], rewardItems: [],
        money: { enabled: false, min: 0, max: 0, account: 'cash' },
    };
}

function renderStep(job, step, si) {
    const card = el('div', 'step-card');
    const head = el('div', 'step-head');
    head.appendChild(el('span', 'chev', '▾'));
    const titleWrap = el('div'); titleWrap.style.flex = '1';
    titleWrap.appendChild(el('div', 'step-title', step.id || `Step ${si + 1}`));
    titleWrap.appendChild(el('div', 'step-sub', step.label || '—'));
    head.appendChild(titleWrap);

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
    tcr.appendChild(posButton(`${p}.tx`, `${p}.ty`, `${p}.tz`));
    tBlock.appendChild(tcr);

    const tsz = el('div', 'grid cols-3');
    tsz.appendChild(field('Tamaño X', `${p}.sx`, 'number', step.sx, { step: '0.1' }));
    tsz.appendChild(field('Tamaño Y', `${p}.sy`, 'number', step.sy, { step: '0.1' }));
    tsz.appendChild(field('Tamaño Z', `${p}.sz`, 'number', step.sz, { step: '0.1' }));
    tBlock.appendChild(tsz);

    const tmeta = el('div', 'grid');
    tmeta.appendChild(field('Icono (fontawesome)', `${p}.icon`, 'text', step.icon, { placeholder: 'fa-solid fa-trash' }));
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
    body.appendChild(pBlock);

    // Requires (items a consumir)
    body.appendChild(renderRowList(
        'Materiales requeridos (se consumen)',
        step.requires,
        (r, ri) => [
            { label: 'Item', path: `${p}.requires.${ri}.name`, type: 'text', value: r.name },
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
            { label: 'Item', path: `${p}.rewardItems.${ri}.name`, type: 'text', value: r.name },
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
            r.appendChild(field(f.label, f.path, f.type, f.value));
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
function newJob() {
    if (state.selected >= 0) syncFormToState();
    const ed = {
        name: 'nuevo_job', label: 'Nuevo Job', hasBlip: false,
        blip: { x: 0, y: 0, z: 0, sprite: 1, color: 0, scale: 0.8, label: '' },
        req: { jobName: '', jobGrade: 0, item: '' },
        steps: [],
    };
    state.jobs.push(ed);
    selectJob(state.jobs.length - 1);
}

async function saveJob() {
    syncFormToState();
    const ed = state.jobs[state.selected];
    if (!ed.name.trim()) { alert('El job necesita un nombre interno.'); return; }
    const dup = state.jobs.some((j, i) => i !== state.selected && j.name.trim() === ed.name.trim());
    if (dup) { alert('Ya existe otro job con ese nombre.'); return; }
    await nui('saveJob', toServer(ed));
}

async function deleteJob() {
    if (state.selected < 0) return;
    const ed = state.jobs[state.selected];
    if (!confirm(`¿Eliminar el job "${ed.name}"? Esto borra su definición de la base de datos.`)) return;
    await nui('deleteJob', { name: ed.name });
    state.jobs.splice(state.selected, 1);
    state.selected = -1;
    renderSidebar();
    renderEditor();
}

// ============================================================
//  Vistas / tabs
// ============================================================
function switchTab(tab) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    document.getElementById('view-jobs').classList.toggle('hidden', tab !== 'jobs');
    document.getElementById('view-settings').classList.toggle('hidden', tab !== 'settings');
}

function loadSettings() {
    document.getElementById('set-debug').checked = !!state.settings.Debug;
    document.getElementById('set-payinterval').value = state.settings.DefaultPayInterval || 60000;
}

// ============================================================
//  Apertura / cierre
// ============================================================
function open(payload) {
    state.jobs = (payload.jobs || []).map(toEditor);
    state.settings = payload.settings || {};
    state.selected = state.jobs.length ? 0 : -1;
    document.getElementById('overlay').classList.remove('hidden');
    switchTab('jobs');
    renderSidebar();
    renderEditor();
    loadSettings();
}

function close() {
    document.getElementById('overlay').classList.add('hidden');
}

async function requestClose() {
    close();
    await nui('close');
}

// ---------- Listeners globales ----------
window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (d.action === 'open') open(d);
    else if (d.action === 'close') close();
});

document.addEventListener('keyup', (e) => {
    if (e.key === 'Escape') requestClose();
});

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('closeBtn').addEventListener('click', requestClose);
    document.getElementById('newJobBtn').addEventListener('click', newJob);
    document.getElementById('saveJobBtn').addEventListener('click', saveJob);
    document.getElementById('deleteJobBtn').addEventListener('click', deleteJob);
    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
    document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
        await nui('saveSettings', {
            Debug: document.getElementById('set-debug').checked,
            DefaultPayInterval: parseInt(document.getElementById('set-payinterval').value) || 60000,
        });
    });
});
