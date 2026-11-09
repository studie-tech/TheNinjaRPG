ALTER TABLE `UserData` ADD `villageDutyVillageId` varchar(191);
ALTER TABLE `UserData` ADD `villageDutyStartedAt` datetime(3);
CREATE INDEX `UserData_villageDutyVillageId_idx` ON `UserData` (`villageDutyVillageId`);