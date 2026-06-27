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
    filter: '',      // texto del buscador de la barra lateral
    dirty: false,    // hay cambios sin guardar en la sesión del panel
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
const EDITED_KEYS = ['name', 'label', 'type', 'blip', 'requirements', 'duty', 'stash', 'wardrobe', 'steps'];

// ---------- Stations: servidor -> editor ----------
function dutyToEditor(d) {
    d = d || {}; const c = d.coords || {}, s = d.size || {};
    return {
        x: c.x || 0, y: c.y || 0, z: c.z || 0,
        sx: s.x || 1.6, sy: s.y || 1.6, sz: s.z || 2.0,
        labelOff: d.labelOff || '', labelOn: d.labelOn || '',
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
    };
}
function wardrobeToEditor(w) {
    w = w || {}; const c = w.coords || {}, s = w.size || {};
    return {
        x: c.x || 0, y: c.y || 0, z: c.z || 0,
        sx: s.x || 1.6, sy: s.y || 1.6, sz: s.z || 2.0,
        label: w.label || '', requireDuty: w.requireDuty === true,
        outfits: (w.outfits || []).map(outfitToEditor),
    };
}
function outfitToEditor(o) {
    o = o || {};
    const comps = [];
    if (o.components) Object.keys(o.components).forEach((id) =>
        comps.push({ component: parseInt(id), drawable: o.components[id].drawable || 0, texture: o.components[id].texture || 0 }));
    const props = [];
    if (o.props) Object.keys(o.props).forEach((id) =>
        props.push({ prop: parseInt(id), drawable: o.props[id].drawable || 0, texture: o.props[id].texture || 0 }));
    return { label: o.label || '', civilian: !!o.civilian, components: comps, props: props };
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
        type: job.type || '',
        hasDuty: !!job.duty,
        duty: dutyToEditor(job.duty),
        hasStash: !!job.stash,
        stash: stashToEditor(job.stash),
        hasWardrobe: !!job.wardrobe,
        wardrobe: wardrobeToEditor(job.wardrobe),
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

    // Stations (jobs de servicio)
    if (ed.hasDuty) {
        job.duty = {
            coords: vec3obj(ed.duty), size: sizeObj(ed.duty),
            labelOff: ed.duty.labelOff.trim() || undefined,
            labelOn: ed.duty.labelOn.trim() || undefined,
        };
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
    }
    if (ed.hasWardrobe) {
        job.wardrobe = {
            coords: vec3obj(ed.wardrobe), size: sizeObj(ed.wardrobe),
            label: ed.wardrobe.label.trim() || undefined,
            requireDuty: ed.wardrobe.requireDuty,
            outfits: ed.wardrobe.outfits.map(outfitToServer),
        };
    }

    // type: 'service' si tiene alguna station; si no, conserva el que tuviera.
    if (ed.hasDuty || ed.hasStash || ed.hasWardrobe) job.type = 'service';
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
    const q = state.filter.trim().toLowerCase();
    let shown = 0;
    state.jobs.forEach((job, i) => {
        if (q) {
            const hay = `${job.name} ${job.label}`.toLowerCase();
            if (!hay.includes(q)) return;
        }
        shown++;
        const li = el('li', i === state.selected ? 'active' : '');
        li.appendChild(el('span', 'jl-name', job.name || '(sin nombre)'));
        const parts = [];
        if (job.steps.length) parts.push(`${job.steps.length} steps`);
        const st = [job.hasDuty && 'duty', job.hasStash && 'stash', job.hasWardrobe && 'ropa'].filter(Boolean);
        if (st.length) parts.push(st.join('+'));
        li.appendChild(el('span', 'jl-meta', `${job.label || '—'} · ${parts.join(' · ') || 'vacío'}`));
        li.addEventListener('click', () => selectJob(i));
        list.appendChild(li);
    });

    if (shown === 0) {
        list.appendChild(el('li', 'jl-empty', q ? 'Sin resultados' : 'No hay jobs todavía'));
    }
    const count = document.getElementById('jobCount');
    if (count) count.textContent = q ? `${shown}/${state.jobs.length}` : `${state.jobs.length}`;
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

    // ---- Duty ----
    form.appendChild(toggleSection('Duty (servicio)', 'hasDuty', job.hasDuty, 'Tiene punto de servicio', (sec) => {
        sec.appendChild(coordRow('duty', job.duty));
        sec.appendChild(sizeRow('duty', job.duty));
        const g = el('div', 'grid');
        g.appendChild(field('Texto "entrar"', 'duty.labelOff', 'text', job.duty.labelOff, { placeholder: 'Fichar (entrar)' }));
        g.appendChild(field('Texto "salir"', 'duty.labelOn', 'text', job.duty.labelOn, { placeholder: 'Fichar (salir)' }));
        sec.appendChild(g);
    }));

    // ---- Stash ----
    form.appendChild(toggleSection('Cofre de servicio (stash)', 'hasStash', job.hasStash, 'Tiene cofre', (sec) => {
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
    }));

    // ---- Wardrobe ----
    form.appendChild(toggleSection('Vestuario (wardrobe)', 'hasWardrobe', job.hasWardrobe, 'Tiene vestuario', (sec) => {
        sec.appendChild(coordRow('wardrobe', job.wardrobe));
        sec.appendChild(sizeRow('wardrobe', job.wardrobe));
        const g = el('div', 'grid');
        g.appendChild(field('Etiqueta', 'wardrobe.label', 'text', job.wardrobe.label));
        g.appendChild(checkField('Requiere servicio', 'wardrobe.requireDuty', job.wardrobe.requireDuty));
        sec.appendChild(g);

        const ob = el('div', 'sub-block');
        const oh = el('h4', null, 'Uniformes / conjuntos');
        const addO = el('button', 'btn small ghost', '+ Añadir conjunto');
        addO.type = 'button';
        addO.addEventListener('click', () => { syncFormToState(); job.wardrobe.outfits.push(newOutfit()); renderEditor(); });
        oh.appendChild(addO);
        ob.appendChild(oh);
        job.wardrobe.outfits.forEach((o, oi) => ob.appendChild(renderOutfit(job, o, oi)));
        sec.appendChild(ob);
    }));

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
    cr.appendChild(posButton(`${prefix}.x`, `${prefix}.y`, `${prefix}.z`));
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
        _extra: {},
        name: 'nuevo_job', label: 'Nuevo Job', type: '', hasBlip: false,
        blip: { x: 0, y: 0, z: 0, sprite: 1, color: 0, scale: 0.8, label: '' },
        req: { jobName: '', jobGrade: 0, item: '' },
        hasDuty: false, duty: dutyToEditor(null),
        hasStash: false, stash: stashToEditor(null),
        hasWardrobe: false, wardrobe: wardrobeToEditor(null),
        steps: [],
    };
    state.jobs.push(ed);
    state.dirty = true;
    selectJob(state.jobs.length - 1);
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

