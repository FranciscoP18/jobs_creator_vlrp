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
-- ============================================================

Interaction = {}

local E_KEY = 38            -- INPUT_PICKUP (tecla E)
local targetIds = {}        -- ids de zonas de target creadas
local keyPoints = {}        -- puntos para el modo tecla

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

local function showTextUI(label)
    if lib and lib.showTextUI then
        if shownLabel == label then return end
        shownLabel = label
        lib.showTextUI('[E] ' .. label)
    end
end

local function hideTextUI()
    if shownLabel ~= nil then
        if lib and lib.hideTextUI then lib.hideTextUI() end
        shownLabel = nil
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
    hideTextUI()
end

-- ---------- Bucle del modo tecla ----------
CreateThread(function()
    while true do
        local sleep = 500
        local m = mode()

        if (m == 'key' or m == 'both') and #keyPoints > 0 then
            local ped = PlayerPedId()
            local pcoords = GetEntityCoords(ped)
            local nearestOpt, nearestDist, nearestCoords

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
                            nearestOpt, nearestDist, nearestCoords = opt, dist, p.coords
                        end
                    end
                end
            end

            if nearestOpt then
                if lib and lib.showTextUI then
                    showTextUI(nearestOpt.label)
                else
                    draw3DText(nearestCoords, '[E] ' .. nearestOpt.label)
                end
                if IsControlJustPressed(0, E_KEY) then
                    nearestOpt.onSelect()
                end
            else
                hideTextUI()
            end
        else
            hideTextUI()
        end

        Wait(sleep)
    end
end)
