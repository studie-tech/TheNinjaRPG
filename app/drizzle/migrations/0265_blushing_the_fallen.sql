ALTER TABLE `DataBattleAction` DROP INDEX `uniqueContentId`;
ALTER TABLE `DataBattleAction` ADD `relatedBloodlineId` varchar(191);
ALTER TABLE `DataBattleAction` ADD CONSTRAINT `uniqueContentId` UNIQUE(`type`,`contentId`,`battleType`,`battleWon`,`relatedBloodlineId`);