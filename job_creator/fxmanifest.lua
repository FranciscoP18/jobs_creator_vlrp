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
    -- ox_lib se carga primero para que el global `lib` exista en cliente/servidor.
    -- Si ox_lib NO está instalado, FiveM omite este archivo y `lib` queda nil;
    -- el código usa `if lib then ...` y cae a los fallbacks. No es obligatorio.
    '@ox_lib/init.lua',
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
    'bridge/clothing/loader.lua',   -- vestuario (illenium / natives)
    -- Core
    'client/main.lua',
    'client/interact.lua',   -- capa de interacción (target / tecla E)
    'client/jobs.lua',
    'client/admin.lua',   -- puente NUI del panel
}

server_scripts {
    -- oxmysql: librería de acceso a la base de datos (persistencia del panel).
    '@oxmysql/lib/MySQL.lua',
    'bridge/shared.lua',
    'bridge/framework/loader_server.lua',
    'bridge/inventory/loader_server.lua',
    'bridge/notify/loader_server.lua',
    -- Core
    'server/main.lua',
    'server/jobs.lua',
    'server/store.lua',     -- persistencia DB + sync + API del panel
    'server/service.lua',   -- duty + stashes de servicio (police/ems/mechanic)
}

-- Panel NUI (editor de jobs in-game)
ui_page 'html/index.html'

files {
    'html/index.html',
    'html/style.css',
    'html/script.js',
}

-- Dependencias:
--   oxmysql  -> REQUERIDO para la persistencia y el panel.
--   ox_lib, ox_target, ox_inventory, qb-target, qb-menu, etc. -> opcionales
--   (el bridge las detecta en runtime; sin ellas se usan los fallbacks).
