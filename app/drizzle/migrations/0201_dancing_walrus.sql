-- Add ranked battle type to existing tables
ALTER TABLE `Battle` MODIFY COLUMN `battleType` ENUM('ARENA', 'COMBAT', 'SPARRING', 'KAGE_AI', 'KAGE_PVP', 'CLAN_CHALLENGE', 'CLAN_BATTLE', 'SHRINE_WAR', 'TOURNAMENT', 'QUEST', 'VILLAGE_PROTECTOR', 'TRAINING', 'RANKED') NOT NULL;
ALTER TABLE `BattleHistory` MODIFY COLUMN `battleType` ENUM('ARENA', 'COMBAT', 'SPARRING', 'KAGE_AI', 'KAGE_PVP', 'CLAN_CHALLENGE', 'CLAN_BATTLE', 'SHRINE_WAR', 'TOURNAMENT', 'QUEST', 'VILLAGE_PROTECTOR', 'TRAINING', 'RANKED') NOT NULL;
ALTER TABLE `DataBattleAction` MODIFY COLUMN `battleType` ENUM('ARENA', 'COMBAT', 'SPARRING', 'KAGE_AI', 'KAGE_PVP', 'CLAN_CHALLENGE', 'CLAN_BATTLE', 'SHRINE_WAR', 'TOURNAMENT', 'QUEST', 'VILLAGE_PROTECTOR', 'TRAINING', 'RANKED') NOT NULL; 

-- Add ranked battle stats to UserData
ALTER TABLE `UserData` 
ADD COLUMN `rankedLp` INT DEFAULT 150 NOT NULL,
ADD COLUMN `rankedBattles` INT NOT NULL DEFAULT 0,
ADD COLUMN `rankedWins` INT NOT NULL DEFAULT 0,
ADD COLUMN `rankedStreak` INT NOT NULL DEFAULT 0;

-- Create ranked queue table
CREATE TABLE `RankedPvpQueue` (
  `id` varchar(191) NOT NULL,
  `userId` varchar(191) NOT NULL,
  `rankedLp` int NOT NULL,
  `queueStartTime` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
  PRIMARY KEY (`id`),
  INDEX `RankedPvpQueue_userId_idx` (`userId`),
  INDEX `RankedPvpQueue_rankedLp_idx` (`rankedLp`)
);

-- Create ranked jutsu loadout table
CREATE TABLE `RankedJutsuLoadout` (
  `id` varchar(191) NOT NULL,
  `userId` varchar(191) NOT NULL,
  `jutsuIds` json NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `RankedJutsuLoadout_userId_idx` (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Add ranked jutsu loadout reference to UserData
ALTER TABLE `UserData` 
ADD COLUMN `rankedJutsuLoadout` varchar(191),
ADD INDEX `UserData_rankedJutsuLoadout_idx` (`rankedJutsuLoadout`);

-- Create ranked user jutsu table
CREATE TABLE `RankedUserJutsu` (
  `id` varchar(191) NOT NULL,
  `userId` varchar(191) NOT NULL,
  `jutsuId` varchar(191) NOT NULL,
  `level` int NOT NULL DEFAULT 1,
  `equipped` tinyint NOT NULL DEFAULT 0,
  `finishTraining` datetime(3),
  `createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
  `updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
  PRIMARY KEY (`id`),
  UNIQUE KEY `RankedUserJutsu_userId_jutsuId_key` (`userId`, `jutsuId`),
  INDEX `RankedUserJutsu_jutsuId_idx` (`jutsuId`),
  INDEX `RankedUserJutsu_equipped_idx` (`equipped`)
);

CREATE TABLE `RankedSeason` (
  `id` varchar(191) NOT NULL,
  `name` varchar(191) NOT NULL,
  `description` text NOT NULL,
  `startDate` datetime(3) NOT NULL,
  `endDate` datetime(3) NOT NULL,
  `rewards` json NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
  `updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; 
