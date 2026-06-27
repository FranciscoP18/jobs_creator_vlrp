-- ============================================================
-- config/jobs/mechanic.lua  -  Trabajo de SERVICIO (Mecánico)
-- Coords: Hayes Auto (centro). Ajusta con el botón 📍 del panel.
-- Los uniformes son de ejemplo: cámbialos por los de tu servidor.
-- ============================================================

RegisterJob({
    name = 'mechanic',
    label = 'Mecánico',
    type = 'service',

    blip = {
        coords = vec3(-211.4, -1324.4, 30.9),
        sprite = 446, color = 5, scale = 0.9,
        label = 'Taller mecánico',
    },

    -- Job ESX 'mechanic'.
    requirements = { job = 'mechanic' },

    duty = {
        coords = vec3(-211.4, -1324.4, 30.9),
        size = vec3(1.8, 1.8, 2.0),
        labelOff = 'Fichar (entrar en servicio)',
        labelOn = 'Fichar (salir de servicio)',
    },

    stash = {
        coords = vec3(-205.0, -1311.0, 31.3),
        size = vec3(1.8, 1.8, 2.0),
        id = 'mechanic_stash',
        label = 'Almacén de piezas',
        slots = 80, weight = 500000,
        requireDuty = true,
    },

    wardrobe = {
        coords = vec3(-216.0, -1327.0, 30.9),
        size = vec3(1.6, 1.6, 2.0),
        label = 'Vestuario taller',
        requireDuty = false,
        outfits = {
            {
                label = 'Mono de trabajo',
                components = {
                    [11] = { drawable = 71, texture = 0 },
                    [3]  = { drawable = 39, texture = 0 },
                    [8]  = { drawable = 15, texture = 0 },
                    [4]  = { drawable = 25, texture = 0 },
                    [6]  = { drawable = 24, texture = 0 },
                },
            },
            {
                label = 'Ropa civil',
                civilian = true,
            },
        },
    },
})
