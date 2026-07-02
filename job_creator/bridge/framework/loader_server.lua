-- ============================================================
-- bridge/framework/loader_server.lua  (SERVIDOR)
-- API uniforme de framework: dinero (cuentas) y job del jugador.
-- El inventario tiene su propio módulo; esto cubre lo que NO es
-- inventario: cash/bank y el trabajo asignado al jugador.
--
--   Bridge.Framework.AddMoney(source, account, amount)    -> bool
--   Bridge.Framework.RemoveMoney(source, account, amount) -> bool
--   Bridge.Framework.GetJob(source)                       -> { name, grade } | nil
--
-- account: 'cash' | 'bank'  (se traduce a la cuenta real de cada framework)
-- ============================================================

Bridge.Framework = {}

-- Orden importante: qbx_core antes que qb-core (Qbox puede convivir con shims qb).
local framework = Bridge.Pick('framework', { 'es_extended', 'qbx_core', 'qb-core' })

-- Framework activo expuesto para otros módulos (ej: decidir fallback de dinero).
-- nil = no hay framework detectado (setup ox puro).
Bridge.Framework.Active = framework

local ESX, QBCore

CreateThread(function()
    if framework == 'es_extended' then
        ESX = exports['es_extended']:getSharedObject()
    elseif framework == 'qb-core' then
        QBCore = exports['qb-core']:GetCoreObject()
    end
    -- Qbox (qbx_core) se usa vía exports directos, no necesita objeto cacheado.
    Bridge.Print('info', 'Framework: ' .. (framework or 'ninguno'))
end)

-- Devuelve el objeto de jugador del framework activo (o nil).
local function getPlayer(src)
    if framework == 'es_extended' then
        return ESX and ESX.GetPlayerFromId(src)
    elseif framework == 'qbx_core' then
        return exports.qbx_core:GetPlayer(src)
    elseif framework == 'qb-core' then
        return QBCore and QBCore.Functions.GetPlayer(src)
    end
    return nil
end

-- Traducción de cuenta lógica -> cuenta real de cada framework.
-- ESX llama 'money' al efectivo; QB/Qbox lo llaman 'cash'.
local ESX_ACCOUNTS = { cash = 'money', bank = 'bank' }

function Bridge.Framework.AddMoney(src, account, amount)
    account = account or 'cash'
    local player = getPlayer(src)
    if not player then return false end

    if framework == 'es_extended' then
        player.addAccountMoney(ESX_ACCOUNTS[account] or 'money', amount)
        return true
    elseif framework == 'qbx_core' or framework == 'qb-core' then
        -- AddMoney devuelve bool en versiones modernas, nil en antiguas.
        return player.Functions.AddMoney(account, amount, 'job_creator') ~= false
    end
    return false
end

function Bridge.Framework.RemoveMoney(src, account, amount)
    account = account or 'cash'
    local player = getPlayer(src)
    if not player then return false end

    if framework == 'es_extended' then
        local real = ESX_ACCOUNTS[account] or 'money'
        local acc = player.getAccount(real)
        if not acc or acc.money < amount then return false end
        player.removeAccountMoney(real, amount)
        return true
    elseif framework == 'qbx_core' or framework == 'qb-core' then
        return player.Functions.RemoveMoney(account, amount, 'job_creator') ~= false
    end
    return false
end

-- Devuelve { name, grade } del job del jugador. grade es el nivel numérico.
function Bridge.Framework.GetJob(src)
    local player = getPlayer(src)
    if not player then return nil end

    if framework == 'es_extended' then
        local job = player.getJob and player.getJob() or player.job
        if not job then return nil end
        return { name = job.name, grade = job.grade or 0 }
    elseif framework == 'qbx_core' or framework == 'qb-core' then
        local job = player.PlayerData and player.PlayerData.job
        if not job then return nil end
        return { name = job.name, grade = job.grade and job.grade.level or 0 }
    end
    return nil
end

-- Asigna un trabajo (y rango) a un jugador. Devuelve bool.
-- Para "despedir" pasa el job de paro del framework (ej: 'unemployed').
function Bridge.Framework.SetJob(src, name, grade)
    local player = getPlayer(src)
    if not player then return false end
    grade = grade or 0

    if framework == 'es_extended' then
        if not player.setJob then return false end
        player.setJob(name, grade)
        return true
    elseif framework == 'qbx_core' then
        return exports.qbx_core:SetJob(src, name, grade) ~= false
    elseif framework == 'qb-core' then
        if not player.Functions or not player.Functions.SetJob then return false end
        return player.Functions.SetJob(name, grade) ~= false
    end
    return false
