CREATE TABLE `AccountDeletion` (
	`appleRevokedSubject` varchar(191),
	`userId` varchar(191) NOT NULL,
	`phase` enum('QUEUED','IDENTITY_DELETED','COMPLETE') NOT NULL DEFAULT 'QUEUED',
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`nextAttemptAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`leaseId` varchar(191),
	`leaseUntil` datetime(3),
	`attempts` int NOT NULL DEFAULT 0,
	`completedAt` datetime(3),
	CONSTRAINT `AccountDeletion_userId` PRIMARY KEY(`userId`)
);

CREATE INDEX `AccountDeletion_pending_idx` ON `AccountDeletion` (`phase`,`nextAttemptAt`);