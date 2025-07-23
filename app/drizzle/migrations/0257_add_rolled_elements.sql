ALTER TABLE `UserData` ADD `rolledElements` json NOT NULL DEFAULT ('[]'); 
ALTER TABLE `UserData` ADD `dailyMedicalMissions` smallint unsigned DEFAULT 0 NOT NULL; 
ALTER TABLE `UserData` ADD `dailyLockedTimeSeconds` int NOT NULL DEFAULT 0; 
