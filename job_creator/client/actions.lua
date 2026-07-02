-- ============================================================
-- client/actions.lua  (CLIENTE)
-- FRAMEWORK DE ACCIONES de job (esposar, derribar, reparar, ...).
--
-- Reutilizable: cada acción es una definición registrada en un registro central.
-- Otros recursos pueden añadir o SOBRESCRIBIR acciones:
--     exports['job_creator']:RegisterAction('miaccion', { target='player', onUse=fn, onApply=fn })
-- o dispararlas programáticamente:
--     exports['job_creator']:DoAction('handcuff', jobName, targetData)
--
-- Una definición de acción:
--   {
--     target  = 'player' | 'vehicle',   -- sobre qué se usa (informativo)
--     onUse   = function(ctx) end,       -- se ejecuta en el ACTOR al usarla
--     onApply = function(ctx) end,       -- se ejecuta en el OBJETIVO (vía servidor)
--   }
--   ctx (onUse)   = { key, jobName, entity, serverId, data }
--   ctx (onApply) = { key, from, fromName, extra }
--
-- Las acciones que afectan a OTRO jugador usan JobActions.Relay -> el servidor
-- valida (de servicio + acción habilitada + cercanía) y reenvía a su cliente.
-- ============================================================

JobActions = {}
local registry = {}

-- ---------- Registro ----------
function JobActions.Register(key, def)
    if type(key) ~= 'string' or type(def) ~= 'table' then return end
    registry[key] = def
end
function JobActions.Get(key) return registry[key] end
-- Sobre qué se apunta una acción ('player' | 'vehicle'), según su definición.
function JobActions.TargetKind(key)
    local d = registry[key]
    return d and d.target
end

-- Devuelve las "variantes" de opción de target para una acción:
--   { { label, canTarget = fn(entity)? }, ... }
-- Si la def trae `variants`, se usan; si trae `canTarget`, una sola con esa condición;
-- si no, una sola con el label del job.
function JobActions.TargetVariants(key, actionDef)
    local d = registry[key]
    if d and d.variants then return d.variants end
    return { { label = (actionDef and actionDef.label) or key, canTarget = d and d.canTarget } }
end

-- Pide al servidor que valide y reenvíe el efecto al jugador objetivo.
function JobActions.Relay(key, targetServerId, jobName, extra)
    if not targetServerId then return end
    TriggerServerEvent('job_creator:action', key, targetServerId, jobName, extra)
end

-- ---------- Utilidades ----------
local function loadDict(dict)
    if not dict then return end
    RequestAnimDict(dict)
    local t = 0
    while not HasAnimDictLoaded(dict) and t < 1000 do Wait(10); t = t + 10 end
end

local function pedToServerId(ped)
    if not ped or ped == 0 or not IsPedAPlayer(ped) then return nil end
    local plyr = NetworkGetPlayerIndexFromPed(ped)
    if plyr == -1 then return nil end
    return GetPlayerServerId(plyr)
end

local function pedFromServerId(serverId)
    local p = GetPlayerFromServerId(serverId or -1)
    if p == -1 then return 0 end
    return GetPlayerPed(p)
end

-- Pide control de red de una entidad (para reparar/limpiar vehículos de otros).
local function ensureControl(ent)
    if NetworkHasControlOfEntity(ent) then return true end
    local t = 0
    while not NetworkHasControlOfEntity(ent) and t < 1000 do
        NetworkRequestControlOfEntity(ent); Wait(50); t = t + 50
    end
    return NetworkHasControlOfEntity(ent)
end

-- Fuerza el despegado del ped de un jugador. Lo llama el ACTOR, que al ser el
-- "padre" de la atadura tiene autoridad de red sobre ella (el detenido por su
-- cuenta no puede despegarse). Por eso se hace desde aquí.
local function forceDetachPlayer(serverId)
    if not serverId then return end
    local ped = pedFromServerId(serverId)
    if ped == 0 then return end
    if not IsEntityAttachedToEntity(ped, PlayerPedId()) then return end
    local t = 0
    while not NetworkHasControlOfEntity(ped) and t < 200 do
        NetworkRequestControlOfEntity(ped); Wait(10); t = t + 10
    end
    DetachEntity(ped, true, false)
