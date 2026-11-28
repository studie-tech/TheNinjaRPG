ALTER TABLE `UserData` ADD `lastKageKickAt` datetime(3);
ALTER TABLE `UserData` ADD `villageRejoinBans` json;
ALTER TABLE `UserData` ADD `villageKickReason` varchar(1000);
ALTER TABLE `UserData` ADD `villagePenaltyExempt` boolean DEFAULT false NOT NULL;
ALTER TABLE `UserData` ADD `villagePenaltyWaivers` tinyint unsigned DEFAULT 0 NOT NULL;