-- ============================================================
-- client/main.lua
-- Punto de arranque del cliente. Aquí van exports públicos y
-- cualquier inicialización que no sea propia del motor de jobs.
-- ============================================================

CreateThread(function()
    Bridge.Print('info', 'Cliente iniciado correctamente')
end)

-- Export de ejemplo: abrir un stash desde otro recurso
exports('OpenStash', function(id)
    Bridge.Inventory.OpenStash(id)
end)
