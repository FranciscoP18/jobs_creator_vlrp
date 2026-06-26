-- ============================================================
-- config/config.lua
-- Ajustes globales del sistema. Los jobs van en config/jobs/*.lua
-- ============================================================

Config = {}

Config.Debug = false              -- activa zonas de debug del target y prints extra
Config.DefaultPayInterval = 60000 -- ms, intervalo de pago por defecto en jobs con sueldo

-- Tabla donde se registran todos los jobs definidos en config/jobs/*.lua
-- NO tocar: la rellenan los archivos de job mediante RegisterJob().
Config.Jobs = {}

-- Función helper que cada archivo de job usa para registrarse.
-- Mantiene los jobs desacoplados: solo añaden su definición a la tabla.
function RegisterJob(definition)
    if not definition.name then
        print('^1[job_creator] Un job no tiene "name", se ignora^0')
        return
    end
    Config.Jobs[definition.name] = definition
end
