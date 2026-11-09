CREATE TABLE `ResourceSilo` (
	`id` varchar(191) NOT NULL,
	`entries` json NOT NULL,
	`updatedAt` datetime(3) NOT NULL,
	CONSTRAINT `ResourceSilo_id` PRIMARY KEY(`id`)
);

ALTER TABLE `UserData` ADD `resourceSiloProgress` json;
ALTER TABLE `UserData` ADD `warTornRespawn` boolean DEFAULT false NOT NULL;