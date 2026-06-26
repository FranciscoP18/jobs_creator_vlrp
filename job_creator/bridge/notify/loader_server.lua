-- ============================================================
-- bridge/notify/loader_server.lua  (SERVIDOR)
-- Permite notificar desde el servidor a un jugador concreto.
--   Bridge.Notify.SendTo(source, { title, description, type, duration })
-- Reenvía al cliente por un evento propio.
-- ============================================================

Bridge.Notify = Bridge.Notify or {}

function Bridge.Notify.SendTo(source, data)
    TriggerClientEvent('job_creator:notify', source, data)
end