end

-- ¿Está esposado el ped de un jugador? Se lee del statebag del JUGADOR (lo fija el
-- servidor, replicación garantizada), así el agente (otro cliente) puede saberlo.
local function isPlayerCuffed(ped)
    if not ped or ped == 0 or not IsPedAPlayer(ped) then return false end
    local p = NetworkGetPlayerIndexFromPed(ped)
    if p == -1 then return false end
    local sid = GetPlayerServerId(p)
    local ok, st = pcall(function() return Player(sid).state end)
    return ok and st and st.jc_cuffed == true
end

-- Jugador (serverId) más cercano al actor dentro de `maxDist` (para elegir al detenido).
local function nearestPlayerServerId(maxDist)
    local me = PlayerPedId()
    local myc = GetEntityCoords(me)
    local best, bestDist = nil, maxDist or 3.5
    for _, pid in ipairs(GetActivePlayers()) do
        local ped = GetPlayerPed(pid)
        if ped ~= 0 and ped ~= me then
            local d = #(GetEntityCoords(ped) - myc)
            if d < bestDist then best = GetPlayerServerId(pid); bestDist = d end
        end
    end
    return best
end

-- Pide un número al usuario (ox_lib si está; si no, devuelve el valor por defecto).
local function inputNumber(label, default)
    if lib and lib.inputDialog then
        local r = lib.inputDialog(label, { { type = 'number', label = label, default = default or 0, min = 0 } })
        return r and r[1]
    end
    return default
end

-- ¿Tiene el jugador local el item? (chequeo de cliente para feedback inmediato
-- y para gatear las acciones LOCALES que no pasan por el servidor.)
local function clientHasItem(item)
    if not item or item == '' then return true end
    if GetResourceState('ox_inventory') == 'started' then
        return (exports.ox_inventory:Search('count', item) or 0) > 0
    end
    return true -- sin ox_inventory no podemos verificar en cliente; el servidor decide
end

-- ---------- Disparo de una acción (lo llama el target del job) ----------
function JobActions.Trigger(key, jobName, actionDef, targetData)
    -- Requisito de item (pre-chequeo en cliente; el servidor lo reconfirma y consume).
    if actionDef and actionDef.item and actionDef.item ~= '' and not clientHasItem(actionDef.item) then
        Bridge.Notify.Send({ title = 'Acción', description = ('Necesitas %s para esto.'):format(actionDef.item), type = 'error' })
        return
    end
    local entity = targetData and targetData.entity
    local ctx = {
        key = key, jobName = jobName, entity = entity, data = targetData,
        serverId = pedToServerId(entity),
    }
    local def = registry[key]
    if def and def.onUse then
        def.onUse(ctx)
    end
    -- Evento personalizado: extiende/sobrescribe la lógica (compatibilidad).
    if actionDef and actionDef.event and actionDef.event ~= '' then
        TriggerEvent(actionDef.event, targetData)
    end
    -- Sin lógica integrada ni evento: avisa para que se configure.
    if not def and (not actionDef or not actionDef.event or actionDef.event == '') then
        Bridge.Notify.Send({ title = 'Acción', description = ('La acción "%s" no tiene lógica. Asígnale un evento o regístrala con exports.'):format(key), type = 'inform' })
    end
end

-- El servidor nos reenvía el efecto (somos el OBJETIVO de la acción).
RegisterNetEvent('job_creator:applyAction', function(key, fromServerId, fromName, extra)
    local def = registry[key]
    if def and def.onApply then
        def.onApply({ key = key, from = fromServerId, fromName = fromName, extra = extra })
    end
end)

