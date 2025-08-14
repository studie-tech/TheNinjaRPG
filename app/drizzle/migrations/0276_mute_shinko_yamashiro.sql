ALTER TABLE `ConversationComment` ADD `authorId` varchar(191);
ALTER TABLE `ForumPost` ADD `authorId` varchar(191);

UPDATE `ConversationComment` SET `authorId` = `userId` WHERE `authorId` IS NULL;
UPDATE `ForumPost` SET `authorId` = `userId` WHERE `authorId` IS NULL;

ALTER TABLE `ConversationComment` MODIFY `authorId` varchar(191) NOT NULL;
ALTER TABLE `ForumPost` MODIFY `authorId` varchar(191) NOT NULL;
