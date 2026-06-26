-- ============================================================
-- bridge/inventory/loader_server.lua  (SERVIDOR)
-- API uniforme de inventario. SIEMPRE validar en servidor.
--   Bridge.Inventory.AddItem(source, item, count, metadata) -> bool
--   Bridge.Inventory.RemoveItem(source, item, count) -> bool
--   Bridge.Inventory.GetItemCount(source, item) -> number
--   Bridge.Inventory.CanCarry(source, item, count) -> bool
-- ============================================================

Bridge.Inventory = {}

local provider = Bridge.Resolve({ 'ox_inventory', 'qb-inventory' })
local framework = Bridge.Resolve({ 'es_extended', 'qb-core' })

-- Cache del objeto de framework (ESX/QB) para no recrearlo cada llamada.
local ESX, QBCore

CreateThread(function()
    if framework == 'es_extended' then
        ESX = exports['es_extended']:getSharedObject()
    elseif framework == 'qb-core' then
        QBCore = exports['qb-core']:GetCoreObject()
    end
end)

-- ---------- ox_inventory (preferido, framework-agnóstico) ----------
local function ox_AddItem(source, item, count, metadata)
    return exports.ox_inventory:AddItem(source, item, count, metadata)
end

local function ox_RemoveItem(source, item, count)
    return exports.ox_inventory:RemoveItem(source, item, count)
end

local function ox_GetItemCount(source, item)
    return exports.ox_inventory:GetItemCount(source, item) or 0
end

local function ox_CanCarry(source, item, count)
    return exports.ox_inventory:CanCarryItem(source, item, count)
end

-- ---------- ESX (sin ox_inventory) ----------
local function esx_AddItem(source, item, count)
    local xPlayer = ESX and ESX.GetPlayerFromId(source)
    if not xPlayer then return false end
    xPlayer.addInventoryItem(item, count)
    return true
end

local function esx_RemoveItem(source, item, count)
    local xPlayer = ESX and ESX.GetPlayerFromId(source)
    if not xPlayer then return false end
    local invItem = xPlayer.getInventoryItem(item)
    if not invItem or invItem.count < count then return false end
    xPlayer.removeInventoryItem(item, count)
    return true
end

local function esx_GetItemCount(source, item)
    local xPlayer = ESX and ESX.GetPlayerFromId(source)
    if not xPlayer then return 0 end
    local invItem = xPlayer.getInventoryItem(item)
    return invItem and invItem.count or 0
end

local function esx_CanCarry()
    return true -- ESX clásico no tiene límite por peso por defecto
end

-- ---------- QB (sin ox_inventory) ----------
local function qb_AddItem(source, item, count)
    local Player = QBCore and QBCore.Functions.GetPlayer(source)
    if not Player then return false end
    return Player.Functions.AddItem(item, count)
end

local function qb_RemoveItem(source, item, count)
    local Player = QBCore and QBCore.Functions.GetPlayer(source)
    if not Player then return false end
    return Player.Functions.RemoveItem(item, count)
end

local function qb_GetItemCount(source, item)
    local Player = QBCore and QBCore.Functions.GetPlayer(source)
    if not Player then return 0 end
    local it = Player.Functions.GetItemByName(item)
    return it and it.amount or 0
end

local function qb_CanCarry()
    return true
end

-- ---------- Selección de implementación ----------
if provider == 'ox_inventory' then
    Bridge.Inventory.AddItem      = ox_AddItem
    Bridge.Inventory.RemoveItem   = ox_RemoveItem
    Bridge.Inventory.GetItemCount = ox_GetItemCount
    Bridge.Inventory.CanCarry     = ox_CanCarry
    Bridge.Print('info', 'Inventory provider: ox_inventory')

elseif framework == 'es_extended' then
    Bridge.Inventory.AddItem      = esx_AddItem
    Bridge.Inventory.RemoveItem   = esx_RemoveItem
    Bridge.Inventory.GetItemCount = esx_GetItemCount
    Bridge.Inventory.CanCarry     = esx_CanCarry
    Bridge.Print('info', 'Inventory provider: esx (nativo)')

elseif framework == 'qb-core' then
    Bridge.Inventory.AddItem      = qb_AddItem
    Bridge.Inventory.RemoveItem   = qb_RemoveItem
    Bridge.Inventory.GetItemCount = qb_GetItemCount
    Bridge.Inventory.CanCarry     = qb_CanCarry
    Bridge.Print('info', 'Inventory provider: qb (nativo)')

else
    Bridge.Inventory.AddItem      = function() return false end
    Bridge.Inventory.RemoveItem   = function() return false end
    Bridge.Inventory.GetItemCount = function() return 0 end
    Bridge.Inventory.CanCarry     = function() return false end
    Bridge.Print('error', 'Sin sistema de inventario ni framework detectado')
end
