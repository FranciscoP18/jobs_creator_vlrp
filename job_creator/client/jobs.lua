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
end

local function buildSteps(job)
    for _, step in ipairs(job.steps or {}) do
        local t = step.target
        if t then
            addZone(t.coords, t.size, {
                {
                    label = t.label or step.label,
                    icon = t.icon,
                    distance = 2.5,
                    onSelect = function() onStepInteract(job.name, step) end,
                },
            })
        end
    end
end

-- Construye todo lo de un job
local function buildJob(job)
    createBlip(job)
    if job.duty then buildDuty(job) end
    if job.stash then buildStash(job) end
    if job.wardrobe then buildWardrobe(job) end
    buildSteps(job)
end

-- ---------- Limpieza / reconstrucción ----------
local function clearAll()
    Interaction.ClearAll()
    for _, blip in ipairs(createdBlips) do
        RemoveBlip(blip)
    end
    createdBlips = {}
end

local function rebuild(jobs)
    clearAll()
    for _, raw in ipairs(jobs or {}) do
        local job = Bridge.NormalizeJob(raw) -- {x,y,z} -> vec3
        buildJob(job)
    end
    Bridge.Print('info', ('Cargados %d job(s)'):format(#createdBlips))
end

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
end)

RegisterNetEvent('job_creator:notify', function(data)
    Bridge.Notify.Send(data)
end)
