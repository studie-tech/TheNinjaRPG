ALTER TABLE `UserLiveActivity` DROP INDEX `UserLiveActivity_userId_kind_key`;
DROP INDEX `UserLiveActivity_activityId_idx` ON `UserLiveActivity`;
ALTER TABLE `UserLiveActivity` ADD CONSTRAINT `UserLiveActivity_userId_activityId_key` UNIQUE(`userId`,`activityId`);
CREATE INDEX `UserLiveActivity_userId_kind_idx` ON `UserLiveActivity` (`userId`,`kind`);