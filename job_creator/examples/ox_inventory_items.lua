-- ============================================================
-- examples/ox_inventory_items.lua
-- Items de ejemplo para los jobs de este recurso.
-- COPIA estas entradas dentro de la tabla de tu ox_inventory/data/items.lua
-- (no es un archivo que cargue job_creator; es solo una referencia).
-- Tras añadirlos: restart ox_inventory.
-- ============================================================

-- Reciclador
['trash'] = {
    label = 'Basura',
    weight = 100,
    stack = true,
    close = true,
    description = 'Basura reciclable',
},
['recycled_material'] = {
    label = 'Material Reciclado',
    weight = 200,
    stack = true,
    close = true,
    description = 'Material listo para vender',
},

-- Policía (LSPD)
['handcuffs'] = {
    label = 'Esposas',
    weight = 100,
    stack = false,
    close = true,
},
['police_badge'] = {
    label = 'Placa policial',
    weight = 50,
    stack = false,
    close = true,
},

-- EMS / Ambulancia
['bandage'] = {
    label = 'Vendaje',
    weight = 50,
    stack = true,
    close = true,
},
['medikit'] = {
    label = 'Botiquín',
    weight = 300,
    stack = true,
    close = true,
},

-- Mecánico
['repairkit'] = {
    label = 'Kit de reparación',
    weight = 1000,
    stack = true,
    close = true,
},
['cleaningkit'] = {
    label = 'Kit de limpieza',
    weight = 500,
    stack = true,
    close = true,
},
