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

-- Espera (bloqueante con timeout) a que un export exista. Evita race conditions
-- cuando un recurso aún no terminó de exportar sus funciones.
function Bridge.WaitForExport(resource, exportName, timeout)
    timeout = timeout or 5000
    local elapsed = 0
    while elapsed < timeout do
        local ok = pcall(function()
            return exports[resource][exportName]
        end)
        if ok then return true end
        Wait(100)
        elapsed = elapsed + 100
    end
    return false
end
