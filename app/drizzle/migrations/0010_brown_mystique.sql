-- Migration: Rename village references in Quest table
-- Mapping: Current→Akikaze, Glacier→Hyorin, Shroud→Akasumi, Shine→Shirohana
-- (Tsukimori unchanged)
-- Note: MySQL REPLACE() is case-sensitive, so only exact case matches are affected.

-- ============================================================
-- CONTENT COLUMN: Update quest content JSON
-- ============================================================

-- Protect words containing village names as substrings
UPDATE `Quest` SET `content` = REPLACE(`content`, 'Currently', '___CURRENTLY___') WHERE `content` LIKE '%Currently%';
UPDATE `Quest` SET `content` = REPLACE(`content`, 'Shining', '___SHINING___') WHERE `content` LIKE '%Shining%';
UPDATE `Quest` SET `content` = REPLACE(`content`, 'Shrouded', '___SHROUDED___') WHERE `content` LIKE '%Shrouded%';
UPDATE `Quest` SET `content` = REPLACE(`content`, 'Glaciers', '___GLACIERS___') WHERE `content` LIKE '%Glaciers%';

-- Replace village names in content
UPDATE `Quest` SET `content` = REPLACE(`content`, 'Current', 'Akikaze') WHERE `content` LIKE '%Current%';
UPDATE `Quest` SET `content` = REPLACE(`content`, 'Glacier', 'Hyorin') WHERE `content` LIKE '%Glacier%';
UPDATE `Quest` SET `content` = REPLACE(`content`, 'Shroud', 'Akasumi') WHERE `content` LIKE '%Shroud%';
UPDATE `Quest` SET `content` = REPLACE(`content`, 'Shine', 'Shirohana') WHERE `content` LIKE '%Shine%';

-- Restore protected words
UPDATE `Quest` SET `content` = REPLACE(`content`, '___CURRENTLY___', 'Currently') WHERE `content` LIKE '%___CURRENTLY___%';
UPDATE `Quest` SET `content` = REPLACE(`content`, '___SHINING___', 'Shining') WHERE `content` LIKE '%___SHINING___%';
UPDATE `Quest` SET `content` = REPLACE(`content`, '___SHROUDED___', 'Shrouded') WHERE `content` LIKE '%___SHROUDED___%';
UPDATE `Quest` SET `content` = REPLACE(`content`, '___GLACIERS___', 'Glaciers') WHERE `content` LIKE '%___GLACIERS___%';

-- Update uppercase reward_village_membership enum values in content JSON
UPDATE `Quest` SET `content` = REPLACE(`content`, '"CURRENT"', '"AKIKAZE"') WHERE `content` LIKE '%"CURRENT"%';
UPDATE `Quest` SET `content` = REPLACE(`content`, '"GLACIER"', '"HYORIN"') WHERE `content` LIKE '%"GLACIER"%';
UPDATE `Quest` SET `content` = REPLACE(`content`, '"SHROUD"', '"AKASUMI"') WHERE `content` LIKE '%"SHROUD"%';
UPDATE `Quest` SET `content` = REPLACE(`content`, '"SHINE"', '"SHIROHANA"') WHERE `content` LIKE '%"SHINE"%';

-- ============================================================
-- DESCRIPTION COLUMN: Update quest descriptions
-- ============================================================

-- Protect false positives
UPDATE `Quest` SET `description` = REPLACE(`description`, 'Currently', '___CURRENTLY___') WHERE `description` LIKE '%Currently%';
UPDATE `Quest` SET `description` = REPLACE(`description`, 'Current Movement', '___CURRENT_MOVEMENT___') WHERE `description` LIKE '%Current Movement%';
UPDATE `Quest` SET `description` = REPLACE(`description`, 'Shining', '___SHINING___') WHERE `description` LIKE '%Shining%';
UPDATE `Quest` SET `description` = REPLACE(`description`, 'Shrouded', '___SHROUDED___') WHERE `description` LIKE '%Shrouded%';
UPDATE `Quest` SET `description` = REPLACE(`description`, 'Glaciers', '___GLACIERS___') WHERE `description` LIKE '%Glaciers%';

-- Replace village names in description
UPDATE `Quest` SET `description` = REPLACE(`description`, 'Current', 'Akikaze') WHERE `description` LIKE '%Current%';
UPDATE `Quest` SET `description` = REPLACE(`description`, 'Glacier', 'Hyorin') WHERE `description` LIKE '%Glacier%';
UPDATE `Quest` SET `description` = REPLACE(`description`, 'Shroud', 'Akasumi') WHERE `description` LIKE '%Shroud%';
UPDATE `Quest` SET `description` = REPLACE(`description`, 'Shine', 'Shirohana') WHERE `description` LIKE '%Shine%';

-- Restore protected words
UPDATE `Quest` SET `description` = REPLACE(`description`, '___CURRENTLY___', 'Currently') WHERE `description` LIKE '%___CURRENTLY___%';
UPDATE `Quest` SET `description` = REPLACE(`description`, '___CURRENT_MOVEMENT___', 'Current Movement') WHERE `description` LIKE '%___CURRENT_MOVEMENT___%';
UPDATE `Quest` SET `description` = REPLACE(`description`, '___SHINING___', 'Shining') WHERE `description` LIKE '%___SHINING___%';
UPDATE `Quest` SET `description` = REPLACE(`description`, '___SHROUDED___', 'Shrouded') WHERE `description` LIKE '%___SHROUDED___%';
UPDATE `Quest` SET `description` = REPLACE(`description`, '___GLACIERS___', 'Glaciers') WHERE `description` LIKE '%___GLACIERS___%';

-- ============================================================
-- NAME COLUMN: Update quest names
-- ============================================================

-- Protect substrings (no known cases but defensive)
UPDATE `Quest` SET `name` = REPLACE(`name`, 'Shining', '___SHINING___') WHERE `name` LIKE '%Shining%';

-- Replace village names in quest names
UPDATE `Quest` SET `name` = REPLACE(`name`, 'Current', 'Akikaze') WHERE `name` LIKE '%Current%';
UPDATE `Quest` SET `name` = REPLACE(`name`, 'Glacier', 'Hyorin') WHERE `name` LIKE '%Glacier%';
UPDATE `Quest` SET `name` = REPLACE(`name`, 'Shroud', 'Akasumi') WHERE `name` LIKE '%Shroud%';
UPDATE `Quest` SET `name` = REPLACE(`name`, 'Shine', 'Shirohana') WHERE `name` LIKE '%Shine%';

-- Restore
UPDATE `Quest` SET `name` = REPLACE(`name`, '___SHINING___', 'Shining') WHERE `name` LIKE '%___SHINING___%';
