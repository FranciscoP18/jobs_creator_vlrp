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
local framework = Bridge.Resolve({ 'es_extended', 'qbx_core', 'qb-core' })

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
