ALTER TABLE `KageDefendedChallenges` ADD `battleId` varchar(191);
ALTER TABLE `KageDefendedChallenges` ADD CONSTRAINT `KageDefendedChallenges_battleId_key` UNIQUE(`battleId`);