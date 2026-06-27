-- ============================================================
-- bridge/shared.lua
-- Tabla global compartida + utilidades de detección.
-- Se carga en cliente y servidor antes que cualquier módulo.
-- ============================================================

Bridge = Bridge or {}

-- Devuelve true si un recurso está iniciado ('started')
function Bridge.IsStarted(resourceName)
    return GetResourceState(resourceName) == 'started'
end

-- Devuelve el primer recurso iniciado de una lista de candidatos.
-- Útil para "usa ox_target, si no qb-target, si no qtarget".
function Bridge.Resolve(candidates)
    for _, name in ipairs(candidates) do
        if Bridge.IsStarted(name) then
            return name
        end
    end
    return nil
end

-- Log con prefijo y color (^1 rojo, ^2 verde, ^3 amarillo, ^0 reset)
function Bridge.Print(level, msg)
    local colors = { info = '^2', warn = '^3', error = '^1' }
    local color = colors[level] or '^7'
    print(('%s[job_creator]^0 %s'):format(color, msg))
end

-- Espera (bloqueante con timeout) a que un recurso esté 'started'.
-- Útil cuando este recurso arranca antes que un provider (target/inventory).
function Bridge.WaitForResource(resourceName, timeout)
    timeout = timeout or 5000
    local elapsed = 0
    while not Bridge.IsStarted(resourceName) and elapsed < timeout do
        Wait(100)
        elapsed = elapsed + 100
    end
    return Bridge.IsStarted(resourceName)
end

-- ============================================================
-- Serialización de definiciones de job
-- La DB y la NUI hablan JSON, que no conoce el tipo vector3.
-- Por eso convertimos coords entre vec3 (runtime) y {x,y,z} (JSON/DB).
-- Solo tocamos los campos de coords conocidos: nada de magia genérica.
-- ============================================================

-- Copia profunda de tablas simples (sin metatablas).
function Bridge.DeepCopy(value)
    if type(value) ~= 'table' then return value end
    local out = {}
    for k, v in pairs(value) do
        out[k] = Bridge.DeepCopy(v)
    end
    return out
end

-- {x,y,z} (o vector3) -> vector3. Devuelve el valor tal cual si no aplica.
function Bridge.ToVec3(t)
    if type(t) == 'vector3' then return t end
    if type(t) == 'table' and t.x and t.y and t.z then
        return vec3(t.x + 0.0, t.y + 0.0, t.z + 0.0)
    end
    return t
end

-- vector3 -> {x,y,z}. Devuelve el valor tal cual si no aplica.
function Bridge.FromVec3(v)
    if type(v) == 'vector3' then
        return { x = v.x, y = v.y, z = v.z }
    end
    return v
end

-- Recorre los campos de coords conocidos de un job aplicando `fn`.
-- Trabaja sobre una COPIA para no mutar la definición original.
local function transformJobCoords(job, fn)
    local out = Bridge.DeepCopy(job)

    if out.blip and out.blip.coords then
        out.blip.coords = fn(out.blip.coords)
    end

    -- Stations (jobs de servicio): cada una tiene coords y opcionalmente size.
    for _, key in ipairs({ 'duty', 'stash', 'wardrobe' }) do
        local station = out[key]
        if type(station) == 'table' then
            if station.coords then station.coords = fn(station.coords) end
            if station.size then station.size = fn(station.size) end
        end
    end

    -- Steps (jobs de economía)
    if out.steps then
        for _, step in ipairs(out.steps) do
            if step.target then
                if step.target.coords then step.target.coords = fn(step.target.coords) end
                if step.target.size then step.target.size = fn(step.target.size) end
            end
        end
    end

    return out
end

-- Para runtime: convierte coords de {x,y,z} a vec3. Devuelve copia normalizada.
function Bridge.NormalizeJob(job)
    return transformJobCoords(job, Bridge.ToVec3)
end

-- Para DB/NUI: convierte coords de vec3 a {x,y,z}. Devuelve copia serializable.
function Bridge.SerializeJob(job)
    return transformJobCoords(job, Bridge.FromVec3)
end
