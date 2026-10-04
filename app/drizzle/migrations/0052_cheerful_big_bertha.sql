ALTER TABLE `UserData` ADD `dashboardContentPriority` json DEFAULT ('[]') NOT NULL;
ALTER TABLE `UserData` ADD `rememberProfileTab` boolean DEFAULT false NOT NULL;