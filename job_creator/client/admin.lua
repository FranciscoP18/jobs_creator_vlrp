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
local previewBlip = nil -- blip temporal para previsualizar en el mapa
local previewZone = nil -- { coords, size } de la zona que se está visualizando
local placing = false   -- modo de colocación de puntos activo

local function clearPreviewBlip()
    if previewBlip and DoesBlipExist(previewBlip) then RemoveBlip(previewBlip) end
    previewBlip = nil
end

-- Bucle de dibujado de la zona de preview (caja semitransparente).
CreateThread(function()
    while true do
        if previewZone then
            local c, s = previewZone.coords, previewZone.size
            DrawMarker(1, c.x, c.y, c.z - (s.z / 2.0),
                0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
                s.x, s.y, s.z, 91, 141, 255, 90,
                false, false, 2, false, nil, nil, false)
            Wait(0)
        else
            Wait(300)
        end
    end
end)

-- Abre la NUI con los datos que envía el servidor.
local function openPanel(payload)
    if isOpen then return end
    isOpen = true
    SetNuiFocus(true, true)
    SendNUIMessage({
        action = 'open',
        jobs = payload.jobs or {},
        settings = payload.settings or {},
        items = payload.items or {},
        stats = payload.stats or {},
    })
end

local function closePanel()
    if not isOpen then return end
    isOpen = false
    SetNuiFocus(false, false)
    -- Si quedó un uniforme de preview puesto, devolvemos la ropa civil.
    if Bridge.Clothing and Bridge.Clothing.IsWearingUniform() then
        Bridge.Clothing.RestoreCivilian()
    end
    clearPreviewBlip()
    previewZone = nil
    placing = false
    ClearPedTasks(PlayerPedId()) -- corta cualquier animación de preview
    SendNUIMessage({ action = 'close' })
end

-- El servidor autoriza y manda los datos.
RegisterNetEvent('job_creator:openPanel', function(payload)
    openPanel(payload)
end)

-- Estadísticas en vivo refrescadas a petición del panel.
RegisterNetEvent('job_creator:stats', function(stats)
    SendNUIMessage({ action = 'stats', stats = stats or {} })
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
    local ped = PlayerPedId()
    local c = GetEntityCoords(ped)
    local h = GetEntityHeading(ped)
    cb({
        x = math.floor(c.x * 100) / 100,
        y = math.floor(c.y * 100) / 100,
        z = math.floor(c.z * 100) / 100,
        h = math.floor(h * 100) / 100,
    })
end)

local function round2(n) return math.floor(n * 100) / 100 end

-- Dirección a la que mira la cámara (para el raycast de colocación).
local function rotToDir(rot)
    local z = math.rad(rot.z)
    local x = math.rad(rot.x)
    local num = math.abs(math.cos(x))
    return vec3(-math.sin(z) * num, math.cos(z) * num, math.sin(x))
end

-- ---------- Modo de colocación de puntos ----------
local function drawHelpText(text)
    SetTextFont(4)
    SetTextScale(0.45, 0.45)
    SetTextColour(255, 255, 255, 220)
    SetTextOutline()
    SetTextCentre(true)
    SetTextEntry('STRING')
    AddTextComponentString(text)
    DrawText(0.5, 0.86)
end

