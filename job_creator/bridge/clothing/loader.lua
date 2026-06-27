-- ============================================================
-- bridge/clothing/loader.lua  (CLIENTE)
-- API uniforme de ropa/vestuario de trabajo.
--
--   Bridge.Clothing.ApplyOutfit(outfit)  -> aplica componentes/props
--   Bridge.Clothing.SaveCivilian()       -> guarda la apariencia civil actual
--   Bridge.Clothing.RestoreCivilian()    -> restaura la apariencia guardada
--
-- Estrategia (robusta y agnóstica):
--   * Los UNIFORMES se aplican con natives (SetPedComponentVariation /
--     SetPedPropIndex). No dependen de ningún recurso de ropa.
--   * Para volver a la ROPA CIVIL guardamos/restauramos la apariencia
--     completa vía illenium-appearance si está; si no, con natives.
--
-- outfit = {
--   components = { [11] = { drawable = 0, texture = 0 }, [4] = {...}, ... },
--   props      = { [0]  = { drawable = 0, texture = 0 }, ... },   -- opcional
-- }
-- componentId: 1 mascara, 3 torso/brazos, 4 piernas, 5 mochila, 6 zapatos,
--              7 accesorios, 8 camiseta, 9 chaleco, 10 dorsales, 11 torso.
-- propId: 0 sombrero, 1 gafas, 2 orejas, 6 reloj, 7 pulsera.
-- ============================================================

Bridge.Clothing = {}

local appearanceResource = Bridge.Resolve({
    'illenium-appearance', 'fivem-appearance', 'qb-clothing', 'esx_skin',
})

-- Cache de la apariencia civil del jugador (antes de ponerse el uniforme).
local savedCivilian = nil

-- ---------- Aplicar uniforme (natives, universal) ----------
function Bridge.Clothing.ApplyOutfit(outfit)
    if not outfit then return end
    local ped = PlayerPedId()

    if outfit.components then
        for componentId, c in pairs(outfit.components) do
            SetPedComponentVariation(ped, tonumber(componentId), c.drawable or 0, c.texture or 0, 0)
        end
    end

    if outfit.props then
        for propId, p in pairs(outfit.props) do
            if (p.drawable or -1) < 0 then
                ClearPedProp(ped, tonumber(propId))
            else
                SetPedPropIndex(ped, tonumber(propId), p.drawable or 0, p.texture or 0, true)
            end
        end
    end
end

-- ---------- Guardar / restaurar ropa civil ----------
function Bridge.Clothing.SaveCivilian()
    local ped = PlayerPedId()
    if appearanceResource == 'illenium-appearance' or appearanceResource == 'fivem-appearance' then
        local ok, appearance = pcall(function()
            return exports[appearanceResource]:getPedAppearance(ped)
        end)
        if ok and appearance then
            savedCivilian = appearance
            return
        end
    end
    -- Fallback con natives: guardamos los componentes/props actuales.
    savedCivilian = { _native = true, components = {}, props = {} }
    for _, id in ipairs({ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 }) do
        savedCivilian.components[id] = {
            drawable = GetPedDrawableVariation(ped, id),
            texture = GetPedTextureVariation(ped, id),
        }
    end
    for _, id in ipairs({ 0, 1, 2, 6, 7 }) do
        savedCivilian.props[id] = {
            drawable = GetPedPropIndex(ped, id),
            texture = GetPedPropTextureIndex(ped, id),
        }
    end
end

function Bridge.Clothing.RestoreCivilian()
    if not savedCivilian then return end
    local ped = PlayerPedId()

    if not savedCivilian._native
        and (appearanceResource == 'illenium-appearance' or appearanceResource == 'fivem-appearance') then
        pcall(function()
            exports[appearanceResource]:setPlayerAppearance(savedCivilian)
        end)
        savedCivilian = nil
        return
    end

    -- Restauración con natives
    Bridge.Clothing.ApplyOutfit(savedCivilian)
    savedCivilian = nil
end

-- ¿Hay un uniforme puesto ahora mismo? (hay ropa civil guardada)
function Bridge.Clothing.IsWearingUniform()
    return savedCivilian ~= nil
end

CreateThread(function()
    Bridge.Print('info', 'Clothing provider: ' .. (appearanceResource or 'natives (sin recurso de ropa)'))
end)