-- ============================================================
--  Estado del jugador objetivo (esposado / arrastrado)
-- ============================================================
local cuffed = false
local dragged = false         -- soy el OBJETIVO arrastrado
local carried = false         -- soy el OBJETIVO cargado
-- Estado del ACTOR (a quién sujeta), para poder SOLTAR sin re-apuntar.
local carrying = false
local carryingTarget, carryingJob = nil, nil
local draggingTarget, draggingJob = nil, nil

local function startCuffLoop()
    CreateThread(function()
        local ped = PlayerPedId()
        loadDict('mp_arresting')
        while cuffed do
            Wait(0)
            -- Dentro de un vehículo (o entrando) NO reaplicamos la animación de pie
            -- (interrumpiría las tareas del coche). Las esposas siguen activas.
            if not IsPedInAnyVehicle(ped, true) and not IsEntityPlayingAnim(ped, 'mp_arresting', 'idle', 3) then
                TaskPlayAnim(ped, 'mp_arresting', 'idle', 8.0, -8.0, -1, 49, 0, false, false, false)
            end
            -- Impedir disparar/usar armas (DEBE llamarse cada frame para que surta efecto).
            DisablePlayerFiring(PlayerId(), true)
            SetPedCanSwitchWeapon(ped, false)
            -- Bloquea acciones mientras está esposado.
            DisableControlAction(0, 24, true)  -- atacar
            DisableControlAction(0, 25, true)  -- apuntar
            DisableControlAction(0, 21, true)  -- correr
            DisableControlAction(0, 22, true)  -- saltar
            DisableControlAction(0, 23, true)  -- entrar vehículo
            DisableControlAction(0, 75, true)  -- SALIR del vehículo (queda retenido)
            DisableControlAction(0, 47, true)  -- arma
            DisableControlAction(0, 44, true)  -- cubrirse
            DisableControlAction(0, 37, true)  -- selector de armas
            DisableControlAction(0, 45, true)  -- recargar
            DisableControlAction(0, 140, true) -- melee ligero
            DisableControlAction(0, 141, true)
            DisableControlAction(0, 142, true)
            DisableControlAction(0, 257, true) -- atacar (alt)
            DisableControlAction(0, 263, true) -- melee 1
            DisableControlAction(0, 264, true) -- melee 2
        end
        ClearPedTasks(ped)
    end)
end

local function setCuffed(state)
    local ped = PlayerPedId()
    cuffed = state and true or false
    -- El servidor fija el statebag del jugador (replicación garantizada) para que
    -- el agente sepa si mostrar "Esposar"/"Quitar esposas"/"Arrastrar".
    TriggerServerEvent('job_creator:setCuffedFlag', cuffed)
    SetEnableHandcuffs(ped, cuffed)
    DisablePlayerFiring(PlayerId(), cuffed)
    SetPedCanPlayGestureAnims(ped, not cuffed)
    if cuffed then
        -- Guarda el arma a las manos vacías (el bucle impide volver a sacarla).
        SetCurrentPedWeapon(ped, GetHashKey('WEAPON_UNARMED'), true)
        startCuffLoop()
        Bridge.Notify.Send({ title = 'Policía', description = 'Te han esposado.', type = 'inform' })
    else
        SetPedCanSwitchWeapon(ped, true)
        if dragged then DetachEntity(ped, true, false); dragged = false end
        ClearPedTasks(ped)
        Bridge.Notify.Send({ title = 'Policía', description = 'Te han quitado las esposas.', type = 'inform' })
    end
end

-- ============================================================
--  Acciones integradas sobre JUGADORES (efecto vía servidor)
-- ============================================================

-- Esposar / quitar esposas (alterna). Dos opciones de target según el estado:
-- "Esposar" si NO está esposado, "Quitar esposas" si lo está.
JobActions.Register('handcuff', {
    target = 'player',
    variants = {
        { label = 'Esposar',        canTarget = function(ped) return not isPlayerCuffed(ped) end },
        { label = 'Quitar esposas', canTarget = function(ped) return isPlayerCuffed(ped) end },
    },
    onUse = function(ctx)
        if not ctx.serverId then return end
        loadDict('mp_arrest_paired')
        local me = PlayerPedId()
        TaskPlayAnim(me, 'mp_arrest_paired', 'cop_p2_back_left', 8.0, -8.0, 2500, 49, 0, false, false, false)
        JobActions.Relay('handcuff', ctx.serverId, ctx.jobName)
    end,
    onApply = function() setCuffed(not cuffed) end,
})

