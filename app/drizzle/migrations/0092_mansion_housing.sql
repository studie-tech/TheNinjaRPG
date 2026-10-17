-- Add the destination before moving owners, then remove the retired enum values.
ALTER TABLE `UserData` MODIFY COLUMN `homeType` enum('NONE','STUDIO_APARTMENT','ONE_BED_APARTMENT','TWO_BED_HOUSE','TOWN_HOUSE','SMALL_MANSION','SMALL_ESTATE','LARGE_ESTATE','PALACE','MARSHMALLOWOPOLIS','MANSION') NOT NULL DEFAULT 'NONE';
UPDATE `UserData`
SET `homeType` = 'MANSION'
WHERE `homeType` IN ('SMALL_MANSION','SMALL_ESTATE','LARGE_ESTATE');
-- Reject stale decoration drafts for every property whose floor plan changed.
UPDATE `UserData`
SET `homeFurnitureRevision` = `homeFurnitureRevision` + 1
WHERE `homeType` IN ('MANSION','PALACE','MARSHMALLOWOPOLIS');
ALTER TABLE `UserData` MODIFY COLUMN `homeType` enum('NONE','STUDIO_APARTMENT','ONE_BED_APARTMENT','TWO_BED_HOUSE','TOWN_HOUSE','MANSION','PALACE','MARSHMALLOWOPOLIS') NOT NULL DEFAULT 'NONE';
