-- UserBadge historically had no primary or compound key, even though every caller treats one
-- (userId, badgeId) pair as one membership. Preserve the earliest award timestamp for any
-- duplicates before enforcing that invariant. The helper contains only duplicate groups, so a
-- concurrent assignment for an unrelated pair is never copied or deleted.
CREATE TABLE IF NOT EXISTS `_UserBadge_duplicates_0046` (
	`userId` varchar(191) NOT NULL,
	`badgeId` varchar(191) NOT NULL,
	`createdAt` datetime(3) NOT NULL,
	PRIMARY KEY (`userId`, `badgeId`)
);
--> statement-breakpoint
DELETE FROM `_UserBadge_duplicates_0046`;
--> statement-breakpoint
INSERT INTO `_UserBadge_duplicates_0046` (`userId`, `badgeId`, `createdAt`)
SELECT `userId`, `badgeId`, MIN(`createdAt`)
FROM `UserBadge`
GROUP BY `userId`, `badgeId`
HAVING COUNT(*) > 1;
--> statement-breakpoint
DELETE `membership`
FROM `UserBadge` AS `membership`
INNER JOIN `_UserBadge_duplicates_0046` AS `duplicate`
	ON `duplicate`.`userId` = `membership`.`userId`
	AND `duplicate`.`badgeId` = `membership`.`badgeId`;
--> statement-breakpoint
INSERT INTO `UserBadge` (`userId`, `badgeId`, `createdAt`)
SELECT `userId`, `badgeId`, `createdAt`
FROM `_UserBadge_duplicates_0046`;
--> statement-breakpoint
DROP TABLE `_UserBadge_duplicates_0046`;
--> statement-breakpoint
ALTER TABLE `UserBadge` ADD CONSTRAINT `UserBadge_userId_badgeId_key` UNIQUE(`userId`,`badgeId`);
