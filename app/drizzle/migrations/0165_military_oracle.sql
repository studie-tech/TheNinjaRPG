-- Replace each index atomically so per-user log and conversation reads always have one.
ALTER TABLE `ActionLog` DROP INDEX `ActionLog_userId_tableName_idx`, ADD INDEX `ActionLog_userId_tableName_relatedText_createdAt_idx` (`userId`,`tableName`,`relatedText`,`createdAt`);
ALTER TABLE `ConversationComment` DROP INDEX `ConversationComment_conversationId_idx`, ADD INDEX `ConversationComment_conversationId_createdAt_userId_idx` (`conversationId`,`createdAt`,`userId`);
