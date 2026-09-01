CREATE TABLE `StoreUserIdAlias` (
	`oldUserId` varchar(191) NOT NULL,
	`newUserId` varchar(191) NOT NULL,
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `StoreUserIdAlias_oldUserId` PRIMARY KEY(`oldUserId`)
);
