CREATE TABLE `ContentProposal` (
	`id` varchar(191) NOT NULL,
	`title` varchar(191) NOT NULL,
	`rationale` text NOT NULL,
	`category` enum('GRAMMAR','BALANCE','SOUND','ANIMATION','VISUAL','CONSISTENCY','NEW_CONTENT') NOT NULL,
	`status` enum('PENDING','APPLIED','REJECTED','OUTDATED','REVERTED') NOT NULL DEFAULT 'PENDING',
	`source` enum('AGENT','STAFF') NOT NULL,
	`agentName` varchar(191),
	`runUrl` varchar(512),
	`focus` varchar(32),
	`confidence` tinyint,
	`createdByUserId` varchar(191),
	`reviewedByUserId` varchar(191),
	`rejectReason` enum('NOT_AN_IMPROVEMENT','FACTUALLY_WRONG','STYLE_MISMATCH','WRONG_CHANGE','OTHER'),
	`reviewNote` text,
	`outdatedReason` varchar(191),
	`expiresAt` datetime(3),
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`statusChangedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `ContentProposal_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ContentProposalBasis` (
	`proposalId` varchar(191) NOT NULL,
	`entityType` enum('JUTSU','ITEM','BLOODLINE','QUEST','BADGE','GAME_ASSET','AI') NOT NULL,
	`entityId` varchar(191) NOT NULL,
	`version` varchar(16) NOT NULL,
	`role` enum('TARGET','CONTEXT') NOT NULL,
	CONSTRAINT `ContentProposalBasis_proposalId_entityType_entityId_pk` PRIMARY KEY(`proposalId`,`entityType`,`entityId`)
);

CREATE TABLE `ContentProposalChange` (
	`id` varchar(191) NOT NULL,
	`proposalId` varchar(191) NOT NULL,
	`entityType` enum('JUTSU','ITEM','BLOODLINE','QUEST','BADGE','GAME_ASSET','AI') NOT NULL,
	`entityId` varchar(191),
	`operation` enum('UPDATE','CREATE') NOT NULL DEFAULT 'UPDATE',
	`before` json NOT NULL,
	`after` json NOT NULL,
	`applied` json,
	`sortOrder` tinyint NOT NULL DEFAULT 0,
	CONSTRAINT `ContentProposalChange_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ContentProposalMedia` (
	`id` varchar(191) NOT NULL,
	`proposalId` varchar(191) NOT NULL,
	`changeId` varchar(191) NOT NULL,
	`path` varchar(191) NOT NULL,
	`source` enum('CATALOG','EPIDEMIC','GENERATED') NOT NULL,
	`kind` enum('SFX','ANIMATION','IMAGE') NOT NULL,
	`externalId` varchar(191),
	`title` varchar(191) NOT NULL,
	`url` varchar(512),
	`fileKey` varchar(191),
	`lengthMs` int,
	`prompt` text,
	`chosen` boolean NOT NULL DEFAULT false,
	`sortOrder` tinyint NOT NULL DEFAULT 0,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `ContentProposalMedia_id` PRIMARY KEY(`id`)
);

CREATE INDEX `ContentProposal_status_category_idx` ON `ContentProposal` (`status`,`category`,`createdAt`);
CREATE INDEX `ContentProposal_source_status_idx` ON `ContentProposal` (`source`,`status`,`createdAt`);
CREATE INDEX `ContentProposal_status_changed_idx` ON `ContentProposal` (`status`,`statusChangedAt`);
CREATE INDEX `ContentProposalBasis_entity_idx` ON `ContentProposalBasis` (`entityType`,`entityId`);
CREATE INDEX `ContentProposalChange_proposalId_idx` ON `ContentProposalChange` (`proposalId`);
CREATE INDEX `ContentProposalChange_entity_idx` ON `ContentProposalChange` (`entityType`,`entityId`);
CREATE INDEX `ContentProposalMedia_proposalId_idx` ON `ContentProposalMedia` (`proposalId`);
CREATE INDEX `ContentProposalMedia_source_chosen_idx` ON `ContentProposalMedia` (`source`,`chosen`);