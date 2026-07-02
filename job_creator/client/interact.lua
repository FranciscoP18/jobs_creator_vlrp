-- ============================================================
-- client/interact.lua  (CLIENTE)
-- Capa de interacción con DOS backends, elegida por Config.InteractMode:
--   'target' -> sistema de target (ox_target/qb-target) vía Bridge.Target
--   'key'    -> acercarse + pulsar E (marker + texto flotante)
--   'both'   -> ambos a la vez
--
-- El motor (client/jobs.lua) ya no llama a Bridge.Target directamente:
-- usa Interaction.AddPoint / Interaction.ClearAll y este módulo decide.
--
-- Una "option" tiene la misma forma que en el target:
--   { label, icon, distance, onSelect = fn, canInteract = fn? }
--
-- Soporte opcional de "mantener tecla" (solo modo tecla + vlrp-textui):
--   hold           = ms          -> activa el hold (barra de progreso) en vez de un toque
--   holdLabel      = string      -> texto mientras se mantiene (por defecto: label)
--   holdType       = 'info'|...  -> color del prompt durante el hold
--   onHoldStart/onHoldEnd = fn   -> p.ej. iniciar/parar animación
--   onHoldComplete = fn          -> acción al completar (si falta, usa onSelect)
--   onHoldCancel   = fn          -> al cancelar/alejarse
-- ============================================================

Interaction = {}

local E_KEY = 38            -- INPUT_PICKUP (tecla E)
local targetIds = {}        -- ids de zonas de target creadas
local keyPoints = {}        -- puntos para el modo tecla
local markerPoints = {}     -- coords de TODOS los puntos (para marcadores visibles)

-- Proveedor de "text UI" para el modo tecla: vlrp-textui > cd_drawtextui > ox_lib > 3D text.
local textProvider = Bridge.Pick('textui', { 'vlrp-textui', 'cd_drawtextui', 'ox_lib' })
local hasTextUI = textProvider == 'vlrp-textui'
    or textProvider == 'cd_drawtextui'
    or (textProvider == 'ox_lib' and lib and lib.showTextUI)

-- Si el proveedor es vlrp-textui, dibujamos el prompt ANCLADO al objeto (3D)
-- en lugar de la caja fija de pantalla. (Solo vlrp-textui expone MostrarMundo.)
local use3D = textProvider == 'vlrp-textui'

local function mode()
    return Config.InteractMode or 'target'
end

-- Primera opción interactuable (respeta canInteract, igual que el target).
local function firstInteractable(options)
    for _, opt in ipairs(options) do
        if not opt.canInteract or opt.canInteract() then return opt end
    end
    return nil
end