-- Arrastrar a un esposado (alterna): lo ata para que te siga. SOLO aparece si el
-- objetivo está esposado. Para SOLTAR: vuelve a usar "Arrastrar" o pulsa la tecla.
JobActions.Register('drag', {
    target = 'player',
    canTarget = function(ped) return isPlayerCuffed(ped) end,
    onUse = function(ctx)
        if not ctx.serverId then return end
        if draggingTarget then
            -- ya arrastro a alguien -> lo suelto
            local tgt = draggingTarget
            draggingTarget, draggingJob = nil, nil
            JobActions.Relay('drag', tgt, ctx.jobName, { on = false })
        else
            draggingTarget, draggingJob = ctx.serverId, ctx.jobName
            JobActions.Relay('drag', ctx.serverId, ctx.jobName, { on = true })
        end
    end,
    onApply = function(ctx)
        local ped = PlayerPedId()
        local on = ctx.extra and ctx.extra.on
        if not on then
            if dragged then NetworkRequestControlOfEntity(ped); DetachEntity(ped, true, false); dragged = false end
            return
        end
        if not cuffed then
            Bridge.Notify.Send({ title = 'Policía', description = 'Solo puedes arrastrar a alguien esposado.', type = 'error' })
            return
        end
        local actor = pedFromServerId(ctx.from)
        if actor == 0 then return end
        AttachEntityToEntity(ped, actor, 11816, 0.48, 0.5, 0.0, 0.0, 0.0, 0.0, false, false, false, false, 2, false)
        dragged = true
    end,
})

-- Derribar (placar): ragdoll breve.
JobActions.Register('tackle', {
    target = 'player',
    onUse = function(ctx) if ctx.serverId then JobActions.Relay('tackle', ctx.serverId, ctx.jobName) end end,
    onApply = function()
        SetPedToRagdoll(PlayerPedId(), 2500, 2500, 0, false, false, false)
    end,
})

-- Revivir.
JobActions.Register('revive', {
    target = 'player',
    onUse = function(ctx) if ctx.serverId then JobActions.Relay('revive', ctx.serverId, ctx.jobName) end end,
    onApply = function()
        local ped = PlayerPedId()
        local c = GetEntityCoords(ped)
        NetworkResurrectLocalPlayer(c.x, c.y, c.z, GetEntityHeading(ped), true, false)
        SetPlayerInvincible(PlayerId(), false)
        ClearPedBloodDamage(ped)
        SetEntityHealth(ped, GetEntityMaxHealth(ped))
        Bridge.Notify.Send({ title = 'Médico', description = 'Te han revivido.', type = 'success' })
    end,
})

-- Curar (vida al máximo).
JobActions.Register('heal', {
    target = 'player',
    onUse = function(ctx) if ctx.serverId then JobActions.Relay('heal', ctx.serverId, ctx.jobName) end end,
    onApply = function()
        local ped = PlayerPedId()
        SetEntityHealth(ped, GetEntityMaxHealth(ped))
        ClearPedBloodDamage(ped)
        Bridge.Notify.Send({ title = 'Médico', description = 'Te han curado.', type = 'success' })
    end,
})

-- Elige al detenido a meter: a quien sujetas (si está A PIE) o el jugador a pie
-- más cercano. Si ya está DENTRO de un vehículo no es candidato -> así "Meter al
-- vehículo" desaparece una vez metido.
local function pickSuspect()
    local function onFoot(sid)
        if not sid then return false end
        local p = pedFromServerId(sid)
        return p ~= 0 and not IsPedInAnyVehicle(p, false)
    end
    if onFoot(carryingTarget) then return carryingTarget end
    if onFoot(draggingTarget) then return draggingTarget end
    local me = PlayerPedId()
    local myc = GetEntityCoords(me)
    local best, bestDist = nil, 3.5
    for _, pid in ipairs(GetActivePlayers()) do
        local p = GetPlayerPed(pid)
        if p ~= 0 and p ~= me and not IsPedInAnyVehicle(p, false) then
            local d = #(GetEntityCoords(p) - myc)
            if d < bestDist then best = GetPlayerServerId(pid); bestDist = d end
        end
    end
    return best
