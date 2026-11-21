ALTER TABLE `UserReport` ADD `embeddedTextHash` varchar(64);
ALTER TABLE `UserReport` ADD `needsEmbedding` boolean GENERATED ALWAYS AS (`aiInterpretation` <> '' AND JSON_LENGTH(`additionalContext`) > 0 AND `system` <> 'user_profile' AND `status` <> 'UNVIEWED' AND NOT (`embeddedTextHash` <=> SHA2(`aiInterpretation`, 256))) STORED;
CREATE INDEX `UserReport_needsEmbedding_createdAt_idx` ON `UserReport` (`needsEmbedding`,`createdAt`);
CREATE INDEX `UserReportEmbedding_model_idx` ON `UserReportEmbedding` (`model`);
UPDATE `UserReport` JOIN `UserReportEmbedding` ON `UserReportEmbedding`.`reportId` = `UserReport`.`id` SET `UserReport`.`embeddedTextHash` = SHA2(`UserReportEmbedding`.`sourceText`, 256);
ALTER TABLE `UserReportEmbedding` DROP COLUMN `sourceText`;