-- ---------- API pública ----------
function Interaction.AddPoint(data)
    local m = mode()

    -- Guardamos las coords de todo punto para poder dibujar marcadores visibles.
    if data.coords then markerPoints[#markerPoints + 1] = data.coords end

    if m == 'target' or m == 'both' then
        local id = Bridge.Target.AddBoxZone({
            coords = data.coords,
            size = data.size,
            debug = Config.Debug,
            options = data.options,
        })
        targetIds[#targetIds + 1] = id
    end

    if m == 'key' or m == 'both' then
        local radius = (data.options[1] and data.options[1].distance) or 2.0
        keyPoints[#keyPoints + 1] = {
            coords = data.coords,
            radius = radius,
            options = data.options,
        }
    end
end

-- ---------- Texto flotante ----------
local shownLabel = nil

local function showTextUI(label, icon)
    if shownLabel == label then return end
    shownLabel = label
    local msg = '[E] ' .. label
    if textProvider == 'vlrp-textui' then
        -- API propia: Mostrar(mensaje, { tecla, tipo, icono })
        exports['vlrp-textui']:Mostrar(label, { tecla = 'E', tipo = 'info', icono = icon })
    elseif textProvider == 'cd_drawtextui' then
        TriggerEvent('cd_drawtextui:ShowUI', 'show', msg)
    elseif lib and lib.showTextUI then
        lib.showTextUI(msg)
    end
end

local function hideTextUI()
    if shownLabel == nil then return end
    shownLabel = nil
    if textProvider == 'vlrp-textui' then
        exports['vlrp-textui']:Ocultar()
    elseif textProvider == 'cd_drawtextui' then
        TriggerEvent('cd_drawtextui:HideUI')
    elseif lib and lib.hideTextUI then
        lib.hideTextUI()
    end
end

-- Oculta cualquier prompt (3D anclado y/o caja de pantalla).
local function hidePrompt()
    if use3D then exports['vlrp-textui']:OcultarMundo() end
    hideTextUI()
end

-- ¿El proveedor de text UI soporta "mantener tecla" (barra de progreso)?
-- Solo vlrp-textui expone Mantener/CancelarHold.
local canHold = textProvider == 'vlrp-textui'

-- Ejecuta una interacción de "mantener tecla" para una opción con opt.hold (ms).
-- Reaprovecha el progreso del step como duración del hold. Cancela si el jugador
-- se aleja (watchdog) y solo dispara la acción si el hold se completa.
local function runHold(opt, coords, radius)
    hidePrompt() -- Mantener pinta su propio prompt con barra (ocultamos el 3D/pantalla)
    if opt.onHoldStart then opt.onHoldStart() end

    -- Watchdog: si el jugador sale de la zona durante el hold, lo cancelamos.
    local active = true
    CreateThread(function()
        while active do
            Wait(0)
            if #(GetEntityCoords(PlayerPedId()) - coords) > (radius + 1.5) then
                exports['vlrp-textui']:CancelarHold()
                break
            end
        end
    end)

    local ok = exports['vlrp-textui']:Mantener({
        tecla    = 'E',
        control  = E_KEY,
        label    = opt.holdLabel or opt.label,
        duracion = opt.hold,
        tipo     = opt.holdType or 'info',
        icono    = opt.icon,
    })
    active = false

    if opt.onHoldEnd then opt.onHoldEnd() end
    if ok then
        if opt.onHoldComplete then opt.onHoldComplete() else opt.onSelect() end
    elseif opt.onHoldCancel then
        opt.onHoldCancel()
    end
end

-- Fallback de texto 3D cuando no hay ox_lib (se dibuja cada frame).
local function draw3DText(coords, text)
    SetDrawOrigin(coords.x, coords.y, coords.z, 0)
    SetTextScale(0.35, 0.35)
    SetTextFont(4)
    SetTextProportional(true)
    SetTextCentre(true)
    SetTextColour(255, 255, 255, 215)
    SetTextOutline()
    BeginTextCommandDisplayText('STRING')
    AddTextComponentSubstringPlayerName(text)
    EndTextCommandDisplayText(0.0, 0.0)
    ClearDrawOrigin()
end

function Interaction.ClearAll()
    for _, id in ipairs(targetIds) do
        if id then Bridge.Target.RemoveZone(id) end
    end
    targetIds = {}
    keyPoints = {}
    markerPoints = {}
    hidePrompt()
end

-- Marcadores visibles en los puntos interactuables (ayuda a encontrarlos,
-- sobre todo en modo target). Se activa con Config.ShowMarkers.
CreateThread(function()
    while true do
        local sleep = 1000
        if Config.ShowMarkers and #markerPoints > 0 then
            local pcoords = GetEntityCoords(PlayerPedId())
            for _, c in ipairs(markerPoints) do
                if #(pcoords - c) <= 20.0 then
                    sleep = 0
                    DrawMarker(2, c.x, c.y, c.z + 0.6, 0.0, 0.0, 0.0, 0.0, 180.0, 0.0,
                        0.22, 0.22, 0.22, 91, 141, 255, 150, true, true, 2, false, nil, nil, false)
                end
            end
        end
        Wait(sleep)
    end
end)

-- ---------- Bucle del modo tecla ----------
CreateThread(function()
    while true do
        local sleep = 500
        local m = mode()

        if (m == 'key' or m == 'both') and #keyPoints > 0 then
            local ped = PlayerPedId()
            local pcoords = GetEntityCoords(ped)
            local nearestOpt, nearestDist, nearestCoords, nearestRadius

            for _, p in ipairs(keyPoints) do
                local dist = #(pcoords - p.coords)
                if dist <= (p.radius + 1.0) then
                    sleep = 0
                    -- Marcador visible al acercarse
                    DrawMarker(2, p.coords.x, p.coords.y, p.coords.z - 0.9,
                        0.0, 0.0, 0.0, 0.0, 180.0, 0.0,
                        0.25, 0.25, 0.25, 30, 144, 255, 180,
                        false, true, 2, false, nil, nil, false)

                    if dist <= p.radius then
                        local opt = firstInteractable(p.options)
                        if opt and (not nearestDist or dist < nearestDist) then
                            nearestOpt, nearestDist, nearestCoords, nearestRadius = opt, dist, p.coords, p.radius
                        end
                    end
                end
            end

            if nearestOpt then
                -- ¿Esta opción se interactúa manteniendo la tecla? (y el proveedor lo soporta)
                local useHold = nearestOpt.hold and canHold
                if use3D then
                    -- Prompt anclado al objeto (se actualiza cada frame).
                    exports['vlrp-textui']:MostrarMundo(nearestCoords, {
                        tecla = 'E', label = nearestOpt.label, icono = nearestOpt.icon, tipo = 'info',
                    })
                elseif hasTextUI then
                    showTextUI(nearestOpt.label, nearestOpt.icon)
                else
                    draw3DText(nearestCoords, '[E] ' .. nearestOpt.label)
                end
                if IsControlJustPressed(0, E_KEY) then
                    if useHold then
                        runHold(nearestOpt, nearestCoords, nearestRadius)
                    else
                        nearestOpt.onSelect()
                    end
                end
            else
                hidePrompt()
            end
        else
            hidePrompt()
        end

        Wait(sleep)
    end
end)
