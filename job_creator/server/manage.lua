-- ============================================================
-- server/manage.lua  (SERVIDOR)
-- Runtime de gestión de plantilla:
--   * Salarios por grado: paga a quien esté en servicio (jc_duty) según el
--     grado de su job en el framework y la tabla `grades` del job.
--   * Menú de jefe: contratar / despedir / cambiar grado.
--
-- Seguridad: toda acción de jefe revalida que el solicitante sea ADMIN (ACE)
-- o el JEFE del job (grado máximo definido). Nunca se confía en el cliente.
-- ============================================================

local ACE_PERMISSION = 'job_creator.admin'
local UNEMPLOYED = Config.UnemployedJob or 'unemployed'

local function isAdmin(src)
    return src == 0 or IsPlayerAceAllowed(src, ACE_PERMISSION)
end

-- Nombre del job en el FRAMEWORK (ESX/QB) que representa este job_creator.
-- Es el "Job requerido" (requirements.job); si no se define, cae al nombre
-- interno. Este es el puente con el HUD y los grados del framework.
local function fwJob(job)
    local req = job.requirements
    if req and req.job then
        if type(req.job) == 'table' then return req.job.name end
        return req.job
    end
    return job.name
end

-- Grado más alto definido en el job (= "jefe").
local function maxGrade(job)
    local m = 0
    if job.grades then
        for _, g in ipairs(job.grades) do
            if (g.grade or 0) > m then m = g.grade end
        end
    end
    return m
end

-- ¿El solicitante es jefe de este job? (mismo job de framework + grado tope)
local function isBossOf(src, job)
    local pj = Bridge.Framework.GetJob(src)
    if not pj or pj.name ~= fwJob(job) then return false end
    return (pj.grade or 0) >= maxGrade(job)
end

local function canManage(src, job)
    return isAdmin(src) or isBossOf(src, job)
end

-- ---------- Salarios ----------
-- Un único hilo paga en cada intervalo. Solo cobra quien está en jc_duty del
-- job y cuyo grado tiene salario definido en la tabla `grades`.
CreateThread(function()
    while true do
        local interval = Config.DefaultPayInterval or 60000
        Wait(interval)

        for _, raw in ipairs(GetPlayers()) do
            local src = tonumber(raw)
            local player = Player(src)
            if player and player.state and player.state.jc_duty then
                local jobName = player.state.jc_dutyJob
                local job = jobName and Config.Jobs[jobName]
                if job and job.enabled ~= false and job.grades then
                    local pj = Bridge.Framework.GetJob(src)
                    -- Solo paga si su job del framework coincide con el del servicio.
                    local grade = (pj and pj.name == fwJob(job) and pj.grade) or nil
                    if grade then
                        for _, g in ipairs(job.grades) do
                            if (g.grade or 0) == grade and (g.salary or 0) > 0 then
                                local fromFund = job.society and job.society.enabled
                                    and job.society.salaryFromFund ~= false
                                if fromFund and JobCreator.GetSociety(jobName) < g.salary then
                                    Bridge.Notify.SendTo(src, {
                                        title = job.label or jobName,
                                        description = 'La empresa no tiene fondos para tu salario',
                                        type = 'error',
                                    })
                                elseif Bridge.Framework.AddMoney(src, 'bank', g.salary) then
                                    if fromFund then JobCreator.AddSociety(jobName, -g.salary) end
                                    Bridge.Notify.SendTo(src, {
                                        title = job.label or jobName,
                                        description = ('Salario recibido: $%d'):format(g.salary),
                                        type = 'success',
                                    })
                                    if Config.AuditSalaries and JobCreator.Audit then
                                        JobCreator.Audit(src, ('cobró salario $%d (grado %d)'):format(g.salary, grade), jobName)
                                    end
                                end
                                break
                            end
                        end
                    end
                end
            end
        end
    end
end)

-- ---------- Menú de jefe ----------
-- El cliente pide la lista de jugadores online para el menú; validamos permiso.
RegisterNetEvent('job_creator:bossRequestPlayers', function(jobName)
    local src = source
    local job = Config.Jobs[jobName]
    if not job or job.enabled == false or not canManage(src, job) then return end
    local hasSociety = (job.society and job.society.enabled) or false
    TriggerClientEvent('job_creator:bossPlayers', src, jobName,
        Bridge.Framework.GetOnlinePlayers(), JobCreator.GetSociety(jobName), hasSociety, nil, fwJob(job))
end)

