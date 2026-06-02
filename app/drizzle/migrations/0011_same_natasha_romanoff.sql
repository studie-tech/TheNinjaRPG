CREATE TABLE `ActionQueue` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`queueType` enum('JUTSU','STAT','CRAFT') NOT NULL,
	`position` int NOT NULL,
	`jutsuId` varchar(191),
	`stat` enum('ninjutsuOffence','taijutsuOffence','genjutsuOffence','bukijutsuOffence','ninjutsuDefence','taijutsuDefence','genjutsuDefence','bukijutsuDefence','intelligence','speed','willpower','strength'),
	`itemId` varchar(191),
	`quantity` int NOT NULL DEFAULT 1,
	`targetLevel` int,
	`moneyCost` int,
	`queuedMaterialRefunds` json,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `ActionQueue_id` PRIMARY KEY(`id`)
);

CREATE INDEX `ActionQueue_userId_idx` ON `ActionQueue` (`userId`);
CREATE INDEX `ActionQueue_userId_queueType_position_idx` ON `ActionQueue` (`userId`,`queueType`,`position`);
