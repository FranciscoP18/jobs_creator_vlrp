-- ============================================================
-- client/jobs.lua
-- Motor que interpreta las definiciones de job y construye
-- blips + zonas de target. Al interactuar, valida con el servidor.
--
-- IMPORTANTE: las definiciones vigentes llegan SINCRONIZADAS desde el
-- servidor (fuente de verdad = DB), no de la copia local de Config.Jobs.
-- Así, cuando un admin edita un job en el panel, el servidor reenvía la
-- lista y reconstruimos las zonas en caliente, sin reiniciar el recurso.
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
    -- Usamos el global `lib` directamente: comprobar IsStarted('ox_lib') no
    -- garantiza que la librería esté cargada (hace falta @ox_lib/init.lua).
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
    for _, step in ipairs(job.steps or {}) do
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

-- Limpia blips y zonas existentes (antes de reconstruir o al detener)
local function clearAll()
    for _, id in ipairs(createdZones) do
        if id then Bridge.Target.RemoveZone(id) end
    end
    for _, blip in ipairs(createdBlips) do
        RemoveBlip(blip)
    end
    createdZones = {}
    createdBlips = {}
end

-- Reconstruye TODO a partir de la lista sincronizada (coords como {x,y,z}).
local function rebuild(jobs)
    clearAll()
    for _, raw in ipairs(jobs or {}) do
        local job = Bridge.NormalizeJob(raw) -- {x,y,z} -> vec3
        buildJob(job)
    end
    Bridge.Print('info', ('Cargados %d job(s)'):format(#createdBlips))
end

-- Al arrancar: espera el bridge de target y pide la sincronización al servidor.
CreateThread(function()
    local tries = 0
    while not (Bridge.Target and Bridge.Target.AddBoxZone) and tries < 100 do
        Wait(50)
        tries = tries + 1
    end
    TriggerServerEvent('job_creator:clientReady')
end)

-- El servidor envía/actualiza la lista de jobs (al cargar y tras cada edición).
RegisterNetEvent('job_creator:syncJobs', function(jobs)
    rebuild(jobs)
end)

-- Limpieza al detener el recurso (evita zonas huérfanas)
AddEventHandler('onResourceStop', function(res)
    if res ~= GetCurrentResourceName() then return end
    clearAll()
end)

-- Recibe notificaciones enviadas desde el servidor
RegisterNetEvent('job_creator:notify', function(data)
    Bridge.Notify.Send(data)
end)
