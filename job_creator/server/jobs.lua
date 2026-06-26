-- ============================================================
-- server/jobs.lua
-- Núcleo de validación. NUNCA confíes en el cliente:
--   - valida que el step exista
--   - valida cooldown (anti-spam)
--   - valida distancia real del jugador a la zona (anti tp/exploit)
--   - valida y consume items requeridos
--   - otorga recompensas de forma controlada
-- ============================================================

local cooldowns = {}  -- [source] = { [stepKey] = expiresAt }

-- Devuelve un número aleatorio entre min y max (inclusive)
local function randomBetween(min, max)
    if not max then return min end
    return math.random(min, max)
end

-- Comprueba y aplica cooldown por jugador/step
local function checkCooldown(src, stepKey, duration)
    local now = GetGameTimer()
    cooldowns[src] = cooldowns[src] or {}
    local expires = cooldowns[src][stepKey]
    if expires and now < expires then
        return false
    end
    cooldowns[src][stepKey] = now + (duration or 1000)
    return true
end

-- Valida distancia entre el jugador y las coords del step (anti-exploit)
local function isNearStep(src, step)
    if not step.target then return true end
    local ped = GetPlayerPed(src)
    if ped == 0 then return false end
    local pcoords = GetEntityCoords(ped)
    local d = #(pcoords - step.target.coords)
    return d <= 5.0  -- margen generoso para latencia
end

-- Busca un step por id dentro de un job
local function findStep(job, stepId)
    for _, step in ipairs(job.steps) do
        if step.id == stepId then return step end
    end
    return nil
end

-- Verifica los requisitos a nivel de JOB (trabajo del framework, item de acceso).
-- requirements.job puede ser:
--   'police'                          -> solo exige el nombre del job
--   { name = 'police', grade = 2 }    -> exige nombre y rango mínimo
local function meetsJobRequirements(src, job)
    local req = job.requirements
    if not req then return true end

    if req.job then
        local needName, needGrade
        if type(req.job) == 'table' then
            needName, needGrade = req.job.name, req.job.grade or 0
        else
            needName, needGrade = req.job, 0
        end

        local pj = Bridge.Framework.GetJob(src)
        if not pj or pj.name ~= needName then
            return false, 'No tienes el trabajo requerido'
        end
        if (pj.grade or 0) < needGrade then
            return false, 'Tu rango es insuficiente para esto'
        end
    end

    if req.item then
        if Bridge.Inventory.GetItemCount(src, req.item) < 1 then
            return false, ('Necesitas %s para trabajar aquí'):format(req.item)
        end
    end

    return true
end

-- Verifica requisitos del STEP (items a consumir)
local function meetsRequirements(src, step)
    if step.requires then
        for _, req in ipairs(step.requires) do
            local count = Bridge.Inventory.GetItemCount(src, req.name)
            if count < req.count then
                return false, ('Necesitas %dx %s'):format(req.count, req.name)
            end
        end
    end
    return true
end

-- Consume los items requeridos por el step
local function consumeRequirements(src, step)
    if not step.requires then return true end
    for _, req in ipairs(step.requires) do
        local ok = Bridge.Inventory.RemoveItem(src, req.name, req.count)
        if not ok then return false end
    end
    return true
end

-- Comprueba que el jugador pueda cargar TODOS los items de recompensa.
-- Usamos item.max (el peor caso) para no consumir materiales y luego
-- descubrir que el premio no cabe. Devuelve false + nombre del item que no cabe.
local function canCarryReward(src, reward)
    if not reward or not reward.items then return true end
    for _, item in ipairs(reward.items) do
        local worstCase = item.max or item.min or 1
        if not Bridge.Inventory.CanCarry(src, item.name, worstCase) then
            return false, item.name
        end
    end
    return true
end