async function saveJob() {
    syncFormToState();
    const ed = state.jobs[state.selected];
    if (!ed.name.trim()) { toast('El job necesita un nombre interno.', 'error'); return; }
    const dup = state.jobs.some((j, i) => i !== state.selected && j.name.trim() === ed.name.trim());
    if (dup) { toast('Ya existe otro job con ese nombre.', 'error'); return; }
    // Espeja la validación del servidor (validateJob) para dar feedback preciso.
    const ids = {};
    for (let i = 0; i < ed.steps.length; i++) {
        const id = (ed.steps[i].id || '').trim();
        if (!id) { toast(`El step #${i + 1} necesita un ID.`, 'error'); return; }
        if (ids[id]) { toast(`ID de step duplicado: ${id}`, 'error'); return; }
        ids[id] = true;
    }
    await nui('saveJob', toServer(ed));
    state.dirty = false;
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
    renderEditor();
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
    document.getElementById('set-interactmode').value = state.settings.InteractMode || 'target';
}

// ============================================================
//  Apertura / cierre
// ============================================================
function open(payload) {
    state.jobs = (payload.jobs || []).map(toEditor);
    state.settings = payload.settings || {};
    state.selected = state.jobs.length ? 0 : -1;
    state.filter = '';
    state.dirty = false;
    const search = document.getElementById('jobSearch');
    if (search) search.value = '';
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
window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (d.action === 'open') open(d);
    else if (d.action === 'close') close();
});

document.addEventListener('keyup', (e) => {
    if (e.key === 'Escape') {
        if (isModalOpen()) { dismissModal(); return; } // Esc cierra primero el modal
        requestClose();
    }
});

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('closeBtn').addEventListener('click', requestClose);
    document.getElementById('newJobBtn').addEventListener('click', newJob);
    document.getElementById('importJobBtn').addEventListener('click', importJob);
    document.getElementById('saveJobBtn').addEventListener('click', saveJob);
    document.getElementById('deleteJobBtn').addEventListener('click', deleteJob);
    document.getElementById('duplicateJobBtn').addEventListener('click', duplicateJob);
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
    form.addEventListener('input', () => { state.dirty = true; });
    form.addEventListener('change', () => { state.dirty = true; });

    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
    document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
        await nui('saveSettings', {
            Debug: document.getElementById('set-debug').checked,
            DefaultPayInterval: parseInt(document.getElementById('set-payinterval').value) || 60000,
            InteractMode: document.getElementById('set-interactmode').value,
        });
    });
});
