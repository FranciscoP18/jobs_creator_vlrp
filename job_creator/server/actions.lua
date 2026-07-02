-- ============================================================
-- server/actions.lua  (SERVIDOR)
-- Valida y reenvía las ACCIONES de job al jugador objetivo.
--
-- Seguridad (no se confía en el cliente):
--   * El actor debe estar EN SERVICIO de ese job.
--   * La acción debe estar habilitada en el job.
--   * El actor debe cumplir el trabajo requerido (privado por defecto).
--   * Actor y objetivo deben estar CERCA (anti-exploit).
-- ============================================================

-- ¿Puede el jugador `src` usar la acción `key` del job `jobName` ahora mismo?
local function playerMayAct(src, jobName, key)
    local job = Config.Jobs[jobName]
    if not job or job.enabled == false then return false end

    -- En job.actions SOLO están las acciones habilitadas (su presencia = activa).
    if not (job.actions and job.actions[key]) then return false end

    -- Debe estar en servicio de ESTE job.
    local st = Player(src).state
    if not (st.jc_duty == true and st.jc_dutyJob == jobName) then return false end

    -- Debe cumplir el trabajo requerido (mismo criterio que duty/stash).
    local needName, needGrade = Bridge.RequiredJob(job)
    if needName then
        local pj = Bridge.Framework.GetJob(src)
        if not pj or pj.name ~= needName or (pj.grade or 0) < (needGrade or 0) then return false end
    end
    return true
end

-- Distancia entre dos jugadores (servidor).
local function playersNear(a, b, maxDist)
    local pa, pb = GetPlayerPed(a), GetPlayerPed(b)
    if pa == 0 or pb == 0 then return false end
    return #(GetEntityCoords(pa) - GetEntityCoords(pb)) <= (maxDist or 5.0)
end

-- Si la acción exige un item, comprueba que el actor lo tenga (y lo consume si
-- está marcado). Devuelve true si puede; false + razón si le falta el item.
local function actionItemOk(src, jobName, key)
    local job = Config.Jobs[jobName]
    local act = job and job.actions and job.actions[key]
    local item = act and act.item
    if not item or item == '' then return true end
    if Bridge.Inventory.GetItemCount(src, item) < 1 then
        return false, ('Necesitas %s para esto'):format(item)
    end
    if act.consume then Bridge.Inventory.RemoveItem(src, item, 1) end
    return true
end

-- El cliente (objetivo) avisa de su estado de esposado; lo publicamos en su
-- statebag de jugador (replicación garantizada a todos los clientes). Es solo
-- un indicador para la UI del target (qué opciones mostrar).
RegisterNetEvent('job_creator:setCuffedFlag', function(state)
    local src = source
    Player(src).state:set('jc_cuffed', state == true, true)
end)

-- Acción sobre otro JUGADOR: valida y reenvía a su cliente.
RegisterNetEvent('job_creator:action', function(key, targetServerId, jobName, extra)
    local src = source
    targetServerId = tonumber(targetServerId)
    if type(key) ~= 'string' or not targetServerId then return end

    if not playerMayAct(src, jobName, key) then
        Bridge.Notify.SendTo(src, { title = 'Acción', description = 'No puedes usar esta acción ahora.', type = 'error' })
        return
    end
    if not GetPlayerName(targetServerId) then return end -- objetivo desconectado/ inválido
    if not playersNear(src, targetServerId, 5.0) then
        Bridge.Notify.SendTo(src, { title = 'Acción', description = 'Estás demasiado lejos.', type = 'error' })
        return
    end
    local itemOk, itemReason = actionItemOk(src, jobName, key)
    if not itemOk then
        Bridge.Notify.SendTo(src, { title = 'Acción', description = itemReason, type = 'error' })
        return
    end

    TriggerClientEvent('job_creator:applyAction', targetServerId, key, src, GetPlayerName(src), extra)

    if Config.AuditActions and JobCreator and JobCreator.Audit then
        JobCreator.Audit(src, ('usó "%s" sobre el jugador %d'):format(key, targetServerId), jobName)
    end
end)

-- Acción sobre VEHÍCULO que requiere el servidor (de momento: incautar).
RegisterNetEvent('job_creator:vehicleAction', function(key, netId, jobName)
    local src = source
    if type(key) ~= 'string' or not netId then return end
    if not playerMayAct(src, jobName, key) then
        Bridge.Notify.SendTo(src, { title = 'Acción', description = 'No puedes usar esta acción ahora.', type = 'error' })
        return
    end

    local ent = NetworkGetEntityFromNetworkId(netId)
    if not ent or ent == 0 or not DoesEntityExist(ent) then return end

    local itemOk, itemReason = actionItemOk(src, jobName, key)
    if not itemOk then
        Bridge.Notify.SendTo(src, { title = 'Acción', description = itemReason, type = 'error' })
        return
    end

    if key == 'impound' then
        DeleteEntity(ent)
        Bridge.Notify.SendTo(src, { title = 'Grúa', description = 'Vehículo incautado.', type = 'success' })
        if Config.AuditActions and JobCreator and JobCreator.Audit then
            JobCreator.Audit(src, 'incautó un vehículo', jobName)
        end
    end
end)

-- Multar: cobra `amount` del BANCO del objetivo. El dinero va a la caja de la
-- empresa (si el job usa sociedad) o, si no, al banco del actor.
RegisterNetEvent('job_creator:bill', function(targetServerId, jobName, amount)
    local src = source
    targetServerId = tonumber(targetServerId)
    amount = math.floor(tonumber(amount) or 0)
    if not targetServerId or amount <= 0 then return end

    if not playerMayAct(src, jobName, 'bill') then
        Bridge.Notify.SendTo(src, { title = 'Multa', description = 'No puedes multar ahora.', type = 'error' })
        return
    end
    if not GetPlayerName(targetServerId) then return end
    if not playersNear(src, targetServerId, 8.0) then
        Bridge.Notify.SendTo(src, { title = 'Multa', description = 'Estás demasiado lejos.', type = 'error' })
        return
    end
    local itemOk, itemReason = actionItemOk(src, jobName, 'bill')
    if not itemOk then
        Bridge.Notify.SendTo(src, { title = 'Multa', description = itemReason, type = 'error' })
        return
    end

    -- Cobra del banco del ciudadano.
    if not Bridge.Framework.RemoveMoney(targetServerId, 'bank', amount) then
        Bridge.Notify.SendTo(src, { title = 'Multa', description = 'El ciudadano no tiene saldo suficiente en el banco.', type = 'error' })
        return
    end

    -- Destino del dinero.
    local job = Config.Jobs[jobName]
    if job and job.society and job.society.enabled and JobCreator and JobCreator.AddSociety then
        JobCreator.AddSociety(jobName, amount)
    else
        Bridge.Framework.AddMoney(src, 'bank', amount)
    end

    Bridge.Notify.SendTo(targetServerId, { title = 'Multa', description = ('Te han multado con $%d.'):format(amount), type = 'error' })
    Bridge.Notify.SendTo(src, { title = 'Multa', description = ('Has multado con $%d.'):format(amount), type = 'success' })
    if Config.AuditActions and JobCreator and JobCreator.Audit then
        JobCreator.Audit(src, ('multó con $%d al jugador %d'):format(amount, targetServerId), jobName)
    end
end)