end

-- Meter al detenido en ESTE vehículo (se apunta al vehículo). Va a un asiento
-- TRASERO (nunca conductor ni copiloto). Solo aparece si hay un detenido a pie.
JobActions.Register('putInVehicle', {
    target = 'vehicle',
    canTarget = function() return pickSuspect() ~= nil end,
    onUse = function(ctx)
        local veh = ctx.entity
        if not veh or veh == 0 then return end
        local suspect = pickSuspect()
        if not suspect then
            Bridge.Notify.Send({ title = 'Acción', description = 'No hay nadie a pie para meter.', type = 'error' })
            return
        end
        forceDetachPlayer(suspect)  -- rompe la atadura desde el agente (autoridad de red)
        JobActions.Relay('putInVehicle', suspect, ctx.jobName, { veh = NetworkGetNetworkIdFromEntity(veh) })
        -- Quien entra al coche deja de estar sujeto.
        if suspect == carryingTarget then carrying = false; carryingTarget, carryingJob = nil, nil end
        if suspect == draggingTarget then draggingTarget, draggingJob = nil, nil end
    end,
    onApply = function(ctx)
        local ped = PlayerPedId()
        -- Soltar SIEMPRE primero (aunque el vehículo aún no esté en red aquí).
        carried, dragged = false, false
        NetworkRequestControlOfEntity(ped)
        DetachEntity(ped, true, false)
        local netId = ctx.extra and ctx.extra.veh
        if not netId then return end
        local veh = NetworkGetEntityFromNetworkId(netId)
        if veh == 0 or not DoesEntityExist(veh) then return end
        -- Asiento TRASERO: empezamos en 1 (0 = copiloto, -1 = conductor).
        local seat
        for s = 1, GetVehicleMaxNumberOfPassengers(veh) - 1 do
            if IsVehicleSeatFree(veh, s) then seat = s; break end
        end
        if not seat then return end -- sin asientos traseros libres
        TaskWarpPedIntoVehicle(ped, veh, seat)
    end,
})

-- Asiento -> nombre del hueso de su puerta (0 cond, 1 copiloto, 2 tras-izq, 3 tras-der).
local DOOR_BONES = { [0] = 'door_dside_f', [1] = 'door_pside_f', [2] = 'door_dside_r', [3] = 'door_pside_r' }

-- Devuelve el ocupante JUGADOR (no el agente) de un vehículo y su asiento, o nil.
local function vehiclePlayerOccupant(veh)
    if not veh or veh == 0 then return nil end
    for s = 0, GetVehicleMaxNumberOfPassengers(veh) - 1 do
        local p = GetPedInVehicleSeat(veh, s)
        if p ~= 0 and IsPedAPlayer(p) and p ~= PlayerPedId() then return p, s end
    end
    return nil
end