-- El panel pide entrar en modo colocación: ocultamos el panel y seguimos
-- con un marcador el punto al que apunta la cámara. Enter/clic confirma.
RegisterNUICallback('startPlacement', function(_, cb)
    cb({ ok = true })
    if placing then return end
    placing = true
    SetNuiFocus(false, false)
    SendNUIMessage({ action = 'placementMode', on = true })

    CreateThread(function()
        while placing do
            Wait(0)
            local ped = PlayerPedId()
            local cam = GetGameplayCamCoord()
            local dir = rotToDir(GetGameplayCamRot(2))
            local dest = vec3(cam.x + dir.x * 150.0, cam.y + dir.y * 150.0, cam.z + dir.z * 150.0)
            local ray = StartShapeTestRay(cam.x, cam.y, cam.z, dest.x, dest.y, dest.z, 1 + 16 + 256, ped, 0)
            local _, hit, endCoords = GetShapeTestResult(ray)
            local p = (hit == 1) and endCoords or GetEntityCoords(ped)

            DrawMarker(1, p.x, p.y, p.z - 0.95, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
                1.0, 1.0, 1.0, 91, 141, 255, 120, false, false, 2, false, nil, nil, false)
            drawHelpText('~b~Enter~w~ / ~b~Clic izq~w~: colocar      ~r~Retroceso~w~ / ~r~ESC~w~: cancelar')

            DisableControlAction(0, 24, true)  -- evita disparar al hacer clic
            DisableControlAction(0, 25, true)  -- evita apuntar

            if IsControlJustPressed(0, 191) or IsDisabledControlJustPressed(0, 24) then
                placing = false
                SetNuiFocus(true, true)
                SendNUIMessage({
                    action = 'placementResult',
                    x = round2(p.x), y = round2(p.y), z = round2(p.z),
                    h = round2(GetEntityHeading(ped)),
                })
            elseif IsControlJustPressed(0, 177) or IsControlJustPressed(0, 322) then
                placing = false
                SetNuiFocus(true, true)
                SendNUIMessage({ action = 'placementCancel' })
            end
        end
    end)
end)

-- Devuelve las coords del waypoint del mapa (si hay uno marcado).
-- El waypoint no trae Z fiable, así que intentamos el Z del suelo y, si no,
-- caemos a la Z actual del jugador.
RegisterNUICallback('getWaypoint', function(_, cb)
    local blip = GetFirstBlipInfoId(8) -- 8 = waypoint
    if not DoesBlipExist(blip) then
        cb({ ok = false })
        return
    end
    local coords = GetBlipInfoIdCoord(blip)
    local px, py = coords.x, coords.y
    local pz = GetEntityCoords(PlayerPedId()).z
    -- Intento de Z del suelo (solo funciona si la zona está cargada/cercana).
    local found, gz = GetGroundZFor_3dCoord(px + 0.0, py + 0.0, pz + 50.0, false)
    if found then pz = gz end
    cb({ ok = true, x = round2(px), y = round2(py), z = round2(pz) })
end)

-- Captura la ropa actual del ped (componentes y props) en el formato del editor.
RegisterNUICallback('getAppearance', function(_, cb)
    local ped = PlayerPedId()
    local components = {}
    for _, id in ipairs({ 1, 3, 4, 5, 6, 7, 8, 9, 10, 11 }) do
        components[#components + 1] = {
            component = id,
            drawable = GetPedDrawableVariation(ped, id),
            texture = GetPedTextureVariation(ped, id),
        }
    end
    local props = {}
    for _, id in ipairs({ 0, 1, 2, 6, 7 }) do
        local draw = GetPedPropIndex(ped, id)
        if draw and draw >= 0 then
            props[#props + 1] = {
                prop = id,
                drawable = draw,
                texture = GetPedPropTextureIndex(ped, id),
            }
        end
    end
    cb({ components = components, props = props })
end)

-- Teletransporta el ped a una coordenada (para "ir a la zona" desde el panel).
RegisterNUICallback('teleport', function(data, cb)
    if data and data.x and data.y and data.z then
        local ped = PlayerPedId()
        SetEntityCoords(ped, data.x + 0.0, data.y + 0.0, data.z + 0.0, false, false, false, true)
    end
    cb({ ok = true })
end)

-- Prueba un uniforme sobre el ped sin guardar. Guarda la ropa civil la
-- primera vez para poder restaurarla después.
RegisterNUICallback('previewOutfit', function(data, cb)
    if data then
        if not Bridge.Clothing.IsWearingUniform() then
            Bridge.Clothing.SaveCivilian()
        end
        Bridge.Clothing.ApplyOutfit(data)
    end
    cb({ ok = true })
end)

-- Restaura la ropa civil guardada (deshace cualquier preview de uniforme).
RegisterNUICallback('restoreAppearance', function(_, cb)
    Bridge.Clothing.RestoreCivilian()
    cb({ ok = true })
end)

