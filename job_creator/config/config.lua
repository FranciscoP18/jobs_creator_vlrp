-- ============================================================
-- config/config.lua
-- Ajustes globales del sistema. Los jobs van en config/jobs/*.lua
-- ============================================================

Config = {}

Config.Debug = false              -- activa zonas de debug del target y prints extra
Config.ShowMarkers = true         -- marcadores visibles al acercarse a las zonas
Config.DefaultPayInterval = 60000 -- ms, intervalo de pago por defecto en jobs con sueldo

-- Auditoría: registra en consola quién crea/edita/borra jobs desde el panel.
-- Si pones una URL de webhook de Discord, además se envía allí.
Config.AuditLog = true
Config.AuditWebhook = '' -- ej: 'https://discord.com/api/webhooks/xxxx/yyyy'
-- Auditar también fichajes, armería, salarios y caja de empresa.
Config.AuditActions = true   -- duty, armería, ingresos/retiros de caja, jefe
Config.AuditSalaries = false -- pagos de salario (puede generar mucho log)

-- Nombre del job de "paro" del framework, usado al despedir desde el menú de jefe.
-- ESX suele usar 'unemployed'; QB/Qbox también. Cámbialo si el tuyo difiere.
Config.UnemployedJob = 'unemployed'

-- Caja de empresa (sociedad): de dónde salen salarios/recompensas.
--   'internal'     -> caja propia del job_creator (tabla jobcreator_society)
--   'esx_society'  -> sociedad compartida de ESX (society_<job>, vía esx_addonaccount)
Config.SocietyBackend = 'internal'

-- Rangos: si está activo, al GUARDAR un job sus grados se sincronizan a ESX
-- (tablas jobs/job_grades) y el HUD muestra los rangos del job_creator.
-- ¡Sobrescribe los job_grades de ese job en ESX! (job_creator manda)
Config.SyncRanksToESX = false

-- Modo de interacción con las zonas/stations:
--   'target' -> usar sistema de target (ox_target/qb-target)  [por defecto]
--   'key'    -> acercarse y pulsar la tecla E (marker + texto)
--   'both'   -> ambos a la vez
-- Configurable también desde el panel (Ajustes). El cliente lo recibe al sincronizar.
Config.InteractMode = 'key'

-- Tabla donde se registran todos los jobs definidos en config/jobs/*.lua
-- NO tocar: la rellenan los archivos de job mediante RegisterJob().
Config.Jobs = {}

-- ============================================================
-- PROVEEDORES (qué sistema usar de cada tipo)
-- 'auto' = autodetección (usa el primero instalado de la lista).
-- O pon el NOMBRE EXACTO del recurso para forzarlo. Si el forzado no está
-- iniciado, se avisa en consola y se vuelve a la autodetección.
-- ============================================================
Config.Providers = {
    -- Framework: 'auto' | 'es_extended' | 'qbx_core' | 'qb-core'
    framework = 'auto',
    -- Inventario: 'auto' | 'ox_inventory' | 'qb-inventory'
    inventory = 'auto',
    -- Notificaciones: 'auto' | 'vlrp-notify' | 'ox_lib' | 'esx_notify' | 'qb-core'
    notify = 'auto',
    -- Target: 'auto' | 'ox_target' | 'qb-target' | 'qtarget'
    target = 'auto',
    -- Menús: 'auto' | 'ox_lib' | 'qb-menu'
    menu = 'auto',
    -- Texto flotante (modo tecla E): 'auto' | 'vlrp-textui' | 'cd_drawtextui' | 'ox_lib'
    textui = 'auto',
    -- Ropa/apariencia: 'auto' | 'illenium-appearance' | 'fivem-appearance' | 'qb-clothing' | 'esx_skin'
    clothing = 'auto',
}

-- Función helper que cada archivo de job usa para registrarse.
-- Mantiene los jobs desacoplados: solo añaden su definición a la tabla.
function RegisterJob(definition)
    if not definition.name then
        print('^1[job_creator] Un job no tiene "name", se ignora^0')
        return
    end
    Config.Jobs[definition.name] = definition
end
