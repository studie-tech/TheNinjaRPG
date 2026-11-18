-- Replace the unique dimensions atomically so concurrent settlement upserts retain uniqueness.
ALTER TABLE `DataBattleAction`
  DROP INDEX `uniqueContentId`,
  DROP INDEX `DataBattleActions_updatedAt_idx`,
  MODIFY COLUMN `type` enum('jutsu','item','bloodline','basic','ai','participant') NOT NULL,
  ADD `periodStart` int DEFAULT 0 NOT NULL,
  ADD `userLevel` int DEFAULT 0 NOT NULL,
  ADD `userRank` enum('STUDENT','GENIN','CHUNIN','JONIN','ELITE JONIN','ELDER','NONE') DEFAULT 'NONE' NOT NULL,
  ADD `turnOrder` tinyint DEFAULT 0 NOT NULL,
  ADD CONSTRAINT `uniqueContentId` UNIQUE(`type`,`contentId`,`battleType`,`battleWon`,`relatedBloodlineId`,`periodStart`,`userLevel`,`userRank`,`turnOrder`),
  ADD INDEX `DataBattleActions_period_idx` (`periodStart`);
