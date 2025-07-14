ALTER TABLE `CraftingRequirement` ADD CONSTRAINT `CraftingRequirement_craft_requirement_key` UNIQUE(`craftItemId`,`requirementItemId`);
ALTER TABLE `UserItemImbuement` ADD CONSTRAINT `UserItemImbuement_userItem_imbuement_key` UNIQUE(`userItemId`,`imbuementItemId`);
CREATE INDEX `UserItemImbuement_userItemId_idx` ON `UserItemImbuement` (`userItemId`);
CREATE INDEX `UserItemImbuement_imbuementItemId_idx` ON `UserItemImbuement` (`imbuementItemId`);