-- ============================================================
-- bridge/menu/loader.lua  (CLIENTE)
-- API uniforme de menús de contexto.
--   Bridge.Menu.Open({ id, title, options = { { title, description, icon, onSelect = fn } } })
--   Bridge.Menu.Close()
-- ============================================================

Bridge.Menu = {}

local provider = Bridge.Pick('menu', { 'ox_lib', 'qb-menu' })

local function ox_Open(data)
    local options = {}
    for _, opt in ipairs(data.options) do
        options[#options + 1] = {
            title = opt.title,
            description = opt.description,
            icon = opt.icon,
            disabled = opt.disabled,
            onSelect = opt.onSelect,
            metadata = opt.metadata,
        }
    end
    lib.registerContext({
        id = data.id or 'jc_menu',
        title = data.title,
        options = options,
    })
    lib.showContext(data.id or 'jc_menu')
end

local function ox_Close()
    lib.hideContext()
end

local function qb_Open(data)
    local menu = {}
    if data.title then
        menu[#menu + 1] = { header = data.title, isMenuHeader = true }
    end
    for _, opt in ipairs(data.options) do
        menu[#menu + 1] = {
            header = opt.title,
            txt = opt.description,
            icon = opt.icon,
            disabled = opt.disabled,
            params = { event = nil, isAction = true, action = opt.onSelect },
        }
    end
    exports['qb-menu']:openMenu(menu)
end

local function qb_Close()
    exports['qb-menu']:closeMenu()
end

if provider == 'ox_lib' and lib then
    Bridge.Menu.Open = ox_Open
    Bridge.Menu.Close = ox_Close
    Bridge.Print('info', 'Menu provider: ox_lib')
elseif provider == 'qb-menu' then
    Bridge.Menu.Open = qb_Open
    Bridge.Menu.Close = qb_Close
    Bridge.Print('info', 'Menu provider: qb-menu')
else
    Bridge.Menu.Open = function() Bridge.Print('warn', 'Sin sistema de menú instalado') end
    Bridge.Menu.Close = function() end
end
