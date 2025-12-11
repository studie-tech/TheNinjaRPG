-- Add battleType column to ItemLoadout table with default value of 'PVP'
ALTER TABLE `ItemLoadout` ADD `battleType` enum('PVE','PVP') DEFAULT 'PVP' NOT NULL;

-- Create index on battleType column for query optimization
CREATE INDEX `ItemLoadout_battleType_idx` ON `ItemLoadout` (`battleType`);