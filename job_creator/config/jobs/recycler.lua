-- ============================================================
-- config/jobs/recycler.lua
-- Ejemplo de job declarativo. NO contiene lógica, solo datos.
-- El motor (client/jobs.lua + server/jobs.lua) lo interpreta.
--
-- Un "job" es una secuencia de "steps" (pasos). Cada step define
-- una zona donde interactuar y qué pasa al completarlo.
-- ============================================================

RegisterJob({
    name = 'recycler',
    label = 'Reciclador',
    blip = {
        coords = vec3(-322.0, -1545.0, 31.0),
        sprite = 365,
        color = 2,
        scale = 0.8,
        label = 'Centro de Reciclaje',
    },

    -- Requisitos para poder trabajar (opcional)
    requirements = {
        job = nil,        -- nombre de job del framework requerido, o nil para libre
        item = nil,       -- item necesario para empezar, o nil
    },

    -- Secuencia de pasos del ciclo de trabajo
    steps = {
        {
            id = 'collect',
            label = 'Recolectar basura',
            target = {
                coords = vec3(-322.0, -1545.0, 31.0),
                size = vec3(2.0, 2.0, 2.0),
                icon = 'fa-solid fa-trash',
                label = 'Recolectar',
            },
            -- Progreso (barra/circulo) al interactuar
            progress = { duration = 5000, label = 'Recolectando...' },
            anim = { dict = 'anim@mp_player_intmenu@key_fob@', clip = 'fob_click' },
            -- Recompensa: items que se otorgan (validado en servidor)
            reward = {
                items = { { name = 'trash', min = 1, max = 3 } },
            },
        },
        {
            id = 'process',
            label = 'Procesar material',
            target = {
                coords = vec3(-340.0, -1560.0, 27.5),
                size = vec3(2.5, 2.5, 3.0),
                icon = 'fa-solid fa-recycle',
                label = 'Procesar',
            },
            progress = { duration = 8000, label = 'Procesando...' },
            -- Requiere consumir items para producir otros
            requires = { { name = 'trash', count = 1 } },
            reward = {
                items = { { name = 'recycled_material', min = 1, max = 1 } },
            },
        },
        {
            id = 'sell',
            label = 'Vender material reciclado',
            target = {
                coords = vec3(-310.0, -1570.0, 25.0),
                size = vec3(2.0, 2.0, 2.0),
                icon = 'fa-solid fa-dollar-sign',
                label = 'Vender',
            },
            requires = { { name = 'recycled_material', count = 1 } },
            reward = {
                money = { min = 25, max = 50, account = 'cash' },
            },
        },
    },
})