-- Sacar a un ocupante (se apunta al VEHÍCULO): el agente camina a la puerta del
-- asiento del detenido, la abre y lo baja. Solo aparece si hay un jugador dentro.
JobActions.Register('takeOutVehicle', {
    target = 'vehicle',
    canTarget = function(veh) return vehiclePlayerOccupant(veh) ~= nil end,
    onUse = function(ctx)
        local veh = ctx.entity
        local occ, seat = vehiclePlayerOccupant(veh)
        if not occ then return end
        local sid = pedToServerId(occ)
        if not sid then return end
        local me = PlayerPedId()
        local doorIndex = (seat or 0) + 1

        -- 1) Camina hasta la puerta de ese asiento.
        local bone = GetEntityBoneIndexByName(veh, DOOR_BONES[doorIndex] or 'door_pside_r')
        local pos = (bone ~= -1) and GetWorldPositionOfEntityBone(veh, bone) or GetEntityCoords(veh)
        TaskGoStraightToCoord(me, pos.x, pos.y, pos.z, 1.0, 2500, 0.0, 0.4)
        local t = 0
        while t < 2500 and #(GetEntityCoords(me) - pos) > 1.3 do Wait(50); t = t + 50 end
        ClearPedTasks(me)
        TaskTurnPedToFaceEntity(me, veh, 800)
        Wait(300)

        -- 2) Abre la puerta, hace la animación de TIRAR y baja al detenido.
        ensureControl(veh)
        SetVehicleDoorOpen(veh, doorIndex, false, false)
        loadDict('mp_arrest_paired')
        TaskPlayAnim(me, 'mp_arrest_paired', 'cop_p2_back_left', 4.0, -4.0, 1800, 49, 0, false, false, false)
        Wait(500) -- deja que el agente "agarre" antes de sacarlo
        JobActions.Relay('takeOutVehicle', sid, ctx.jobName)
        Wait(1000)
        ClearPedTasks(me)

        -- 3) Cierra la puerta tras un momento.
        CreateThread(function()
            Wait(1500)
            if DoesEntityExist(veh) then SetVehicleDoorShut(veh, doorIndex, false) end
        end)
    end,
    onApply = function()
        local ped = PlayerPedId()
        local veh = GetVehiclePedIsIn(ped, false)
        if veh == 0 then return end
        -- Las esposas pueden bloquear la salida: las soltamos un instante para
        -- forzar el bajado y se reaplican (sigue esposado).
        local wasCuffed = cuffed
        if wasCuffed then SetEnableHandcuffs(ped, false) end
        TaskLeaveVehicle(ped, veh, 0)
        if wasCuffed then
            CreateThread(function()
                Wait(1500)
                if cuffed then SetEnableHandcuffs(PlayerPedId(), true) end
            end)
        end
    end,
})

-- Cargar a alguien en brazos/hombros (alterna). Usa las animaciones de "ayudar".
local CARRY_DICT = 'missfinale_c2ig_11'

local function startCarrierAnim()
    CreateThread(function()
        local ped = PlayerPedId()
        loadDict(CARRY_DICT)
        while carrying do
            -- Subir (o empezar a subir) a un vehículo cancela el cargar, para que
            -- la animación en bucle no bloquee el entrar/salir del coche.
            if IsPedInAnyVehicle(ped, true) then
                if carryingTarget then JobActions.Relay('carry', carryingTarget, carryingJob, { on = false }) end
                carrying = false; carryingTarget, carryingJob = nil, nil
                break
            end
            if not IsEntityPlayingAnim(ped, CARRY_DICT, 'fin_c2_helpmichael', 3) then
                TaskPlayAnim(ped, CARRY_DICT, 'fin_c2_helpmichael', 8.0, -8.0, -1, 49, 0, false, false, false)
            end
            Wait(250)
        end
        StopAnimTask(ped, CARRY_DICT, 'fin_c2_helpmichael', 1.0)
    end)
end

local function setCarried(state, actorServerId)
    local ped = PlayerPedId()
    if state then
        local actor = pedFromServerId(actorServerId)
        if actor == 0 then return end
        loadDict(CARRY_DICT)
        carried = true
        AttachEntityToEntity(ped, actor, 0, 0.27, 0.20, 0.63, 0.5, 0.5, 0.0, false, false, false, false, 2, true)
        CreateThread(function()
            while carried do
                if not IsEntityPlayingAnim(ped, CARRY_DICT, 'fin_c2_helpdal', 3) then
                    TaskPlayAnim(ped, CARRY_DICT, 'fin_c2_helpdal', 8.0, -8.0, -1, 49, 0, false, false, false)
                end
                Wait(250)
            end
        end)
        Bridge.Notify.Send({ title = 'Acción', description = 'Te están cargando.', type = 'inform' })
    else
        carried = false
        NetworkRequestControlOfEntity(ped)
        DetachEntity(ped, true, false)
        ClearPedTasks(ped)
    end
