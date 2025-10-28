ALTER TABLE `Item` ADD `crystalTargetTypes` enum('WEAPON','CONSUMABLE','ARMOR','ACCESSORY','MATERIAL','KEYSTONE','CRYSTAL','OTHER') DEFAULT NULL;

-- Set skill points to the correct amount based on level (levels 21-40 give 1 skill point each)
UPDATE `UserData` SET `skillPoints` = CASE 
  WHEN `level` >= 21 AND `level` <= 40 THEN `level` - 20
  WHEN `level` > 40 THEN 20
  ELSE `skillPoints`
END;