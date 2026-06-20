CREATE TABLE `UserActivityQueue` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`type` enum('STAT','JUTSU','CRAFT') NOT NULL,
	`status` enum('QUEUED','CANCELLED','COMPLETED') NOT NULL DEFAULT 'QUEUED',
	`position` int NOT NULL,
	`stat` enum('ninjutsuOffence','taijutsuOffence','genjutsuOffence','bukijutsuOffence','ninjutsuDefence','taijutsuDefence','genjutsuDefence','bukijutsuDefence','intelligence','speed','willpower','strength'),
	`jutsuId` varchar(191),
	`itemId` varchar(191),
	`quantity` int NOT NULL DEFAULT 1,
	`moneyPaid` int NOT NULL DEFAULT 0,
	`materialsPaid` json,
	`costBasisLevel` int,
	`targetLevel` int,
	`trainTimeMs` int,
	`trainingSpeed` enum('15min','1hr','4hrs','8hrs','12hrs','24hrs'),
	`craftSeconds` int,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `UserActivityQueue_id` PRIMARY KEY(`id`),
	CONSTRAINT `UserActivityQueue_userId_type_position_key` UNIQUE(`userId`,`type`,`position`)
);

CREATE INDEX `UserActivityQueue_userId_type_status_idx` ON `UserActivityQueue` (`userId`,`type`,`status`);
CREATE INDEX `UserActivityQueue_type_status_userId_idx` ON `UserActivityQueue` (`type`,`status`,`userId`);
CREATE INDEX `UserActivityQueue_userId_idx` ON `UserActivityQueue` (`userId`);