-- Entrega la recompensa del step (items y/o dinero)
local function giveReward(src, reward)
    if not reward then return end

    if reward.items then
        for _, item in ipairs(reward.items) do
            local amount = randomBetween(item.min or 1, item.max)
            if amount > 0 then
                Bridge.Inventory.AddItem(src, item.name, amount)
            end
        end
    end

    if reward.money then
        local amount = randomBetween(reward.money.min, reward.money.max)
        if amount > 0 then
            local account = reward.money.account or 'cash'
            -- El dinero es una CUENTA del framework (cash/bank), no un item.
            local ok = Bridge.Framework.AddMoney(src, account, amount)
            -- Fallback a item 'money' SOLO si no hay framework (setup ox puro).
            -- Si hay framework y AddMoney falló de verdad, NO duplicamos el pago.
            if not ok and not Bridge.Framework.Active then
                Bridge.Inventory.AddItem(src, 'money', amount)
            end
        end
    end
end

-- Lógica central de completar un step. Recibe src EXPLÍCITO para poder
-- invocarla tanto desde el evento de red como desde el export programático.
--   opts.trusted = true  -> omite anti-exploit de distancia y cooldown
--                           (la llamada viene de otro recurso, no del cliente)
local function processStep(src, jobName, stepId, opts)
    opts = opts or {}

    local job = Config.Jobs[jobName]
    if not job then return false end

    local step = findStep(job, stepId)
    if not step then
        Bridge.Print('warn', ('Jugador %s pidió un step inexistente: %s/%s'):format(tostring(src), jobName, tostring(stepId)))
        return false
    end

    if not opts.trusted then
        -- Anti-exploit: distancia real
        if not isNearStep(src, step) then
            Bridge.Print('warn', ('Jugador %d demasiado lejos del step %s'):format(src, stepId))
            return false
        end

        -- Anti-spam: cooldown basado en la duración del progreso del step
        local stepKey = jobName .. ':' .. stepId
        local cdDuration = (step.progress and step.progress.duration or 1000) - 500
        if not checkCooldown(src, stepKey, cdDuration) then
            return false -- silencioso: probablemente doble click / lag
        end
    end

    -- Requisitos a nivel de job (trabajo del framework, item de acceso)
    local okJob, jobReason = meetsJobRequirements(src, job)
    if not okJob then
        Bridge.Notify.SendTo(src, { title = job.label, description = jobReason, type = 'error' })
        return false
    end

    -- Requisitos del step (items a consumir)
    local ok, reason = meetsRequirements(src, step)
    if not ok then
        Bridge.Notify.SendTo(src, { title = job.label, description = reason, type = 'error' })
        return false
    end

    -- Comprobar espacio ANTES de consumir materiales (evita perder la recompensa)
    local canCarry = canCarryReward(src, step.reward)
    if not canCarry then
        Bridge.Notify.SendTo(src, { title = job.label, description = 'No tienes espacio en el inventario', type = 'error' })
        return false
    end

    -- Consumir requisitos antes de dar recompensa
    if not consumeRequirements(src, step) then
        Bridge.Notify.SendTo(src, { title = job.label, description = 'No se pudieron retirar los materiales', type = 'error' })
        return false
    end

    -- Otorgar recompensa
    giveReward(src, step.reward)

    Bridge.Notify.SendTo(src, {
        title = job.label,
        description = ('%s completado'):format(step.label or stepId),
        type = 'success',
    })
    return true
end

-- Expuesto para que server/main.lua lo use en el export CompleteStepFor.
JobCreator = JobCreator or {}
JobCreator.ProcessStep = processStep

-- Evento principal: el cliente pide completar un step.
RegisterNetEvent('job_creator:completeStep', function(jobName, stepId)
    -- Capturamos source en local: el global puede cambiar tras un yield interno.
    local src = source
    processStep(src, jobName, stepId)
end)

-- Limpieza de cooldowns al desconectar (evita fuga de memoria)
AddEventHandler('playerDropped', function()
    local src = source
    cooldowns[src] = nil
end)