end

JobActions.Register('carry', {
    target = 'player',
    onUse = function(ctx)
        if not ctx.serverId then return end
        if carrying then
            -- Suelto a quien ya llevaba (aunque apunte a otro).
            local tgt = carryingTarget or ctx.serverId
            carrying = false; carryingTarget, carryingJob = nil, nil
            JobActions.Relay('carry', tgt, ctx.jobName, { on = false })
        else
            carrying = true; carryingTarget, carryingJob = ctx.serverId, ctx.jobName
            startCarrierAnim()
            JobActions.Relay('carry', ctx.serverId, ctx.jobName, { on = true })
        end
    end,
    onApply = function(ctx)
        setCarried(ctx.extra and ctx.extra.on and true or false, ctx.from)
    end,
})

-- Multar: cobra una cantidad al objetivo (lo procesa el servidor con ESX).
JobActions.Register('bill', {
    target = 'player',
    onUse = function(ctx)
        if not ctx.serverId then return end
        local amount = inputNumber('Multar — cantidad ($)', 0)
        amount = math.floor(tonumber(amount) or 0)
        if amount <= 0 then return end
        TriggerServerEvent('job_creator:bill', ctx.serverId, ctx.jobName, amount)
    end,
})

-- Cachear: abre el inventario del jugador cercano (ox_inventory).
-- Requisito de ox_inventory: el AGENTE debe estar en el grupo `police`
-- (config de ox_inventory) o el objetivo tener el state canSteal, y a ≤1.8 m.
JobActions.Register('search', {
    target = 'player',
    onUse = function()
        if GetResourceState('ox_inventory') == 'started' then
            exports.ox_inventory:openNearbyInventory()
        else
            Bridge.Notify.Send({ title = 'Cachear', description = 'Necesitas ox_inventory para registrar.', type = 'error' })
        end
    end,
})

-- ============================================================
--  Acciones integradas sobre VEHÍCULOS (efecto local en el actor)
-- ============================================================
JobActions.Register('repair', {
    target = 'vehicle',
    onUse = function(ctx)
        local veh = ctx.entity
        if not veh or veh == 0 then return end
        ensureControl(veh)
        SetVehicleFixed(veh)
        SetVehicleDeformationFixed(veh)
        SetVehicleUndamaged(veh, true)
        SetVehicleEngineHealth(veh, 1000.0)
        SetVehicleBodyHealth(veh, 1000.0)
        SetVehiclePetrolTankHealth(veh, 1000.0)
        SetVehicleEngineOn(veh, true, true, false)
        Bridge.Notify.Send({ title = 'Mecánico', description = 'Vehículo reparado.', type = 'success' })
    end,
})

JobActions.Register('clean', {
    target = 'vehicle',
    onUse = function(ctx)
        local veh = ctx.entity
        if not veh or veh == 0 then return end
        ensureControl(veh)
        SetVehicleDirtLevel(veh, 0.0)
        WashDecalsFromVehicle(veh, 1.0)
        Bridge.Notify.Send({ title = 'Limpieza', description = 'Vehículo limpio.', type = 'success' })
    end,
})

JobActions.Register('hijack', {
    target = 'vehicle',
    onUse = function(ctx)
        local veh = ctx.entity
        if not veh or veh == 0 then return end
        ensureControl(veh)
        local me = PlayerPedId()
        loadDict('veh@break_in@0h@p_m_one@')
        TaskPlayAnim(me, 'veh@break_in@0h@p_m_one@', 'low_force_entry_ds', 8.0, -8.0, 3000, 0, 0, false, false, false)
        Wait(2500)
        SetVehicleDoorsLocked(veh, 1)
        SetVehicleDoorsLockedForAllPlayers(veh, false)
        ClearPedTasks(me)
        Bridge.Notify.Send({ title = 'Forzar', description = 'Vehículo abierto.', type = 'success' })
    end,
})