end

-- Sincroniza un job + sus grados HACIA el framework (job_creator manda).
-- En ESX: actualiza las tablas jobs/job_grades, refresca el cache y reaplica
-- el job a los jugadores online para que el HUD muestre los rangos del panel.
function Bridge.Framework.SyncJob(jobName, label, grades)
    if type(jobName) ~= 'string' or jobName == '' then return false end
    if not grades or #grades == 0 then return false end

    if framework == 'es_extended' then
        MySQL.prepare.await(
            'INSERT INTO jobs (name, label) VALUES (?, ?) ON DUPLICATE KEY UPDATE label = VALUES(label)',
            { jobName, label or jobName })
        MySQL.prepare.await('DELETE FROM job_grades WHERE job_name = ?', { jobName })
        for _, g in ipairs(grades) do
            local gradeNum = math.floor(tonumber(g.grade) or 0)
            local display = tostring(g.name or ('Grado ' .. gradeNum))
            local internal = display:lower():gsub('%s+', '_'):gsub('[^%w_]', '')
            if internal == '' then internal = 'grade' .. gradeNum end
            MySQL.prepare.await(
                'INSERT INTO job_grades (job_name, grade, name, label, salary, skin_male, skin_female) VALUES (?, ?, ?, ?, ?, ?, ?)',
                { jobName, gradeNum, internal, display, math.floor(tonumber(g.salary) or 0), '{}', '{}' })
        end

        if ESX and ESX.RefreshJobs then
            ESX.RefreshJobs()
        else
            Bridge.Print('warn', 'ESX.RefreshJobs no disponible: reinicia ESX para ver los rangos nuevos')
        end

        -- Reaplica el job a los online de ese job para refrescar su HUD.
        for _, src in ipairs(GetPlayers()) do
            local xp = ESX.GetPlayerFromId(tonumber(src))
            if xp then
                local pj = (xp.getJob and xp.getJob()) or xp.job
                if pj and pj.name == jobName and xp.setJob then
                    xp.setJob(jobName, pj.grade or 0)
                end
            end
        end
        return true
    end

    Bridge.Print('warn', 'SyncJob solo está implementado para ESX por ahora')
    return false
end

-- Lista de grados de un job del framework: { { grade, name, salary } }.
-- Sirve para importar los rangos reales (ESX/QB) al panel del job_creator.
function Bridge.Framework.GetJobGrades(jobName)
    local out = {}
    if framework == 'es_extended' and ESX then
        local ok, jobs = pcall(function() return ESX.GetJobs and ESX.GetJobs() end)
        local j = ok and jobs and jobs[jobName]
        if j and j.grades then
            for key, g in pairs(j.grades) do
                out[#out + 1] = {
                    grade = tonumber(g.grade) or tonumber(key) or 0,
                    name = g.label or g.name or '',
                    salary = tonumber(g.salary) or 0,
                }
            end
        end
    elseif (framework == 'qb-core' or framework == 'qbx_core') then
        local shared = QBCore and QBCore.Shared and QBCore.Shared.Jobs
        local j = shared and shared[jobName]
        if j and j.grades then
            for lvl, g in pairs(j.grades) do
                out[#out + 1] = {
                    grade = tonumber(lvl) or 0,
                    name = g.name or '',
                    salary = tonumber(g.payment) or 0,
                }
            end
        end
    end
    table.sort(out, function(a, b) return a.grade < b.grade end)
    return out
end

-- Lista de jugadores online: { { id, name, job = {name, grade} } }.
-- Incluye el job actual para que el menú de jefe pueda filtrar empleados.
function Bridge.Framework.GetOnlinePlayers()
    local out = {}
    for _, src in ipairs(GetPlayers()) do
        local id = tonumber(src)
        out[#out + 1] = {
            id = id,
            name = GetPlayerName(id) or ('Jugador ' .. id),
            job = Bridge.Framework.GetJob(id),
        }
    end
    return out
end
