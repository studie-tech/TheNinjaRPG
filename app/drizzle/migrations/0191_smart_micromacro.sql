ALTER TABLE `ConversationComment` ADD `challengeMatch` json;
ALTER TABLE `UserRequest` ADD `conversationId` varchar(191);