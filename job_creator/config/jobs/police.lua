-- ============================================================
-- config/jobs/police.lua  -  Trabajo de SERVICIO (LSPD)
-- Coords: Mission Row PD. Ajusta cualquier coord con el botón 📍 del panel.
--
-- Un job de servicio usa "stations" en vez de "steps":
--   duty     -> entrar/salir de servicio
--   stash    -> armería / cofre compartido (restringido al job en ox_inventory)
--   wardrobe -> vestuario (uniformes definidos abajo)
--
-- NOTA sobre uniformes: los drawables/textures dependen de TU servidor
-- (modelos freemode, EUP, packs...). Los de abajo son de ejemplo: cámbialos
-- por los de tus uniformes. El conjunto { civilian = true } restaura tu ropa.
-- ============================================================

RegisterJob({
    name = 'police',
    label = 'LSPD',
    type = 'service',

    blip = {
        coords = vec3(425.1, -979.5, 30.7),
        sprite = 60, color = 29, scale = 0.9,
        label = 'Comisaría (LSPD)',
    },

    -- Debe tener el job ESX 'police' para entrar en servicio y usar el stash.
    requirements = { job = 'police' },

    duty = {
        coords = vec3(441.0, -981.5, 30.67),
        size = vec3(1.6, 1.6, 2.0),
        labelOff = 'Fichar (entrar en servicio)',
        labelOn = 'Fichar (salir de servicio)',
    },

    stash = {
        coords = vec3(482.6, -1000.9, 30.69),
        size = vec3(1.6, 1.6, 2.0),
        id = 'police_armory',
        label = 'Armería LSPD',
        slots = 60, weight = 200000,
        requireDuty = true,
    },

    wardrobe = {
        coords = vec3(462.0, -1000.5, 30.65),
        size = vec3(1.6, 1.6, 2.0),
        label = 'Vestuario LSPD',
        requireDuty = false,
        outfits = {
            {
                label = 'Uniforme de patrulla',
                components = {
                    [11] = { drawable = 55, texture = 0 }, -- torso
                    [3]  = { drawable = 30, texture = 0 }, -- brazos
                    [8]  = { drawable = 58, texture = 0 }, -- camiseta
                    [4]  = { drawable = 35, texture = 0 }, -- pantalón
                    [6]  = { drawable = 25, texture = 0 }, -- calzado
                },
                props = {
                    [0] = { drawable = 46, texture = 0 }, -- gorra
                },
            },
            {
                label = 'Ropa civil',
                civilian = true,
            },
        },
    },
})
