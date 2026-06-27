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

local function persistSettings()
    local data = json.encode({
        Debug = Config.Debug,
        DefaultPayInterval = Config.DefaultPayInterval,
        InteractMode = Config.InteractMode,
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
            if data.DefaultPayInterval then Config.DefaultPayInterval = data.DefaultPayInterval end
            if data.InteractMode then Config.InteractMode = data.InteractMode end
        end
    else
        persistSettings() -- primera vez: guarda los defaults del .lua
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
            DefaultPayInterval = Config.DefaultPayInterval,
            InteractMode = Config.InteractMode,
        },
    })
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

    Bridge.Notify.SendTo(src, { title = 'Job Creator', description = ('Job "%s" eliminado'):format(name), type = 'success' })
    syncTo(-1)
end)

-- Guardar settings globales.
RegisterNetEvent('job_creator:saveSettings', function(settings)
    local src = source
    if not isAdmin(src) then return end
    if type(settings) ~= 'table' then return end

    if settings.Debug ~= nil then Config.Debug = settings.Debug and true or false end
    if tonumber(settings.DefaultPayInterval) then
        Config.DefaultPayInterval = math.max(1000, tonumber(settings.DefaultPayInterval))
    end
    -- Solo aceptamos modos válidos (evita valores arbitrarios del cliente).
    local validModes = { target = true, key = true, both = true }
    if settings.InteractMode and validModes[settings.InteractMode] then
        Config.InteractMode = settings.InteractMode
    end
    persistSettings()

    Bridge.Notify.SendTo(src, { title = 'Job Creator', description = 'Ajustes guardados', type = 'success' })
    syncTo(-1)
end)
