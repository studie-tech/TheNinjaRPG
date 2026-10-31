ALTER TABLE `UserData` ADD `chatMuted` boolean DEFAULT false NOT NULL;
ALTER TABLE `UserData` ADD `mutedConversationIds` json DEFAULT ('[]') NOT NULL;