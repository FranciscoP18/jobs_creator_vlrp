-- ============================================================
-- server/main.lua
-- Punto de arranque del servidor. Exports y comandos admin.
-- ============================================================

CreateThread(function()
    Bridge.Print('info', 'Servidor iniciado correctamente')
    local count = 0
    for _ in pairs(Config.Jobs) do count = count + 1 end
    Bridge.Print('info', ('%d job(s) registrados'):format(count))
end)

-- Comando para listar jobs cargados (útil para depurar)
RegisterCommand('jc_jobs', function(source)
    if source ~= 0 then return end -- solo consola
    for name, job in pairs(Config.Jobs) do
        print(('  - %s (%s): %d steps'):format(name, job.label or '?', #job.steps))
    end
end, true)

-- Export para otros recursos: dar recompensa de un job programáticamente
exports('CompleteStepFor', function(source, jobName, stepId)
    TriggerEvent('job_creator:completeStep', jobName, stepId)
end)
