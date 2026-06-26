-- ============================================================
-- bridge/inventory/loader_client.lua  (CLIENTE)
-- Solo operaciones de UI del inventario (abrir stash, etc.).
-- Las operaciones de items reales se hacen en servidor.
--   Bridge.Inventory.OpenStash(id, label, slots, weight)
-- ============================================================

Bridge.Inventory = Bridge.Inventory or {}

local provider = Bridge.Resolve({ 'ox_inventory', 'qb-inventory' })

if provider == 'ox_inventory' then
    function Bridge.Inventory.OpenStash(id)
        exports.ox_inventory:openInventory('stash', id)
    end
elseif provider == 'qb-inventory' then
    function Bridge.Inventory.OpenStash(id)
        TriggerServerEvent('inventory:server:OpenInventory', 'stash', id)
        TriggerEvent('inventory:client:SetCurrentStash', id)
    end
else
    function Bridge.Inventory.OpenStash()
        Bridge.Print('warn', 'OpenStash no disponible sin sistema de inventario')
    end
end
