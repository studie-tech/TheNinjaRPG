CREATE INDEX `QuestHistory_userId_completed_idx` ON `QuestHistory` (`userId`,`completed`);
CREATE INDEX `QuestHistory_userId_questType_idx` ON `QuestHistory` (`userId`,`questType`);
CREATE INDEX `UserData_isAi_rankedLp_experience_idx` ON `UserData` (`isAi`,`rankedLp`,`experience`);
CREATE INDEX `UserItem_userId_equipped_idx` ON `UserItem` (`userId`,`equipped`);