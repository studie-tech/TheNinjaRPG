CREATE TABLE `CannedResponse` (
	`id` varchar(191) NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text NOT NULL,
	`createdByUserId` varchar(191) NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `CannedResponse_id` PRIMARY KEY(`id`)
);

CREATE TABLE `SupportTicket` (
	`id` varchar(191) NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text NOT NULL,
	`category` enum('BUG_REPORT','FEATURE_REQUEST','ACCOUNT_ISSUE','GAMEPLAY_QUESTION','PAYMENT_ISSUE','TECHNICAL_SUPPORT','OTHER') NOT NULL,
	`priority` enum('LOW','MEDIUM','HIGH','URGENT') NOT NULL DEFAULT 'MEDIUM',
	`status` enum('OPEN','IN_PROGRESS','WAITING_FOR_USER','WAITING_FOR_STAFF','RESOLVED','CLOSED') NOT NULL DEFAULT 'OPEN',
	`isPublic` boolean NOT NULL DEFAULT false,
	`tags` json NOT NULL DEFAULT ('[]'),
	`conversationId` varchar(191) NOT NULL,
	`createdByUserId` varchar(191) NOT NULL,
	`assignedToUserId` varchar(191),
	`githubIssueUrl` varchar(500),
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`closedAt` datetime(3),
	CONSTRAINT `SupportTicket_id` PRIMARY KEY(`id`)
);

CREATE TABLE `SupportTicketActivity` (
	`id` varchar(191) NOT NULL,
	`ticketId` varchar(191) NOT NULL,
	`authorId` varchar(191) NOT NULL,
	`action` enum('CREATED','UPDATED','ASSIGNED','UNASSIGNED','STATUS_CHANGED','PRIORITY_CHANGED','CATEGORY_CHANGED','TAGGED','UNTAGGED','MERGED','ESCALATED_TO_GITHUB','COMMENTED','CLOSED','REOPENED') NOT NULL,
	`oldValue` text,
	`newValue` text,
	`metadata` json NOT NULL DEFAULT ('{}'),
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `SupportTicketActivity_id` PRIMARY KEY(`id`)
);

ALTER TABLE `Conversation` ADD `isStaffAvailable` boolean DEFAULT false NOT NULL;
ALTER TABLE `ConversationComment` ADD `isStaffOnly` boolean DEFAULT false NOT NULL;
CREATE INDEX `CannedResponse_createdByUserId_idx` ON `CannedResponse` (`createdByUserId`);
CREATE INDEX `CannedResponse_title_idx` ON `CannedResponse` (`title`);
CREATE INDEX `SupportTicket_createdByUserId_idx` ON `SupportTicket` (`createdByUserId`);
CREATE INDEX `SupportTicket_assignedToUserId_idx` ON `SupportTicket` (`assignedToUserId`);
CREATE INDEX `SupportTicket_status_idx` ON `SupportTicket` (`status`);
CREATE INDEX `SupportTicket_category_idx` ON `SupportTicket` (`category`);
CREATE INDEX `SupportTicket_priority_idx` ON `SupportTicket` (`priority`);
CREATE INDEX `SupportTicket_isPublic_idx` ON `SupportTicket` (`isPublic`);
CREATE INDEX `SupportTicket_createdAt_idx` ON `SupportTicket` (`createdAt`);
CREATE INDEX `SupportTicketActivity_ticketId_idx` ON `SupportTicketActivity` (`ticketId`);
CREATE INDEX `SupportTicketActivity_authorId_idx` ON `SupportTicketActivity` (`authorId`);
CREATE INDEX `SupportTicketActivity_action_idx` ON `SupportTicketActivity` (`action`);
CREATE INDEX `SupportTicketActivity_createdAt_idx` ON `SupportTicketActivity` (`createdAt`);