-- Incautar: lo borra el servidor (validación + auditoría).
JobActions.Register('impound', {
    target = 'vehicle',
    onUse = function(ctx)
        local veh = ctx.entity
        if not veh or veh == 0 then return end
        -- El servidor valida y borra la entidad (con auditoría).
        TriggerServerEvent('job_creator:vehicleAction', 'impound', NetworkGetNetworkIdFromEntity(veh), ctx.jobName)
    end,
})

-- ============================================================
--  Soltar (tecla): suelta a quien cargas o arrastras sin re-apuntar.
-- ============================================================
local function releaseHeld()
    local did = false
    if carrying and carryingTarget then
        forceDetachPlayer(carryingTarget)   -- el agente rompe la atadura (tiene autoridad)
        JobActions.Relay('carry', carryingTarget, carryingJob, { on = false })
        carrying = false; carryingTarget, carryingJob = nil, nil
        did = true
    end
    if draggingTarget then
        forceDetachPlayer(draggingTarget)
        JobActions.Relay('drag', draggingTarget, draggingJob, { on = false })
        draggingTarget, draggingJob = nil, nil
        did = true
    end
    if did then
        StopAnimTask(PlayerPedId(), CARRY_DICT, 'fin_c2_helpmichael', 1.0)
        Bridge.Notify.Send({ title = 'Acción', description = 'Has soltado al detenido.', type = 'inform' })
    end
end
JobActions.ReleaseHeld = releaseHeld

RegisterCommand('jc_soltar', releaseHeld, false)
-- Tecla por defecto X (se puede recambiar en Ajustes > Controles del cliente).
RegisterKeyMapping('jc_soltar', 'Soltar a quien cargas/arrastras (job)', 'keyboard', 'X')

-- Rescate TOTAL: limpia todo tu estado si te quedas atascado.
-- (Incluye quitarte las esposas: útil para pruebas; en producción conviene
--  protegerlo con permiso de admin para que no sea un escape de detenidos.)
local function clearSelf()
    releaseHeld()
    local ped = PlayerPedId()
    cuffed, carried, dragged = false, false, false
    TriggerServerEvent('job_creator:setCuffedFlag', false)
    SetEnableHandcuffs(ped, false)
    DisablePlayerFiring(PlayerId(), false)
    SetPedCanPlayGestureAnims(ped, true)
    SetPedCanSwitchWeapon(ped, true)
    NetworkRequestControlOfEntity(ped)
    DetachEntity(ped, true, false)
    ClearPedTasks(ped)
    ClearPedSecondaryTask(ped)
end
JobActions.ClearSelf = clearSelf
RegisterCommand('jcfix', function()
    clearSelf()
    Bridge.Notify.Send({ title = 'Acción', description = 'Estado liberado por completo.', type = 'success' })
end, false)

-- Vigilante: al subir (o empezar a subir) a un vehículo mientras cargas/arrastras
-- a alguien, lo sueltas automáticamente (cubre arrastrar, que no tiene bucle propio).
CreateThread(function()
    while true do
        Wait(400)
        if (carrying or carryingTarget or draggingTarget) and IsPedInAnyVehicle(PlayerPedId(), true) then
            releaseHeld()
        end
    end
end)

-- ============================================================
--  Exports (extensibilidad para otros recursos / scripts futuros)
-- ============================================================
exports('RegisterAction', function(key, def) JobActions.Register(key, def) end)
exports('DoAction', function(key, jobName, targetData)
    JobActions.Trigger(key, jobName, (targetData and targetData.actionDef) or {}, targetData)
end)

-- Si nos vamos esposados/arrastrados y el recurso para, limpiamos.
AddEventHandler('onResourceStop', function(res)
    if res ~= GetCurrentResourceName() then return end
    if cuffed or dragged or carried then
        local ped = PlayerPedId()
        DetachEntity(ped, true, false)
        ClearPedTasks(ped)
        SetEnableHandcuffs(ped, false)
        TriggerServerEvent('job_creator:setCuffedFlag', false)
    end
end)
