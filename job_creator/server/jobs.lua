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

-- Verifica requisitos (job del framework, items a consumir)
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
            -- Usamos el bridge de inventario para 'money' como item si es ox,
            -- o el framework para cuentas. Aquí lo dejamos vía addItem 'money'/'cash'
            -- que en la mayoría de setups equivale a la cuenta cash.
            Bridge.Inventory.AddItem(src, reward.money.account or 'cash', amount)
        end
    end
end

-- Evento principal: el cliente pide completar un step.
RegisterNetEvent('job_creator:completeStep', function(jobName, stepId)
    local src = source

    local job = Config.Jobs[jobName]
    if not job then return end

    local step = findStep(job, stepId)
    if not step then
        Bridge.Print('warn', ('Jugador %d pidió un step inexistente: %s/%s'):format(src, jobName, tostring(stepId)))
        return
    end

    -- Anti-exploit: distancia real
    if not isNearStep(src, step) then
        Bridge.Print('warn', ('Jugador %d demasiado lejos del step %s'):format(src, stepId))
        return
    end

    -- Anti-spam: cooldown basado en la duración del progreso del step
    local stepKey = jobName .. ':' .. stepId
    local cdDuration = (step.progress and step.progress.duration or 1000) - 500
    if not checkCooldown(src, stepKey, cdDuration) then
        return -- silencioso: probablemente doble click / lag
    end

    -- Requisitos
    local ok, reason = meetsRequirements(src, step)
    if not ok then
        Bridge.Notify.SendTo(src, { title = job.label, description = reason, type = 'error' })
        return
    end

    -- Consumir requisitos antes de dar recompensa
    if not consumeRequirements(src, step) then
        Bridge.Notify.SendTo(src, { title = job.label, description = 'No se pudieron retirar los materiales', type = 'error' })
        return
    end

    -- Otorgar recompensa
    giveReward(src, step.reward)

    Bridge.Notify.SendTo(src, {
        title = job.label,
        description = ('%s completado'):format(step.label or stepId),
        type = 'success',
    })
end)

-- Limpieza de cooldowns al desconectar (evita fuga de memoria)
AddEventHandler('playerDropped', function()
    local src = source
    cooldowns[src] = nil
end)
