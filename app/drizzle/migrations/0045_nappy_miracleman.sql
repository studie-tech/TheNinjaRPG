CREATE TABLE `GuideArticle` (
	`id` varchar(191) NOT NULL,
	`slug` varchar(191) NOT NULL,
	`title` varchar(191) NOT NULL,
	`subtitle` varchar(255),
	`excerpt` text,
	`seoTitle` varchar(80),
	`seoDescription` varchar(180),
	`category` enum('getting-started','combat','world','villages','bloodlines','farming','economy','ranks','reference') NOT NULL,
	`content` mediumtext NOT NULL,
	`image` varchar(512),
	`faq` json,
	`sortOrder` int NOT NULL DEFAULT 0,
	`published` boolean NOT NULL DEFAULT false,
	`relatedBloodlineId` varchar(191),
	`relatedItemId` varchar(191),
	`relatedJutsuId` varchar(191),
	`sourceUrl` varchar(512),
	`reviewNotes` text,
	`updatedByUserId` varchar(191),
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `GuideArticle_id` PRIMARY KEY(`id`),
	CONSTRAINT `GuideArticle_slug_key` UNIQUE(`slug`)
);

CREATE INDEX `GuideArticle_category_published_idx` ON `GuideArticle` (`category`,`published`);
CREATE INDEX `GuideArticle_published_idx` ON `GuideArticle` (`published`);