-- Crea/actualiza un blip temporal en el mapa para previsualizarlo.
RegisterNUICallback('previewBlip', function(data, cb)
    clearPreviewBlip()
    if data and data.x and data.y and data.z then
        previewBlip = AddBlipForCoord(data.x + 0.0, data.y + 0.0, data.z + 0.0)
        SetBlipSprite(previewBlip, math.floor(tonumber(data.sprite) or 1))
        SetBlipColour(previewBlip, math.floor(tonumber(data.color) or 0))
        SetBlipScale(previewBlip, (tonumber(data.scale) or 0.8) + 0.0)
        SetBlipAsShortRange(previewBlip, true)
        BeginTextCommandSetBlipName('STRING')
        AddTextComponentSubstringPlayerName(tostring(data.label or 'Preview'))
        EndTextCommandSetBlipName(previewBlip)
        SetNewWaypoint(data.x + 0.0, data.y + 0.0) -- centra el mapa en el blip
    end
    cb({ ok = true })
end)

-- Quita el blip de preview.
RegisterNUICallback('clearBlip', function(_, cb)
    clearPreviewBlip()
    cb({ ok = true })
end)

-- Visualiza una zona (caja) en el mundo y teletransporta cerca para verla.
RegisterNUICallback('previewZone', function(data, cb)
    if data and data.x and data.y and data.z then
        previewZone = {
            coords = vec3(data.x + 0.0, data.y + 0.0, data.z + 0.0),
            size = vec3((tonumber(data.sx) or 1.6) + 0.0, (tonumber(data.sy) or 1.6) + 0.0, (tonumber(data.sz) or 2.0) + 0.0),
        }
    end
    cb({ ok = true })
end)

-- Quita la zona de preview.
RegisterNUICallback('clearZone', function(_, cb)
    previewZone = nil
    cb({ ok = true })
end)

-- Previsualiza una animación en el ped (loop hasta detenerla).
RegisterNUICallback('previewAnim', function(data, cb)
    if data and data.dict and data.clip and data.dict ~= '' and data.clip ~= '' then
        local ped = PlayerPedId()
        RequestAnimDict(data.dict)
        local tries = 0
        while not HasAnimDictLoaded(data.dict) and tries < 100 do
            Wait(10); tries = tries + 1
        end
        if HasAnimDictLoaded(data.dict) then
            TaskPlayAnim(ped, data.dict, data.clip, 8.0, -8.0, -1, 1, 0, false, false, false)
            cb({ ok = true })
            return
        end
    end
    cb({ ok = false })
end)

-- Detiene la animación de preview.
RegisterNUICallback('stopAnim', function(_, cb)
    ClearPedTasks(PlayerPedId())
    cb({ ok = true })
end)

-- El panel pide refrescar las estadísticas en vivo.
RegisterNUICallback('requestStats', function(_, cb)
    TriggerServerEvent('job_creator:requestStats')
    cb({ ok = true })
end)

-- El panel pide importar los grados del job de framework.
RegisterNUICallback('importGrades', function(data, cb)
    cb({ ok = true })
    if data and data.jobName then TriggerServerEvent('job_creator:getJobGrades', data.jobName) end
end)

RegisterNetEvent('job_creator:jobGrades', function(jobName, grades)
    SendNUIMessage({ action = 'jobGrades', jobName = jobName, grades = grades or {} })
end)

-- El panel pide probar un step (simulación con recompensa real).
RegisterNUICallback('testStep', function(data, cb)
    cb({ ok = true })
    if data and data.jobName and data.stepId and JobCreatorClient and JobCreatorClient.TestStep then
        JobCreatorClient.TestStep(data.jobName, data.stepId)
    end
end)

-- Cierra la NUI si el recurso se detiene mientras está abierta.
AddEventHandler('onResourceStop', function(res)
    if res == GetCurrentResourceName() and isOpen then
        SetNuiFocus(false, false)
    end
end)
