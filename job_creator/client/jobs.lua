-- ============================================================
-- client/jobs.lua
-- Motor que interpreta las definiciones de Config.Jobs y construye
-- blips + zonas de target. Al interactuar, valida con el servidor.
-- ============================================================

local createdZones = {}  -- ids de zonas para poder limpiarlas
local createdBlips = {}

-- Crea el blip de un job
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

-- Reproduce animación de un step (si la define) durante el progreso
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

-- Barra de progreso usando ox_lib si está; si no, fallback simple con Wait.
local function doProgress(progress)
    if not progress then return true end
    if Bridge.IsStarted('ox_lib') then
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

-- Maneja la interacción de un step concreto
local function onStepInteract(jobName, step)
    playStepAnim(step.anim)
    local completed = doProgress(step.progress)
    stopAnim()

    if not completed then
        Bridge.Notify.Send({ title = 'Cancelado', description = 'Has cancelado la acción', type = 'error' })
        return
    end

    -- Toda la validación de items/recompensa ocurre en el SERVIDOR.
    -- El cliente solo solicita; nunca otorga nada por sí mismo.
    TriggerServerEvent('job_creator:completeStep', jobName, step.id)
end

-- Construye las zonas de target de un job
local function buildJob(job)
    createBlip(job)
    for _, step in ipairs(job.steps) do
        local t = step.target
        if t then
            local id = Bridge.Target.AddBoxZone({
                coords = t.coords,
                size = t.size,
                debug = Config.Debug,
                options = {
                    {
                        label = t.label or step.label,
                        icon = t.icon,
                        distance = 2.5,
                        onSelect = function()
                            onStepInteract(job.name, step)
                        end,
                    },
                },
            })
            createdZones[#createdZones + 1] = id
        end
    end
end

-- Inicializa todos los jobs al arrancar el recurso
CreateThread(function()
    -- Pequeña espera para asegurar que los bridges resolvieron sus providers
    Wait(500)
    for _, job in pairs(Config.Jobs) do
        buildJob(job)
    end
    Bridge.Print('info', ('Cargados %d job(s)'):format(#createdBlips))
end)

-- Limpieza al detener el recurso (evita zonas huérfanas)
AddEventHandler('onResourceStop', function(res)
    if res ~= GetCurrentResourceName() then return end
    for _, id in ipairs(createdZones) do
        if id then Bridge.Target.RemoveZone(id) end
    end
    for _, blip in ipairs(createdBlips) do
        RemoveBlip(blip)
    end
end)

-- Recibe notificaciones enviadas desde el servidor
RegisterNetEvent('job_creator:notify', function(data)
    Bridge.Notify.Send(data)
end)
