-- ============================================================
-- client/jobs.lua
-- Motor que interpreta las definiciones de job y construye:
--   * blips
--   * STEPS    (jobs de economía: recolectar/procesar/vender)
--   * STATIONS (jobs de servicio: duty / stash / wardrobe)
--
-- Las definiciones llegan SINCRONIZADAS desde el servidor (fuente de
-- verdad = DB). Al editar un job en el panel, el servidor reenvía la
-- lista y reconstruimos todo en caliente.
-- ============================================================

local createdBlips = {}
local syncedJobs = {} -- [name] = job normalizado (para probar steps desde el panel)
local actionTargets = {} -- { {type, name} } opciones globales de acción registradas

local DEFAULT_STATION_SIZE = vec3(1.6, 1.6, 2.0)

-- ¿Estoy en servicio de este job? (statebag replicado desde el servidor)
local function onDutyFor(jobName)
    return LocalPlayer.state.jc_duty == true and LocalPlayer.state.jc_dutyJob == jobName
end

-- ---------- Blip ----------
local function createBlip(job)
    if not job.blip then return end
    local b = job.blip
    local blip = AddBlipForCoord(b.coords.x, b.coords.y, b.coords.z)
    SetBlipSprite(blip, b.sprite or 1)
    SetBlipColour(blip, b.color or 0)
    SetBlipScale(blip, b.scale or 0.8)
    SetBlipAsShortRange(blip, true)
    BeginTextCommandSetBlipName('STRING')
    AddTextComponentSubstringPlayerName(b.label or job.label)
    EndTextCommandSetBlipName(blip)
    createdBlips[#createdBlips + 1] = blip
end

-- Blip OPCIONAL de una estación (duty/stash/armería/…). Se dibuja en las coords
-- de la propia estación si tiene `station.blip`. Se limpia con el resto de blips.
local function createStationBlip(station, fallbackLabel)
    if not station or not station.blip or not station.coords then return end
    local b = station.blip
    local blip = AddBlipForCoord(station.coords.x, station.coords.y, station.coords.z)
    SetBlipSprite(blip, b.sprite or 1)
    SetBlipColour(blip, b.color or 0)
    SetBlipScale(blip, b.scale or 0.7)
    SetBlipAsShortRange(blip, true)
    BeginTextCommandSetBlipName('STRING')
    AddTextComponentSubstringPlayerName(b.label or fallbackLabel or 'Trabajo')
    EndTextCommandSetBlipName(blip)
    createdBlips[#createdBlips + 1] = blip
end

-- ---------- Animación / progreso (steps) ----------
local function playStepAnim(anim)
    if not anim then return end
    RequestAnimDict(anim.dict)
    local t = 0
    while not HasAnimDictLoaded(anim.dict) and t < 1000 do Wait(10) t = t + 10 end
    if HasAnimDictLoaded(anim.dict) then
        TaskPlayAnim(PlayerPedId(), anim.dict, anim.clip, 8.0, -8.0, -1, 1, 0, false, false, false)
    end
end

local function stopAnim()
    ClearPedTasks(PlayerPedId())
end

local function doProgress(progress)
    if not progress then return true end
    if lib and lib.progressCircle then
        return lib.progressCircle({
            duration = progress.duration,
            label = progress.label or 'Trabajando...',
            useWhileDead = false,
            canCancel = true,
            disable = { move = false, car = true, combat = true },
        })
    else
        Wait(progress.duration)
        return true
    end
end

local function onStepInteract(jobName, step)
    playStepAnim(step.anim)
    local completed = doProgress(step.progress)
    stopAnim()
    if not completed then
        Bridge.Notify.Send({ title = 'Cancelado', description = 'Has cancelado la acción', type = 'error' })
        return
    end
    -- Toda la validación ocurre en el SERVIDOR.
    TriggerServerEvent('job_creator:completeStep', jobName, step.id)
end

-- ---------- Wardrobe (vestuario) ----------
local function openWardrobe(job)
    local w = job.wardrobe
    if not w then return end
    if w.requireDuty and not onDutyFor(job.name) then
        Bridge.Notify.Send({ title = job.label, description = 'Debes estar en servicio', type = 'error' })
        return
    end

    local options = {}
    for _, outfit in ipairs(w.outfits or {}) do
        options[#options + 1] = {
            title = outfit.label or 'Conjunto',
            description = outfit.civilian and 'Volver a tu ropa de calle' or 'Ponerte este uniforme',
            icon = outfit.civilian and 'fa-solid fa-person' or 'fa-solid fa-shirt',
            onSelect = function()
                if outfit.civilian then
                    Bridge.Clothing.RestoreCivilian()
                else
                    -- Guarda la ropa civil la primera vez que te pones un uniforme.
                    if not Bridge.Clothing.IsWearingUniform() then
                        Bridge.Clothing.SaveCivilian()
                    end
                    Bridge.Clothing.ApplyOutfit(outfit)
                end
            end,
        }
    end

    if #options == 0 then
        Bridge.Notify.Send({ title = job.label, description = 'Este vestuario no tiene conjuntos configurados', type = 'inform' })
        return
    end
    Bridge.Menu.Open({ id = 'jc_wardrobe_' .. job.name, title = (w.label or 'Vestuario'), options = options })
end

-- ---------- Garaje de vehículos ----------
local spawnedVehicle = nil

local function spawnJobVehicle(job, model)
    if not job.garage then return end
    local hash = type(model) == 'string' and joaat(model) or model
    RequestModel(hash)
    local t = 0
    while not HasModelLoaded(hash) and t < 3000 do Wait(10) t = t + 10 end
    if not HasModelLoaded(hash) then
        Bridge.Notify.Send({ title = job.label, description = 'No se pudo cargar el vehículo', type = 'error' })
        return
    end

    -- Borra el vehículo anterior que hubieras sacado.
    if spawnedVehicle and DoesEntityExist(spawnedVehicle) then DeleteEntity(spawnedVehicle) end

    local sp = job.garage.spawn or {}
    local coords = job.garage.coords
    local x = sp.x or coords.x
    local y = sp.y or coords.y
    local z = sp.z or coords.z
    local h = sp.h or 0.0

    -- Si llevabas a alguien cargado/arrastrado, suéltalo antes de conducir
    -- (evita que la animación en bucle bloquee el bajarte del vehículo).
    if JobActions and JobActions.ReleaseHeld then JobActions.ReleaseHeld() end

    local veh = CreateVehicle(hash, x + 0.0, y + 0.0, z + 0.0, h + 0.0, true, false)
    SetModelAsNoLongerNeeded(hash)
    SetVehicleOnGroundProperly(veh)
    SetVehicleDoorsLocked(veh, 1) -- desbloqueado
    SetPedIntoVehicle(PlayerPedId(), veh, -1)
    SetEntityAsMissionEntity(veh, true, true)
    SetVehicleHasBeenOwnedByPlayer(veh, true)
    spawnedVehicle = veh

    Bridge.Notify.Send({ title = job.label, description = 'Vehículo entregado', type = 'success' })
end

local function storeJobVehicle(job)
    local ped = PlayerPedId()
    local veh = GetVehiclePedIsIn(ped, false)
    if veh == 0 then
        -- Si no estás dentro, busca el último que sacaste cerca.
        veh = spawnedVehicle
    end
    if veh and DoesEntityExist(veh) then
        DeleteEntity(veh)
        if veh == spawnedVehicle then spawnedVehicle = nil end
        Bridge.Notify.Send({ title = job.label, description = 'Vehículo guardado', type = 'inform' })
    else
        Bridge.Notify.Send({ title = job.label, description = 'No hay vehículo que guardar', type = 'error' })
    end
end

local function openGarage(job)
    local g = job.garage
    if g.requireDuty and not onDutyFor(job.name) then
        Bridge.Notify.Send({ title = job.label, description = 'Debes estar en servicio', type = 'error' })
        return
    end
    local options = {}
    for _, v in ipairs(g.vehicles or {}) do
        options[#options + 1] = {
            title = v.label or v.model,
            description = 'Sacar este vehículo',
            icon = 'fa-solid fa-car',
            onSelect = function() spawnJobVehicle(job, v.model) end,
        }
    end
    options[#options + 1] = {
        title = 'Guardar vehículo',
        description = 'Guarda el vehículo actual',
        icon = 'fa-solid fa-warehouse',
        onSelect = function() storeJobVehicle(job) end,
    }
    Bridge.Menu.Open({ id = 'jc_garage_' .. job.name, title = (g.label or 'Garaje'), options = options })
end

-- ---------- Menú de jefe ----------
local function promptNumber(label, default)
    if lib and lib.inputDialog then
        local r = lib.inputDialog(label, { { type = 'number', label = label, default = default or 0 } })
        return r and r[1]
    end
    return default
end

-- Submenú de fondos de la empresa (ingresar / retirar).
local function openSocietyMenu(jobName, balance)
    Bridge.Menu.Open({
        id = 'jc_society_' .. jobName,
        title = ('Caja de la empresa: $%d'):format(balance or 0),
        options = {
            {
                title = 'Ingresar dinero',
                description = 'De tu banco a la caja',
                icon = 'fa-solid fa-arrow-down',
                onSelect = function()
                    local amount = promptNumber('Cantidad a ingresar', 0)
                    if amount and amount > 0 then
                        TriggerServerEvent('job_creator:bossDeposit', { jobName = jobName, amount = amount })
                    end
                end,
            },
            {
                title = 'Retirar dinero',
                description = 'De la caja a tu banco',
                icon = 'fa-solid fa-arrow-up',
                onSelect = function()
                    local amount = promptNumber('Cantidad a retirar', 0)
                    if amount and amount > 0 then
                        TriggerServerEvent('job_creator:bossWithdraw', { jobName = jobName, amount = amount })
                    end
                end,
            },
        },
    })
end

-- fwName = nombre del job en el framework (puede diferir del nombre interno).
local function isEmployeeOf(p, fwName)
    return p.job and p.job.name == fwName
end

-- Lista de EMPLEADOS del job (cambiar grado / despedir).
local function openEmployees(jobName, players, fwName)
    local job = Config.Jobs and Config.Jobs[jobName]
    local title = (job and job.boss and job.boss.label) or 'Gestión de empleados'
    local options = {}
    for _, p in ipairs(players or {}) do
        if isEmployeeOf(p, fwName) then
            options[#options + 1] = {
                title = ('[%d] %s'):format(p.id, p.name),
                description = ('Grado actual: %d'):format(p.job.grade or 0),
                icon = 'fa-solid fa-user',
                onSelect = function()
                    Bridge.Menu.Open({
                        id = 'jc_boss_actions',
                        title = p.name,
                        options = {
                            {
                                title = 'Cambiar grado',
                                description = 'Asigna un grado distinto',
                                icon = 'fa-solid fa-arrow-up-right-dots',
                                onSelect = function()
                                    local grade = promptNumber('Nuevo grado', p.job.grade or 0)
                                    if grade == nil then return end
                                    TriggerServerEvent('job_creator:bossAction', { action = 'setgrade', jobName = jobName, target = p.id, grade = grade })
                                end,
                            },
                            {
                                title = 'Despedir',
                                description = 'Lo pasa a paro',
                                icon = 'fa-solid fa-user-minus',
                                onSelect = function()
                                    TriggerServerEvent('job_creator:bossAction', { action = 'fire', jobName = jobName, target = p.id })
                                end,
                            },
                        },
                    })
                end,
            }
        end
    end
    if #options == 0 then
        Bridge.Notify.Send({ title = title, description = 'No hay empleados en servicio/online', type = 'inform' })
        return
    end
    Bridge.Menu.Open({ id = 'jc_boss_emp_' .. jobName, title = title, options = options })
end

-- Lista de jugadores NO empleados (para contratar).
local function openHire(jobName, players, fwName)
    local options = {}
    for _, p in ipairs(players or {}) do
        if not isEmployeeOf(p, fwName) then
            options[#options + 1] = {
                title = ('[%d] %s'):format(p.id, p.name),
                description = 'Contratar para este trabajo',
                icon = 'fa-solid fa-user-plus',
                onSelect = function()
                    local grade = promptNumber('Grado a asignar', 0)
                    if grade == nil then return end
                    TriggerServerEvent('job_creator:bossAction', { action = 'hire', jobName = jobName, target = p.id, grade = grade })
                end,
            }
        end
    end
    if #options == 0 then
        Bridge.Notify.Send({ title = 'Contratar', description = 'No hay jugadores disponibles', type = 'inform' })
        return
    end
    Bridge.Menu.Open({ id = 'jc_boss_hire_' .. jobName, title = 'Contratar empleado', options = options })
end

-- Menú raíz del jefe: fondos (si hay sociedad) + empleados + contratar.
local function openBossMenu(jobName, players, balance, hasSociety, fwName)
    local job = Config.Jobs and Config.Jobs[jobName]
    local title = (job and job.boss and job.boss.label) or 'Gestión'
    local options = {}
    if hasSociety then
        options[#options + 1] = {
            title = ('💰 Fondos: $%d'):format(balance or 0),
            description = 'Ingresar o retirar dinero de la empresa',
            icon = 'fa-solid fa-building-columns',
            onSelect = function() openSocietyMenu(jobName, balance) end,
        }
    end
    options[#options + 1] = {
        title = '👥 Empleados',
        description = 'Cambiar grado o despedir',
        icon = 'fa-solid fa-users',
        onSelect = function() openEmployees(jobName, players, fwName) end,
    }
    options[#options + 1] = {
        title = '➕ Contratar',
        description = 'Dar el trabajo a un jugador online',
        icon = 'fa-solid fa-user-plus',
        onSelect = function() openHire(jobName, players, fwName) end,
    }
    Bridge.Menu.Open({ id = 'jc_boss_' .. jobName, title = title, options = options })
end

RegisterNetEvent('job_creator:bossPlayers', function(jobName, players, balance, hasSociety, view, fwName)
    if view == 'employees' then
        openEmployees(jobName, players, fwName)
    else
        openBossMenu(jobName, players, balance, hasSociety, fwName)
    end
end)

-- ---------- Construcción de stations ----------
local function addZone(coords, size, options)
    -- Delegamos en la capa de interacción: ella decide target / tecla E / ambos.
    Interaction.AddPoint({
        coords = coords,
        size = size or DEFAULT_STATION_SIZE,
        options = options,
    })
end

local function buildDuty(job)
    local d = job.duty
    addZone(d.coords, d.size, {
        {
            label = d.labelOn or 'Salir de servicio',
            icon = 'fa-solid fa-clipboard-check',
            distance = 2.0,
            canInteract = function() return onDutyFor(job.name) end,
            onSelect = function() TriggerServerEvent('job_creator:toggleDuty', job.name) end,
        },
        {
            label = d.labelOff or 'Entrar en servicio',
            icon = 'fa-solid fa-clipboard-user',
            distance = 2.0,
            canInteract = function() return not onDutyFor(job.name) end,
            onSelect = function() TriggerServerEvent('job_creator:toggleDuty', job.name) end,
        },
    })
    createStationBlip(d, 'Servicio')
end

local function buildStash(job)
    local s = job.stash
    addZone(s.coords, s.size, {
        {
            label = s.label or 'Inventario de servicio',
            icon = 'fa-solid fa-box-archive',
            distance = 2.0,
            onSelect = function() TriggerServerEvent('job_creator:openServiceStash', job.name) end,
        },
    })
    createStationBlip(s, 'Cofre')
end

-- ---------- Armería / taquilla ----------
local function openLocker(job)
    local l = job.locker
    if l.requireDuty ~= false and not onDutyFor(job.name) then
        Bridge.Notify.Send({ title = job.label, description = 'Debes estar en servicio', type = 'error' })
        return
    end
    local options = {}
    for _, it in ipairs(l.items or {}) do
        local amount = math.max(1, math.floor(tonumber(it.amount) or 1))
        local desc = ('Coger %dx'):format(amount)
        if (tonumber(it.limit) or 0) > 0 then desc = desc .. (' · máx %d'):format(it.limit) end
        options[#options + 1] = {
            title = it.label or it.name,
            description = desc,
            icon = 'fa-solid fa-box-open',
            onSelect = function() TriggerServerEvent('job_creator:takeLockerItem', job.name, it.name) end,
        }
    end
    if #options == 0 then
        Bridge.Notify.Send({ title = job.label, description = 'La taquilla no tiene items configurados', type = 'inform' })
        return
    end
    Bridge.Menu.Open({ id = 'jc_locker_' .. job.name, title = (l.label or 'Taquilla'), options = options })
end

local function buildLocker(job)
    local l = job.locker
    addZone(l.coords, l.size, {
        {
            label = l.label or 'Taquilla',
            icon = 'fa-solid fa-box-open',
            distance = 2.0,
            onSelect = function() openLocker(job) end,
        },
    })
    createStationBlip(l, 'Armería')
end

local function buildWardrobe(job)
    local w = job.wardrobe
    addZone(w.coords, w.size, {
        {
            label = w.label or 'Vestuario',
            icon = 'fa-solid fa-shirt',
            distance = 2.0,
            onSelect = function() openWardrobe(job) end,
        },
    })
    createStationBlip(w, 'Vestuario')
end

local function buildSteps(job)
    for _, step in ipairs(job.steps or {}) do
        local t = step.target
        if t then
            -- Si el step tiene progreso, en modo tecla se interactúa MANTENIENDO la
            -- tecla (barra de progreso de vlrp-textui) en vez de un solo toque.
            -- En ese caso el "hold" ES el progreso, así que no repetimos doProgress.
            local holdMs = step.progress and step.progress.duration or nil
            addZone(t.coords, t.size, {
                {
                    label = t.label or step.label,
                    icon = t.icon,
                    distance = 2.5,
                    -- Camino "pulsar" (modo target o sin soporte de hold): anim + progreso + completar.
                    onSelect = function() onStepInteract(job.name, step) end,
                    -- Camino "mantener" (modo tecla con vlrp-textui):
                    hold = holdMs,
                    holdLabel = (step.progress and step.progress.label) or t.label or step.label,
                    onHoldStart = function() playStepAnim(step.anim) end,
                    onHoldEnd = function() stopAnim() end,
                    onHoldComplete = function()
                        -- Toda la validación ocurre en el SERVIDOR.
                        TriggerServerEvent('job_creator:completeStep', job.name, step.id)
                    end,
                    onHoldCancel = function()
                        Bridge.Notify.Send({ title = 'Cancelado', description = 'Has cancelado la acción', type = 'error' })
                    end,
                },
            })
        end
    end
end

local function buildGarage(job)
    local g = job.garage
    addZone(g.coords, g.size, {
        {
            label = g.label or 'Garaje',
            icon = 'fa-solid fa-warehouse',
            distance = 2.5,
            onSelect = function() openGarage(job) end,
        },
    })
    createStationBlip(g, 'Garaje')
end

local function buildBoss(job)
    local b = job.boss
    addZone(b.coords, b.size, {
        {
            label = b.label or 'Gestión de empleados',
            icon = 'fa-solid fa-briefcase',
            distance = 2.0,
            onSelect = function() TriggerServerEvent('job_creator:bossRequestPlayers', job.name) end,
        },
    })
    createStationBlip(b, 'Jefe')
end

-- ---------- Acciones (target global en jugadores/vehículos) ----------
-- Cada acción habilitada crea una opción de target. Al usarla, el framework
-- (client/actions.lua) ejecuta su lógica integrada y, si hay un evento
-- configurado, también lo dispara (para extender/personalizar).
local function buildActions(job)
    if not job.actions then return end
    for key, a in pairs(job.actions) do
        -- El tipo de objetivo lo manda la DEFINICIÓN de la acción (futuro-compatible);
        -- si no está registrada, cae al type guardado.
        local kind = (JobActions and JobActions.TargetKind(key)) or a.type or 'player'
        -- Variantes: p.ej. esposar genera "Esposar" y "Quitar esposas" según estado.
        local variants = (JobActions and JobActions.TargetVariants(key, a)) or { { label = a.label } }
        for vi, v in ipairs(variants) do
            local name = ('jc_act_%s_%s_%d'):format(job.name, key, vi)
            local canTarget = v.canTarget
            local option = {
                name = name,
                label = v.label or a.label or key,
                icon = a.icon,
                distance = 2.5,
                -- Solo en servicio y, si la variante define una condición de contexto
                -- (esposado, dentro de un vehículo…), solo cuando se cumpla.
                canInteract = function(entity)
                    if not onDutyFor(job.name) then return false end
                    if canTarget then return canTarget(entity) end
                    return true
                end,
                onSelect = function(data) JobActions.Trigger(key, job.name, a, data) end,
            }
            if kind == 'vehicle' then
                Bridge.Target.AddGlobalVehicle({ option })
            else
                Bridge.Target.AddGlobalPlayer({ option })
            end
            actionTargets[#actionTargets + 1] = { type = kind, name = name }
        end
    end
end

-- Construye todo lo de un job
local function buildJob(job)
    createBlip(job)
    if job.duty then buildDuty(job) end
    if job.stash then buildStash(job) end
    if job.wardrobe then buildWardrobe(job) end
    if job.locker and job.locker.coords then buildLocker(job) end
    if job.garage and job.garage.coords then buildGarage(job) end
    if job.boss and job.boss.coords then buildBoss(job) end
    if job.actions then buildActions(job) end
    buildSteps(job)
end

-- ---------- Limpieza / reconstrucción ----------
local function clearAll()
    Interaction.ClearAll()
    for _, blip in ipairs(createdBlips) do
        RemoveBlip(blip)
    end
    createdBlips = {}
    -- Quita las opciones globales de acción registradas.
    for _, a in ipairs(actionTargets) do
        if a.type == 'vehicle' then
            Bridge.Target.RemoveGlobalVehicle({ a.name })
        else
            Bridge.Target.RemoveGlobalPlayer({ a.name })
        end
    end
    actionTargets = {}
end

local function rebuild(jobs)
    clearAll()
    syncedJobs = {}
    for _, raw in ipairs(jobs or {}) do
        -- Aislamos cada job: uno corrupto no debe romper la carga de los demás.
        local ok, err = pcall(function()
            local job = Bridge.NormalizeJob(raw) -- {x,y,z} -> vec3
            syncedJobs[job.name] = job -- guardado para "probar step" (aunque esté off)
            if raw.enabled ~= false then -- los jobs desactivados no crean nada
                buildJob(job)
            end
        end)
        if not ok then
            Bridge.Print('error', ('Error construyendo el job "%s": %s'):format(tostring(raw and raw.name), tostring(err)))
        end
    end
    Bridge.Print('info', ('Cargados %d job(s)'):format(#createdBlips))
end

-- ---------- Probar step desde el panel ----------
JobCreatorClient = JobCreatorClient or {}

function JobCreatorClient.TestStep(jobName, stepId)
    local job = syncedJobs[jobName]
    if not job then
        Bridge.Notify.Send({ title = 'Probar step', description = 'Guarda el job antes de probar', type = 'error' })
        return
    end
    local step
    for _, s in ipairs(job.steps or {}) do
        if s.id == stepId then step = s break end
    end
    if not step then
        Bridge.Notify.Send({ title = 'Probar step', description = 'Step no encontrado (guarda el job)', type = 'error' })
        return
    end

    -- Oculta el panel mientras se reproduce (reutiliza el modo "placement").
    SetNuiFocus(false, false)
    SendNUIMessage({ action = 'placementMode', on = true })

    CreateThread(function()
        playStepAnim(step.anim)
        local ok = doProgress(step.progress)
        stopAnim()

        SetNuiFocus(true, true)
        SendNUIMessage({ action = 'placementMode', on = false })

        if ok then
            TriggerServerEvent('job_creator:testStep', jobName, stepId)
        else
            Bridge.Notify.Send({ title = 'Probar step', description = 'Prueba cancelada', type = 'error' })
        end
    end)
end

-- ---------- Acciones permitidas (para otros scripts) ----------
-- Devuelve { handcuff = true, ... } según los jobs en los que estás EN SERVICIO.
function JobCreatorClient.GetActions()
    local out = {}
    for name, job in pairs(syncedJobs) do
        if job.actions and onDutyFor(name) then
            for key in pairs(job.actions) do out[key] = true end
        end
    end
    return out
end
exports('GetActions', function() return JobCreatorClient.GetActions() end)
exports('CanDoAction', function(key) return JobCreatorClient.GetActions()[key] == true end)

-- ---------- Arranque / eventos ----------
CreateThread(function()
    local tries = 0
    while not (Bridge.Target and Bridge.Target.AddBoxZone) and tries < 100 do
        Wait(50)
        tries = tries + 1
    end
    TriggerServerEvent('job_creator:clientReady')
end)

RegisterNetEvent('job_creator:syncJobs', function(jobs, settings)
    -- Aplicamos las settings de cliente ANTES de reconstruir, para que el
    -- modo de interacción (target/key/both) y el debug ya estén vigentes.
    if settings then
        if settings.Debug ~= nil then Config.Debug = settings.Debug end
        if settings.InteractMode then Config.InteractMode = settings.InteractMode end
        if settings.ShowMarkers ~= nil then Config.ShowMarkers = settings.ShowMarkers end
    end
    rebuild(jobs)
end)

-- El servidor autoriza la apertura del stash de servicio.
RegisterNetEvent('job_creator:doOpenStash', function(stashId)
    Bridge.Inventory.OpenStash(stashId)
end)

AddEventHandler('onResourceStop', function(res)
    if res ~= GetCurrentResourceName() then return end
    clearAll()
    if spawnedVehicle and DoesEntityExist(spawnedVehicle) then DeleteEntity(spawnedVehicle) end
end)

RegisterNetEvent('job_creator:notify', function(data)
    Bridge.Notify.Send(data)
end)
