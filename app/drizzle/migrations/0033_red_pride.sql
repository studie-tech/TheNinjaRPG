CREATE TABLE `DevContributionProfile` (
	`userId` varchar(191) NOT NULL,
	`githubLogin` varchar(191),
	`claudeDailyTokenCap` bigint NOT NULL DEFAULT 0,
	`codexDailyTokenCap` bigint NOT NULL DEFAULT 0,
	`autoRun` boolean NOT NULL DEFAULT false,
	`totalJobsCompleted` int NOT NULL DEFAULT 0,
	`totalTokensContributed` bigint NOT NULL DEFAULT 0,
	`lastSeenAt` datetime(3),
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `DevContributionProfile_userId` PRIMARY KEY(`userId`)
);

CREATE TABLE `DevJob` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`jobType` enum('PR_REVIEW','ISSUE_TRIAGE','ISSUE_IMPLEMENT') NOT NULL,
	`refKind` enum('PULL_REQUEST','ISSUE') NOT NULL,
	`refNumber` int NOT NULL,
	`refUrl` varchar(500) NOT NULL,
	`status` enum('PENDING','CLAIMED','COMPLETED','FAILED','CANCELLED') NOT NULL DEFAULT 'PENDING',
	`agent` enum('CLAUDE','CODEX'),
	`claimedByUserId` varchar(191),
	`claimedAt` datetime(3),
	`heartbeatAt` datetime(3),
	`completedAt` datetime(3),
	`attemptCount` int NOT NULL DEFAULT 0,
	`tokensIn` bigint NOT NULL DEFAULT 0,
	`tokensOut` bigint NOT NULL DEFAULT 0,
	`resultUrl` varchar(500),
	`error` text,
	`contextJson` mediumtext,
	`rewardGranted` boolean NOT NULL DEFAULT false,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `DevJob_id` PRIMARY KEY(`id`)
);

CREATE TABLE `DevJobDailyUsage` (
	`userId` varchar(191) NOT NULL,
	`date` date NOT NULL,
	`agent` enum('CLAUDE','CODEX') NOT NULL,
	`tokens` bigint NOT NULL DEFAULT 0,
	`jobsCompleted` int NOT NULL DEFAULT 0,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `DevJobDailyUsage_userId_date_agent_key` UNIQUE(`userId`,`date`,`agent`)
);

CREATE INDEX `DevContributionProfile_githubLogin_idx` ON `DevContributionProfile` (`githubLogin`);
CREATE INDEX `DevContributionProfile_createdAt_idx` ON `DevContributionProfile` (`createdAt`);
CREATE INDEX `DevJob_status_idx` ON `DevJob` (`status`);
CREATE INDEX `DevJob_jobType_refKind_refNumber_idx` ON `DevJob` (`jobType`,`refKind`,`refNumber`);
CREATE INDEX `DevJob_claimedByUserId_idx` ON `DevJob` (`claimedByUserId`);
CREATE INDEX `DevJob_createdAt_idx` ON `DevJob` (`createdAt`);