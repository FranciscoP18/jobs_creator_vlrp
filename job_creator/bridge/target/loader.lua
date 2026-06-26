-- ============================================================
-- bridge/target/loader.lua  (CLIENTE)
-- API uniforme de targeting. Tu código llama Bridge.Target.*
-- y aquí decidimos qué recurso real usar.
--
-- API expuesta:
--   Bridge.Target.AddBoxZone(data) -> id
--   Bridge.Target.AddEntityZone(entity, data) -> id   (para NPCs/props)
--   Bridge.Target.RemoveZone(id)
--
-- data = {
--   coords = vec3, size = vec3, rotation = number,
--   options = { { label, icon, onSelect = fn, canInteract = fn, distance } }
-- }
-- ============================================================

Bridge.Target = {}

local provider = Bridge.Resolve({ 'ox_target', 'qb-target', 'qtarget' })

-- ---------- Adaptador ox_target ----------
local function ox_AddBoxZone(data)
    return exports.ox_target:addBoxZone({
        coords = data.coords,
        size = data.size or vec3(2.0, 2.0, 2.0),
        rotation = data.rotation or 0.0,
        debug = data.debug or false,
        options = data.options, -- ox usa label/icon/onSelect/canInteract/distance directamente
    })
end

local function ox_AddEntityZone(entity, data)
    return exports.ox_target:addLocalEntity(entity, data.options)
end

local function ox_RemoveZone(id)
    exports.ox_target:removeZone(id)
end

-- ---------- Adaptador qb-target ----------
-- qb-target usa una forma distinta: action en vez de onSelect, y registra por name.
local qbZoneCounter = 0

local function qb_MapOptions(options)
    local mapped = {}
    for _, opt in ipairs(options) do
        mapped[#mapped + 1] = {
            label = opt.label,
            icon = opt.icon,
            action = opt.onSelect,          -- traducción de nombre
            canInteract = opt.canInteract,
            distance = opt.distance or 2.5,
        }
    end
    return mapped
end

local function qb_AddBoxZone(data)
    qbZoneCounter = qbZoneCounter + 1
    local name = ('jc_zone_%d'):format(qbZoneCounter)
    local size = data.size or vec3(2.0, 2.0, 2.0)
    exports['qb-target']:AddBoxZone(name, data.coords, size.x, size.y, {
        name = name,
        heading = data.rotation or 0.0,
        minZ = data.coords.z - (size.z / 2),
        maxZ = data.coords.z + (size.z / 2),
        debugPoly = data.debug or false,
    }, {
        options = qb_MapOptions(data.options),
        distance = 2.5,
    })
    return name
end

local function qb_AddEntityZone(entity, data)
    exports['qb-target']:AddTargetEntity(entity, {
        options = qb_MapOptions(data.options),
        distance = 2.5,
    })
    return entity
end

local function qb_RemoveZone(id)
    exports['qb-target']:RemoveZone(id)
end

-- ---------- Asignación según provider ----------
if provider == 'ox_target' then
    Bridge.Target.AddBoxZone    = ox_AddBoxZone
    Bridge.Target.AddEntityZone = ox_AddEntityZone
    Bridge.Target.RemoveZone    = ox_RemoveZone
    Bridge.Print('info', 'Target provider: ox_target')

elseif provider == 'qb-target' or provider == 'qtarget' then
    Bridge.Target.AddBoxZone    = qb_AddBoxZone
    Bridge.Target.AddEntityZone = qb_AddEntityZone
    Bridge.Target.RemoveZone    = qb_RemoveZone
    Bridge.Print('info', 'Target provider: ' .. provider)

else
    -- Fallback: sin target, usamos un stub que avisa una sola vez.
    local warned = false
    local function noop() if not warned then Bridge.Print('warn', 'Sin sistema de target instalado') warned = true end end
    Bridge.Target.AddBoxZone    = function() noop() return nil end
    Bridge.Target.AddEntityZone = function() noop() return nil end
    Bridge.Target.RemoveZone    = noop
end