-- Ingresar dinero (banco del jefe -> caja de la empresa).
RegisterNetEvent('job_creator:bossDeposit', function(data)
    local src = source
    local job = data and Config.Jobs[data.jobName]
    if not job or job.enabled == false or not canManage(src, job) then return end
    local amount = math.floor(tonumber(data.amount) or 0)
    if amount <= 0 then return end
    if not Bridge.Framework.RemoveMoney(src, 'bank', amount) then
        Bridge.Notify.SendTo(src, { title = job.label, description = 'No tienes suficiente dinero en el banco', type = 'error' })
        return
    end
    local nuevo = JobCreator.AddSociety(data.jobName, amount)
    Bridge.Notify.SendTo(src, { title = job.label, description = ('Ingresado $%d. Caja: $%d'):format(amount, nuevo or 0), type = 'success' })
    if Config.AuditActions and JobCreator.Audit then
        JobCreator.Audit(src, ('ingresó $%d a la caja'):format(amount), data.jobName)
    end
end)

-- Retirar dinero (caja de la empresa -> banco del jefe).
RegisterNetEvent('job_creator:bossWithdraw', function(data)
    local src = source
    local job = data and Config.Jobs[data.jobName]
    if not job or job.enabled == false or not canManage(src, job) then return end
    local amount = math.floor(tonumber(data.amount) or 0)
    if amount <= 0 then return end
    local nuevo = JobCreator.AddSociety(data.jobName, -amount)
    if not nuevo then
        Bridge.Notify.SendTo(src, { title = job.label, description = 'La empresa no tiene fondos suficientes', type = 'error' })
        return
    end
    if not Bridge.Framework.AddMoney(src, 'bank', amount) then
        JobCreator.AddSociety(data.jobName, amount) -- revertir si falla el pago
        Bridge.Notify.SendTo(src, { title = job.label, description = 'No se pudo retirar', type = 'error' })
        return
    end
    Bridge.Notify.SendTo(src, { title = job.label, description = ('Retirado $%d. Caja: $%d'):format(amount, nuevo), type = 'success' })
    if Config.AuditActions and JobCreator.Audit then
        JobCreator.Audit(src, ('retiró $%d de la caja'):format(amount), data.jobName)
    end
end)

-- Acción de jefe: { action = 'hire'|'fire'|'setgrade', jobName, target, grade }
RegisterNetEvent('job_creator:bossAction', function(data)
    local src = source
    if type(data) ~= 'table' then return end

    local job = Config.Jobs[data.jobName]
    if not job or job.enabled == false or not canManage(src, job) then
        Bridge.Notify.SendTo(src, { title = 'Gestión', description = 'No tienes permiso', type = 'error' })
        return
    end

    local target = tonumber(data.target)
    if not target or not GetPlayerName(target) then
        Bridge.Notify.SendTo(src, { title = 'Gestión', description = 'Jugador no válido o desconectado', type = 'error' })
        return
    end

    -- Asignamos el job de FRAMEWORK (el "Job requerido"), no el nombre interno,
    -- para que coincida con el HUD y los grados de ESX/QB.
    local fw = fwJob(job)
    local ok = false
    if data.action == 'hire' then
        ok = Bridge.Framework.SetJob(target, fw, tonumber(data.grade) or 0)
    elseif data.action == 'setgrade' then
        ok = Bridge.Framework.SetJob(target, fw, tonumber(data.grade) or 0)
    elseif data.action == 'fire' then
        ok = Bridge.Framework.SetJob(target, UNEMPLOYED, 0)
    end

    if ok then
        Bridge.Notify.SendTo(src, { title = job.label, description = 'Acción realizada correctamente', type = 'success' })
        Bridge.Notify.SendTo(target, { title = job.label, description = 'Tu empleo ha sido actualizado', type = 'inform' })
        if Config.AuditActions and JobCreator.Audit then
            local act = data.action == 'fire' and 'despidió' or (data.action == 'hire' and 'contrató' or 'cambió grado de')
            JobCreator.Audit(src, ('%s a %s [%d]'):format(act, GetPlayerName(target) or '?', target), data.jobName)
        end
        -- Reabre el menú de empleados ya actualizado (el despedido desaparece).
        local hasSociety = (job.society and job.society.enabled) or false
        TriggerClientEvent('job_creator:bossPlayers', src, data.jobName,
            Bridge.Framework.GetOnlinePlayers(), JobCreator.GetSociety(data.jobName), hasSociety, 'employees', fw)
    else
        Bridge.Notify.SendTo(src, { title = job.label, description = 'No se pudo aplicar (revisa el framework)', type = 'error' })
    end
end)
