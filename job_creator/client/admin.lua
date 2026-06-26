-- ============================================================
-- client/admin.lua  (CLIENTE)
-- Puente entre el panel NUI y el servidor.
--
-- Apertura segura: el cliente NO decide si puede abrir. Pide permiso al
-- servidor ('job_creator:requestPanel'); el servidor valida ACE y, si
-- procede, responde con 'job_creator:openPanel' + los datos actuales.
--
-- Comando:  /jobcreator      (alias /jccfg)
-- Keybind:  configurable por el jugador en Ajustes > Teclas (sin tecla por defecto)
-- ============================================================

local isOpen = false

-- Abre la NUI con los datos que envía el servidor.
local function openPanel(payload)
    if isOpen then return end
    isOpen = true
    SetNuiFocus(true, true)
    SendNUIMessage({
        action = 'open',
        jobs = payload.jobs or {},
        settings = payload.settings or {},
    })
end

local function closePanel()
    if not isOpen then return end
    isOpen = false
    SetNuiFocus(false, false)
    SendNUIMessage({ action = 'close' })
end

-- El servidor autoriza y manda los datos.
RegisterNetEvent('job_creator:openPanel', function(payload)
    openPanel(payload)
end)

-- ---------- Comando / keybind ----------
RegisterCommand('jobcreator', function()
    -- Pedimos permiso al servidor; él valida ACE y responde si procede.
    TriggerServerEvent('job_creator:requestPanel')
end, false)
RegisterKeyMapping('jobcreator', 'Abrir panel Job Creator', 'keyboard', '')

-- Alias corto
RegisterCommand('jccfg', function()
    TriggerServerEvent('job_creator:requestPanel')
end, false)

-- ---------- Callbacks NUI ----------
RegisterNUICallback('close', function(_, cb)
    closePanel()
    cb({ ok = true })
end)

RegisterNUICallback('saveJob', function(data, cb)
    -- `data` ya viene serializado (coords como {x,y,z}) desde el JS.
    TriggerServerEvent('job_creator:saveJob', data)
    cb({ ok = true })
end)

RegisterNUICallback('deleteJob', function(data, cb)
    TriggerServerEvent('job_creator:deleteJob', data and data.name)
    cb({ ok = true })
end)

RegisterNUICallback('saveSettings', function(data, cb)
    TriggerServerEvent('job_creator:saveSettings', data)
    cb({ ok = true })
end)

-- Devuelve al JS la posición actual del jugador para auto-rellenar coords.
RegisterNUICallback('getCoords', function(_, cb)
    local c = GetEntityCoords(PlayerPedId())
    cb({ x = math.floor(c.x * 100) / 100, y = math.floor(c.y * 100) / 100, z = math.floor(c.z * 100) / 100 })
end)

-- Cierra la NUI si el recurso se detiene mientras está abierta.
AddEventHandler('onResourceStop', function(res)
    if res == GetCurrentResourceName() and isOpen then
        SetNuiFocus(false, false)
    end
end)
