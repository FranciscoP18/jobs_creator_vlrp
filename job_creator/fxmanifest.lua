fx_version 'cerulean'
game 'gta5'
lua54 'yes'

author 'Panchuuu'
description 'Job Creator - Sistema de jobs declarativo con bridge multi-recurso'
version '1.0.0'

-- ============================================================
-- ORDEN DE CARGA (importante respetarlo)
-- 1. config        -> define datos y settings
-- 2. bridge        -> detecta dependencias y expone API uniforme
-- 3. core (jobs)   -> motor que consume el bridge
-- ============================================================

shared_scripts {
    'config/config.lua',
    'config/jobs/*.lua',
}

client_scripts {
    -- Bridge (cliente): detección + módulos
    'bridge/shared.lua',
    'bridge/target/loader.lua',
    'bridge/notify/loader.lua',
    'bridge/menu/loader.lua',
    'bridge/inventory/loader_client.lua',
    -- Core
    'client/main.lua',
    'client/jobs.lua',
}

server_scripts {
    'bridge/shared.lua',
    'bridge/framework/loader_server.lua',
    'bridge/inventory/loader_server.lua',
    'bridge/notify/loader_server.lua',
    -- Core
    'server/main.lua',
    'server/jobs.lua',
}

-- Dependencias opcionales (el bridge las detecta en runtime, no son obligatorias)
-- ox_lib, ox_target, ox_inventory, qb-target, qb-menu, etc.
