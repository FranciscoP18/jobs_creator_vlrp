-- ============================================================
-- server/store.lua  (SERVIDOR)
-- Fuente de verdad en runtime: la BASE DE DATOS (oxmysql).
-- Los archivos config/jobs/*.lua son solo la SEMILLA inicial.
--
-- Flujo:
--   1. Al arrancar: crea tablas si no existen.
--   2. Siembra en la DB los jobs .lua que aún no estén guardados.
--   3. Carga todos los jobs de la DB a Config.Jobs (coords -> vec3).
--   4. Carga settings (Debug, DefaultPayInterval) de la DB.
--   5. Sincroniza con cada cliente que se conecta.
--
-- Todo evento de ESCRITURA revalida el permiso ACE: nunca se confía
-- en que el cliente "tenga permiso" solo porque abrió el panel.
-- ============================================================

local ACE_PERMISSION = 'job_creator.admin'
local SETTINGS_ID = 1

-- ---------- Permisos ----------
local function isAdmin(src)
    if src == 0 then return true end -- consola siempre
    return IsPlayerAceAllowed(src, ACE_PERMISSION)
end

-- ---------- Auditoría ----------
local function getIdent(src)
    if src == 0 then return 'consola' end
    for _, id in ipairs(GetPlayerIdentifiers(src) or {}) do
        if id:sub(1, 8) == 'license:' then return id end
    end
    return ('src:%d'):format(src)
end

-- Registra una acción (en consola y, si está configurado, en Discord).
-- Expuesto como JobCreator.Audit para service.lua / manage.lua.
JobCreator = JobCreator or {}
function JobCreator.Audit(src, action, target)
    if not Config.AuditLog then return end
    local who = src == 0 and 'CONSOLA' or ('%s (%s)'):format(GetPlayerName(src) or '?', getIdent(src))
    Bridge.Print('info', ('[AUDIT] %s -> %s %s'):format(who, action, target or ''))

    if Config.AuditWebhook and Config.AuditWebhook ~= '' then
        PerformHttpRequest(Config.AuditWebhook, function() end, 'POST', json.encode({
            username = 'Job Creator',
            embeds = { {
                title = 'Job Creator · ' .. action,
                description = ('**Por:** %s\n**Job:** %s'):format(who, target or '—'),
                color = 3447003,
            } },
        }), { ['Content-Type'] = 'application/json' })
    end
end

-- ---------- DB: creación de tablas ----------
local function ensureSchema()
    MySQL.query.await([[
        CREATE TABLE IF NOT EXISTS jobcreator_jobs (
            name VARCHAR(64) NOT NULL PRIMARY KEY,
            definition LONGTEXT NOT NULL
        )
    ]])
    MySQL.query.await([[
        CREATE TABLE IF NOT EXISTS jobcreator_settings (
            id INT NOT NULL PRIMARY KEY,
            data LONGTEXT NOT NULL
        )
    ]])
    -- Fondos de empresa por job (caja de la sociedad).
    MySQL.query.await([[
        CREATE TABLE IF NOT EXISTS jobcreator_society (
            job VARCHAR(64) NOT NULL PRIMARY KEY,
            balance BIGINT NOT NULL DEFAULT 0
        )
    ]])
end

-- ---------- Sociedad / fondos de empresa ----------
-- Caché en memoria del saldo por job; se persiste en cada cambio.
local societyBalance = {}

JobCreator = JobCreator or {}

-- Nombre del job de framework (Job requerido) para resolver la sociedad ESX.
local function fwOf(jobName)
    local job = Config.Jobs[jobName]
    if job and job.requirements and job.requirements.job then
        local rj = job.requirements.job
        return type(rj) == 'table' and rj.name or rj
    end
    return jobName
end

-- Cuenta compartida de esx_addonaccount (society_<job>). getSharedAccount es
-- síncrono (su handler llama al callback en el acto), así que esto devuelve ya.
local function esxSharedAccount(jobName)
    local acc
    TriggerEvent('esx_addonaccount:getSharedAccount', 'society_' .. fwOf(jobName), function(a) acc = a end)
    return acc
end

function JobCreator.GetSociety(jobName)
    if Config.SocietyBackend == 'esx_society' then
        local acc = esxSharedAccount(jobName)
        return (acc and acc.money) or 0
    end
    return societyBalance[jobName] or 0
end

-- Suma (o resta, con negativo) al fondo. Devuelve el nuevo saldo o nil si
-- la operación dejaría el saldo negativo (o no existe la sociedad ESX).
function JobCreator.AddSociety(jobName, amount)
    if Config.SocietyBackend == 'esx_society' then
        local acc = esxSharedAccount(jobName)
        if not acc then
            Bridge.Print('warn', ('No existe la sociedad ESX "society_%s" (revisa esx_addonaccount)'):format(fwOf(jobName)))
            return nil
        end
        if amount < 0 then
            if (acc.money or 0) < -amount then return nil end
            acc.removeMoney(-amount)
        elseif amount > 0 then
            acc.addMoney(amount)
        end
        return acc.money or 0
    end

    -- Backend interno (tabla propia).
    local current = societyBalance[jobName] or 0
    local nuevo = current + amount
    if nuevo < 0 then return nil end
    societyBalance[jobName] = nuevo
    MySQL.prepare.await(
        'INSERT INTO jobcreator_society (job, balance) VALUES (?, ?) ON DUPLICATE KEY UPDATE balance = VALUES(balance)',
        { jobName, nuevo }
    )
    return nuevo
end

-- ---------- Validación básica de una definición de job ----------
-- Devuelve true, o false + razón. No valida cada campo a fondo (eso lo
-- toleran los defaults del motor), pero sí lo imprescindible.
local function validateJob(def)
    if type(def) ~= 'table' then return false, 'definición inválida' end
    if type(def.name) ~= 'string' or def.name == '' then return false, 'falta name' end
    if def.steps ~= nil and type(def.steps) ~= 'table' then return false, 'steps debe ser lista' end
    if def.steps then
        local ids = {}
        for i, step in ipairs(def.steps) do
            if type(step.id) ~= 'string' or step.id == '' then
                return false, ('step #%d sin id'):format(i)
            end
            if ids[step.id] then return false, ('id de step duplicado: %s'):format(step.id) end
            ids[step.id] = true
        end
    end
    return true
end

-- ---------- DB: persistir / borrar ----------
-- Guarda en DB la versión SERIALIZADA (coords como {x,y,z}).
local function persistJob(def)
    local serializable = Bridge.SerializeJob(def)
    MySQL.prepare.await(
        'INSERT INTO jobcreator_jobs (name, definition) VALUES (?, ?) ON DUPLICATE KEY UPDATE definition = VALUES(definition)',
        { def.name, json.encode(serializable) }
    )
end

local function deleteJobRow(name)
    MySQL.prepare.await('DELETE FROM jobcreator_jobs WHERE name = ?', { name })
end

-- Genera config/providers.lua (se carga al iniciar, antes que los bridges).
-- Los cambios de proveedor requieren REINICIAR el recurso.
local function persistProviders()
    local lines = {
        '-- Generado por el panel (Ajustes > Proveedores). NO editar a mano.',
        '-- Los cambios se aplican al REINICIAR el recurso.',
        'Config.Providers = Config.Providers or {}',
    }
    for _, cat in ipairs({ 'framework', 'inventory', 'notify', 'target', 'menu', 'textui', 'clothing' }) do
        local v = Config.Providers and Config.Providers[cat]
        if type(v) == 'string' then
            lines[#lines + 1] = ('Config.Providers.%s = %q'):format(cat, v)
        end
    end
    SaveResourceFile(GetCurrentResourceName(), 'config/providers.lua', table.concat(lines, '\n') .. '\n', -1)
end

local function persistSettings()
    local data = json.encode({
        Debug = Config.Debug,
        ShowMarkers = Config.ShowMarkers,
        DefaultPayInterval = Config.DefaultPayInterval,
        InteractMode = Config.InteractMode,
        SocietyBackend = Config.SocietyBackend,
        SyncRanksToESX = Config.SyncRanksToESX,
    })
    MySQL.prepare.await(
        'INSERT INTO jobcreator_settings (id, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)',
        { SETTINGS_ID, data }
    )
end

-- ---------- Sincronización con clientes ----------
-- Envía a un cliente (o a todos con -1) las definiciones SERIALIZADAS.
-- El cliente las normaliza a vec3 al recibirlas.
local function buildSyncPayload()
    local payload = {}
    for _, job in pairs(Config.Jobs) do
        payload[#payload + 1] = Bridge.SerializeJob(job)
    end
    return payload
end

local function syncTo(target)
    -- Enviamos también las settings que el cliente necesita (modo de
    -- interacción y debug), para que se apliquen al reconstruir.
    TriggerClientEvent('job_creator:syncJobs', target, buildSyncPayload(), {
        Debug = Config.Debug,
        InteractMode = Config.InteractMode,
        ShowMarkers = Config.ShowMarkers,
    })
end

-- ---------- Carga inicial: seed + load ----------
CreateThread(function()
    if not Bridge.IsStarted('oxmysql') then
        Bridge.Print('error', 'oxmysql no está iniciado: el panel y la persistencia no funcionarán')
        return
    end

    ensureSchema()

    -- 1. Semilla: inserta los jobs .lua que no existan aún en la DB.
    local existing = MySQL.query.await('SELECT name FROM jobcreator_jobs') or {}
    local inDb = {}
    for _, row in ipairs(existing) do inDb[row.name] = true end

    for name, def in pairs(Config.Jobs) do
        if not inDb[name] then
            persistJob(def)
            Bridge.Print('info', ('Job sembrado en DB: %s'):format(name))
        end
    end

    -- 2. Carga: la DB manda. Reemplazamos Config.Jobs con lo guardado.
    local rows = MySQL.query.await('SELECT name, definition FROM jobcreator_jobs') or {}
    local loaded = {}
    for _, row in ipairs(rows) do
        local ok, def = pcall(json.decode, row.definition)
        if ok and def then
            loaded[row.name] = Bridge.NormalizeJob(def) -- coords -> vec3
        else
            Bridge.Print('error', ('No se pudo decodificar el job %s'):format(row.name))
        end
    end
    Config.Jobs = loaded

    -- 3. Settings
    local srow = MySQL.query.await('SELECT data FROM jobcreator_settings WHERE id = ?', { SETTINGS_ID })
    if srow and srow[1] then
        local ok, data = pcall(json.decode, srow[1].data)
        if ok and data then
            if data.Debug ~= nil then Config.Debug = data.Debug end
            if data.ShowMarkers ~= nil then Config.ShowMarkers = data.ShowMarkers end
            if data.DefaultPayInterval then Config.DefaultPayInterval = data.DefaultPayInterval end
            if data.InteractMode then Config.InteractMode = data.InteractMode end
            if data.SocietyBackend then Config.SocietyBackend = data.SocietyBackend end
            if data.SyncRanksToESX ~= nil then Config.SyncRanksToESX = data.SyncRanksToESX end
        end
    else
        persistSettings() -- primera vez: guarda los defaults del .lua
    end

    -- 4. Fondos de empresa
    local socRows = MySQL.query.await('SELECT job, balance FROM jobcreator_society') or {}
    for _, row in ipairs(socRows) do
        societyBalance[row.job] = tonumber(row.balance) or 0
    end

    local count = 0
    for _ in pairs(Config.Jobs) do count = count + 1 end
    Bridge.Print('info', ('Store listo: %d job(s) desde la DB'):format(count))

    -- Avisa a otros módulos (service.lua registra los stashes con esto).
    TriggerEvent('job_creator:jobsReloaded')
    -- Sincroniza a quien ya estuviera conectado (reinicio de recurso en caliente).
    syncTo(-1)
end)

-- ---------- Cliente pide datos al cargar ----------
RegisterNetEvent('job_creator:clientReady', function()
    local src = source
    syncTo(src)
end)

-- ---------- Estadísticas en vivo ----------
-- Cuenta, por nombre de job: empleados online (job del framework) y en servicio.
local function buildStats()
    local stats = {}
    local function ensure(name)
        stats[name] = stats[name] or { employees = 0, onduty = 0 }
        return stats[name]
    end
    for _, raw in ipairs(GetPlayers()) do
        local src = tonumber(raw)
        local pj = Bridge.Framework.GetJob(src)
        if pj and pj.name then ensure(pj.name).employees = ensure(pj.name).employees + 1 end
        local player = Player(src)
        if player and player.state and player.state.jc_duty and player.state.jc_dutyJob then
            ensure(player.state.jc_dutyJob).onduty = ensure(player.state.jc_dutyJob).onduty + 1
        end
    end
    return stats
end

-- ============================================================
-- API de panel (todo revalida ACE)
-- ============================================================

-- El cliente pide abrir el panel: respondemos solo si es admin.
RegisterNetEvent('job_creator:requestPanel', function()
    local src = source
    if not isAdmin(src) then
        Bridge.Notify.SendTo(src, { title = 'Job Creator', description = 'No tienes permiso (job_creator.admin)', type = 'error' })
        return
    end
    TriggerClientEvent('job_creator:openPanel', src, {
        jobs = buildSyncPayload(),
        settings = {
            Debug = Config.Debug,
            ShowMarkers = Config.ShowMarkers,
            DefaultPayInterval = Config.DefaultPayInterval,
            InteractMode = Config.InteractMode,
            SocietyBackend = Config.SocietyBackend,
            SyncRanksToESX = Config.SyncRanksToESX,
            Providers = Config.Providers,
        },
        items = (Bridge.Inventory.GetItemNames and Bridge.Inventory.GetItemNames()) or {},
        stats = buildStats(),
    })
end)

-- Refresco de estadísticas en vivo (botón del panel).
RegisterNetEvent('job_creator:requestStats', function()
    local src = source
    if not isAdmin(src) then return end
    TriggerClientEvent('job_creator:stats', src, buildStats())
end)

-- Importar los grados de un job del framework (botón "Importar de ESX").
RegisterNetEvent('job_creator:getJobGrades', function(jobName)
    local src = source
    if not isAdmin(src) then return end
    if type(jobName) ~= 'string' or jobName == '' then return end
    TriggerClientEvent('job_creator:jobGrades', src, jobName, Bridge.Framework.GetJobGrades(jobName))
end)

-- Crear/actualizar un job.
RegisterNetEvent('job_creator:saveJob', function(def)
    local src = source
    if not isAdmin(src) then return end

    local ok, reason = validateJob(def)
    if not ok then
        Bridge.Notify.SendTo(src, { title = 'Job Creator', description = 'Job inválido: ' .. reason, type = 'error' })
        return
    end

    -- def llega serializado (coords {x,y,z}). Guardamos serializado y
    -- mantenemos en runtime la versión normalizada (vec3).
    persistJob(def)
    Config.Jobs[def.name] = Bridge.NormalizeJob(def)

    -- Rangos: job_creator manda -> sincroniza los grados al framework (ESX).
    if Config.SyncRanksToESX and def.grades and #def.grades > 0 then
        local rj = def.requirements and def.requirements.job
        local fw = rj and (type(rj) == 'table' and rj.name or rj) or def.name
        Bridge.Framework.SyncJob(fw, def.label, def.grades)
    end

    JobCreator.Audit(src, 'GUARDÓ el job', def.name)
    Bridge.Notify.SendTo(src, { title = 'Job Creator', description = ('Job "%s" guardado'):format(def.name), type = 'success' })
    TriggerEvent('job_creator:jobsReloaded') -- re-registra stashes si cambió
    syncTo(-1) -- todos los clientes reconstruyen sus zonas
end)

-- Borrar un job.
RegisterNetEvent('job_creator:deleteJob', function(name)
    local src = source
    if not isAdmin(src) then return end
    if type(name) ~= 'string' or not Config.Jobs[name] then return end

    deleteJobRow(name)
    Config.Jobs[name] = nil

    JobCreator.Audit(src, 'BORRÓ el job', name)
    Bridge.Notify.SendTo(src, { title = 'Job Creator', description = ('Job "%s" eliminado'):format(name), type = 'success' })
    syncTo(-1)
end)

-- Guardar settings globales.
RegisterNetEvent('job_creator:saveSettings', function(settings)
    local src = source
    if not isAdmin(src) then return end
    if type(settings) ~= 'table' then return end

    if settings.Debug ~= nil then Config.Debug = settings.Debug and true or false end
    if settings.ShowMarkers ~= nil then Config.ShowMarkers = settings.ShowMarkers and true or false end
    if settings.SocietyBackend == 'internal' or settings.SocietyBackend == 'esx_society' then
        Config.SocietyBackend = settings.SocietyBackend
    end
    if settings.SyncRanksToESX ~= nil then Config.SyncRanksToESX = settings.SyncRanksToESX and true or false end
    if tonumber(settings.DefaultPayInterval) then
        Config.DefaultPayInterval = math.max(1000, tonumber(settings.DefaultPayInterval))
    end
    -- Solo aceptamos modos válidos (evita valores arbitrarios del cliente).
    local validModes = { target = true, key = true, both = true }
    if settings.InteractMode and validModes[settings.InteractMode] then
        Config.InteractMode = settings.InteractMode
    end

    -- Proveedores forzados (se aplican al REINICIAR el recurso).
    if type(settings.Providers) == 'table' then
        local allowed = {
            framework = { auto = true, es_extended = true, qbx_core = true, ['qb-core'] = true },
            inventory = { auto = true, ox_inventory = true, ['qb-inventory'] = true },
            notify    = { auto = true, ['vlrp-notify'] = true, ox_lib = true, esx_notify = true, ['qb-core'] = true },
            target    = { auto = true, ox_target = true, ['qb-target'] = true, qtarget = true },
            menu      = { auto = true, ox_lib = true, ['qb-menu'] = true },
            textui    = { auto = true, ['vlrp-textui'] = true, ['cd_drawtextui'] = true, ox_lib = true },
            clothing  = { auto = true, ['illenium-appearance'] = true, ['fivem-appearance'] = true, ['qb-clothing'] = true, esx_skin = true },
        }
        Config.Providers = Config.Providers or {}
        for cat, valid in pairs(allowed) do
            local v = settings.Providers[cat]
            if type(v) == 'string' and valid[v] then
                Config.Providers[cat] = v
            end
        end
        persistProviders() -- escribe el archivo (aplica al reiniciar)
    end

    persistSettings()

    JobCreator.Audit(src, 'cambió los AJUSTES globales', '')
    Bridge.Notify.SendTo(src, { title = 'Job Creator', description = 'Ajustes guardados', type = 'success' })
    syncTo(-1)
end)
