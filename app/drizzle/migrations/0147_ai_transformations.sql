CREATE TABLE `AiTransformation` (
	`userId` varchar(191) NOT NULL,
	`nextAiId` varchar(191) NOT NULL,
	`announce` varchar(32) NOT NULL,
	`log` varchar(200) NOT NULL,
	`tier` tinyint NOT NULL,
	`color` int NOT NULL,
	`glow` int NOT NULL,
	CONSTRAINT `AiTransformation_userId` PRIMARY KEY(`userId`)
);

CREATE INDEX `AiTransformation_nextAiId_idx` ON `AiTransformation` (`nextAiId`);

-- The creator's trial is an ordinary boss; conflicts keep rows staff have since edited.
INSERT INTO `AiTransformation` (`userId`, `nextAiId`, `announce`, `log`, `tier`, `color`, `glow`) VALUES
  ('creator-trial-student', 'creator-trial-genin', 'TURBO-MODE', 'Terriator refuses to fall and reassembles in Turbo-mode!', 1, 5105919, 12121855),
  ('creator-trial-genin', 'creator-trial-chunin', 'BLADE-MODE', 'Terriator refuses to fall and reassembles in Blade-mode!', 2, 11824127, 16752127),
  ('creator-trial-chunin', 'creator-trial-jonin', 'SIEGE-MODE', 'Terriator refuses to fall and reassembles in Siege-mode!', 3, 16738847, 16761182),
  ('creator-trial-jonin', 'creator-trial-elite', 'GOD-MODE', 'Terriator refuses to fall and reassembles in God-mode!', 4, 16766826, 16722509)
ON DUPLICATE KEY UPDATE `userId` = `AiTransformation`.`userId`;
