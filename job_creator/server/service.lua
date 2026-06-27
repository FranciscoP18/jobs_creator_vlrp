-- ============================================================
-- server/service.lua  (SERVIDOR)
-- Lógica de los trabajos de SERVICIO (police/ems/mechanic):
--   * Duty (entrar/salir de servicio) -> estado replicado por statebag.
--   * Registro de stashes (cofres de servicio) restringidos por job.
--
-- ESX no tiene duty nativo: lo gestionamos aquí. El estado vive en
-- Player(src).state.jc_duty (replicado al cliente) y solo puede activarse
-- si el jugador tiene el job ESX que exige la estación.
-- ============================================================

-- ---------- Utilidades ----------
local function isNear(src, coords, margin)
    if not coords then return true end
    local ped = GetPlayerPed(src)
    if ped == 0 then return false end
    return #(GetEntityCoords(ped) - coords) <= (margin or 5.0)
end

-- ¿El jugador cumple el job que exige la estación? Devuelve true/false + razón.
-- Si el job no define requirements.job, cualquiera puede (servicio libre).
local function meetsJob(src, job)
    local req = job.requirements
    if not req or not req.job then return true end

    local needName, needGrade
    if type(req.job) == 'table' then
        needName, needGrade = req.job.name, req.job.grade or 0
    else
        needName, needGrade = req.job, 0
    end

    local pj = Bridge.Framework.GetJob(src)
    if not pj or pj.name ~= needName then
        return false, 'No perteneces a este trabajo'
    end
    if (pj.grade or 0) < needGrade then
        return false, 'Tu rango es insuficiente'
    end
    return true
end

-- ---------- Duty ----------
RegisterNetEvent('job_creator:toggleDuty', function(jobName)
    local src = source
    local job = Config.Jobs[jobName]
    if not job or not job.duty then return end

    -- Anti-exploit: debe estar en el punto de duty.
    if not isNear(src, job.duty.coords, 5.0) then return end

    -- Debe tener el job para entrar en servicio.
    local ok, reason = meetsJob(src, job)
    if not ok then
        Bridge.Notify.SendTo(src, { title = job.label, description = reason, type = 'error' })
        return
    end

    local player = Player(src)
    local current = player.state.jc_duty and player.state.jc_dutyJob == jobName
    local newState = not current

    -- replicated = true -> el cliente lo lee en LocalPlayer.state.*
    player.state:set('jc_duty', newState, true)
    player.state:set('jc_dutyJob', newState and jobName or nil, true)

    Bridge.Notify.SendTo(src, {
        title = job.label,
        description = newState and 'Has entrado en servicio' or 'Has salido de servicio',
        type = newState and 'success' or 'inform',
    })
end)

-- Comprueba en servidor que el jugador está en duty del job (para stash, etc.)
local function isOnDuty(src, jobName)
    local player = Player(src)
    return player.state.jc_duty == true and player.state.jc_dutyJob == jobName
end

-- El cliente pide abrir el stash de servicio: validamos job + duty + distancia.
RegisterNetEvent('job_creator:openServiceStash', function(jobName)
    local src = source
    local job = Config.Jobs[jobName]
    if not job or not job.stash then return end

    if not isNear(src, job.stash.coords, 5.0) then return end

    local ok, reason = meetsJob(src, job)
    if not ok then
        Bridge.Notify.SendTo(src, { title = job.label, description = reason, type = 'error' })
        return
    end

    if job.stash.requireDuty ~= false and not isOnDuty(src, jobName) then
        Bridge.Notify.SendTo(src, { title = job.label, description = 'Debes estar en servicio', type = 'error' })
        return
    end

    local stashId = job.stash.id or ('jc_' .. jobName)
    -- Confirmamos al cliente que puede abrir ese stash.
    TriggerClientEvent('job_creator:doOpenStash', src, stashId)
end)

-- ---------- Registro de stashes ----------
-- (Re)registra los stashes de todos los jobs con sección stash.
local function registerStashes()
    for name, job in pairs(Config.Jobs) do
        if job.stash then
            local stashId = job.stash.id or ('jc_' .. name)
            -- groups: restringe el acceso al job a nivel ox (seguridad real,
            -- independiente del duty que es solo UX).
            local groups
            if job.requirements and job.requirements.job then
                local jn = type(job.requirements.job) == 'table' and job.requirements.job.name or job.requirements.job
                groups = { [jn] = 0 }
            end
            Bridge.Inventory.RegisterStash({
                id = stashId,
                label = job.stash.label or job.label,
                slots = job.stash.slots,
                weight = job.stash.weight,
                groups = groups,
            })
        end
    end
end

-- store.lua dispara esto al terminar de cargar y tras cada edición de jobs.
AddEventHandler('job_creator:jobsReloaded', function()
    registerStashes()
end)

-- Limpia el estado de duty al desconectar.
AddEventHandler('playerDropped', function()
    -- statebags del Player se limpian solas al salir; nada que hacer aquí,
    -- pero dejamos el handler por si se añade lógica de fin de servicio.
end)
