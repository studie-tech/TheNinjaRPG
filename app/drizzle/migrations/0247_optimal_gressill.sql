CREATE TABLE `BountyContribution` (
	`id` varchar(191) NOT NULL,
	`bountyId` varchar(191) NOT NULL,
	`contributorUserId` varchar(191) NOT NULL,
	`amountRyo` bigint NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `BountyContribution_id` PRIMARY KEY(`id`)
);

ALTER TABLE `Battle` MODIFY COLUMN `battleType` enum('ARENA','COMBAT','SPARRING','KAGE_AI','KAGE_PVP','CLAN_CHALLENGE','CLAN_BATTLE','SHRINE_WAR','TOURNAMENT','QUEST','VILLAGE_PROTECTOR','TRAINING','RANKED_PVP','RANKED_SPARRING') NOT NULL;
ALTER TABLE `BattleHistory` MODIFY COLUMN `battleType` enum('ARENA','COMBAT','SPARRING','KAGE_AI','KAGE_PVP','CLAN_CHALLENGE','CLAN_BATTLE','SHRINE_WAR','TOURNAMENT','QUEST','VILLAGE_PROTECTOR','TRAINING','RANKED_PVP','RANKED_SPARRING');
ALTER TABLE `DataBattleAction` MODIFY COLUMN `battleType` enum('ARENA','COMBAT','SPARRING','KAGE_AI','KAGE_PVP','CLAN_CHALLENGE','CLAN_BATTLE','SHRINE_WAR','TOURNAMENT','QUEST','VILLAGE_PROTECTOR','TRAINING','RANKED_PVP','RANKED_SPARRING') NOT NULL;
ALTER TABLE `UserData` MODIFY COLUMN `primaryElement` enum('Fire','Water','Wind','Earth','Lightning','Ice','Crystal','Dust','Shadow','Wood','Scorch','Storm','Magnet','Yin-Yang','Lava','Explosion','Light','Boil','Metal','None');
ALTER TABLE `UserData` MODIFY COLUMN `secondaryElement` enum('Fire','Water','Wind','Earth','Lightning','Ice','Crystal','Dust','Shadow','Wood','Scorch','Storm','Magnet','Yin-Yang','Lava','Explosion','Light','Boil','Metal','None');
ALTER TABLE `Bounty` ADD `originalAmountRyo` bigint NOT NULL;
ALTER TABLE `UserRequest` ADD `useRankedRules` boolean DEFAULT false;
CREATE INDEX `BountyContribution_bountyId_idx` ON `BountyContribution` (`bountyId`);
CREATE INDEX `BountyContribution_contributorUserId_idx` ON `BountyContribution` (`contributorUserId`);