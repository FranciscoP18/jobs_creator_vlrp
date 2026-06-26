-- ============================================================
-- bridge/notify/loader.lua  (CLIENTE)
-- API uniforme de notificaciones.
--   Bridge.Notify.Send({ title, description, type, duration })
--   type: 'success' | 'error' | 'info' | 'warning'
-- ============================================================

Bridge.Notify = {}

local provider = Bridge.Resolve({ 'ox_lib', 'esx_notify', 'qb-core' })

local function ox_Notify(data)
    exports.ox_lib:notify({
        title = data.title,
        description = data.description,
        type = data.type or 'inform',
        duration = data.duration or 4000,
        position = data.position or 'top-right',
    })
end

local function qb_Notify(data)
    -- qb usa (text, type, duration). type 'primary'|'success'|'error'
    local qbType = data.type == 'info' and 'primary' or (data.type or 'primary')
    TriggerEvent('QBCore:Notify', data.description or data.title, qbType, data.duration or 4000)
end

local function esx_Notify(data)
    -- ESX moderno: usa el evento de notify nativo del framework
    TriggerEvent('esx:showNotification', data.description or data.title)
end

if provider == 'ox_lib' then
    Bridge.Notify.Send = ox_Notify
    Bridge.Print('info', 'Notify provider: ox_lib')
elseif provider == 'qb-core' then
    Bridge.Notify.Send = qb_Notify
    Bridge.Print('info', 'Notify provider: qb-core')
else
    -- ESX por defecto si está el framework, o un fallback de chat.
    if Bridge.IsStarted('es_extended') then
        Bridge.Notify.Send = esx_Notify
        Bridge.Print('info', 'Notify provider: esx')
    else
        Bridge.Notify.Send = function(data)
            Bridge.Print('info', ('NOTIFY: %s - %s'):format(data.title or '', data.description or ''))
        end
        Bridge.Print('warn', 'Sin sistema de notify, usando fallback de consola')
    end
end
