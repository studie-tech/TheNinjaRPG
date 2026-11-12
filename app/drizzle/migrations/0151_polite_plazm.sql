ALTER TABLE `PetSpecies` ADD `potentialMode` enum('FIXED','RANDOM') DEFAULT 'FIXED' NOT NULL;
ALTER TABLE `PetSpecies` ADD `potentialValue` tinyint unsigned DEFAULT 1 NOT NULL;
ALTER TABLE `PetSpecies` ADD `potentialMin` tinyint unsigned DEFAULT 1 NOT NULL;
ALTER TABLE `PetSpecies` ADD `potentialMax` tinyint unsigned DEFAULT 5 NOT NULL;
ALTER TABLE `PetSpecies` ADD `potentialWeights` json DEFAULT ('[70,50,20,10,2]') NOT NULL;
ALTER TABLE `UserPet` ADD `potentialValue` tinyint unsigned DEFAULT 1 NOT NULL;
ALTER TABLE `UserPet` ADD `potentialRevealed` boolean DEFAULT true NOT NULL;
ALTER TABLE `UserPet` ADD `potentialChances` json DEFAULT ('[]') NOT NULL;