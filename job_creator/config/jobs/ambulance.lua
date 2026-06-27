-- ============================================================
-- config/jobs/ambulance.lua  -  Trabajo de SERVICIO (EMS)
-- Coords: Pillbox Hill Medical. Ajusta con el botón 📍 del panel.
-- Los uniformes son de ejemplo: cámbialos por los de tu servidor.
-- ============================================================

RegisterJob({
    name = 'ambulance',
    label = 'EMS',
    type = 'service',

    blip = {
        coords = vec3(298.6, -584.6, 43.26),
        sprite = 61, color = 1, scale = 0.9,
        label = 'Hospital (EMS)',
    },

    -- Job ESX 'ambulance' (nombre estándar de EMS en ESX).
    requirements = { job = 'ambulance' },

    duty = {
        coords = vec3(311.2, -593.5, 43.28),
        size = vec3(1.6, 1.6, 2.0),
        labelOff = 'Fichar (entrar en servicio)',
        labelOn = 'Fichar (salir de servicio)',
    },

    stash = {
        coords = vec3(309.0, -601.0, 43.28),
        size = vec3(1.6, 1.6, 2.0),
        id = 'ems_stash',
        label = 'Almacén médico',
        slots = 50, weight = 150000,
        requireDuty = true,
    },

    wardrobe = {
        coords = vec3(313.0, -591.0, 43.28),
        size = vec3(1.6, 1.6, 2.0),
        label = 'Vestuario EMS',
        requireDuty = false,
        outfits = {
            {
                label = 'Uniforme de paramédico',
                components = {
                    [11] = { drawable = 250, texture = 0 },
                    [3]  = { drawable = 85, texture = 0 },
                    [8]  = { drawable = 59, texture = 0 },
                    [4]  = { drawable = 96, texture = 0 },
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
