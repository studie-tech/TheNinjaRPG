CREATE TABLE `StaffApplication` (
	`id` varchar(191) NOT NULL,
	`applicantUserId` varchar(191) NOT NULL,
	`targetRole` enum('USER','CODING-ADMIN','CONTENT-ADMIN','EVENT-ADMIN','MODERATOR-ADMIN','HEAD_MODERATOR','MODERATOR','JR_MODERATOR','CONTENT','EVENT','CODER') NOT NULL,
	`state` enum('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
	`conversationId` varchar(191) NOT NULL,
	`motivation` text,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `StaffApplication_id` PRIMARY KEY(`id`)
);

CREATE TABLE `StaffApplicationApproval` (
	`id` varchar(191) NOT NULL,
	`applicationId` varchar(191) NOT NULL,
	`approverUserId` varchar(191) NOT NULL,
	`group` enum('EVENT-ADMIN','CODING-ADMIN','MODERATOR-ADMIN','CONTENT-ADMIN') NOT NULL,
	`state` enum('APPROVED','REJECTED') NOT NULL DEFAULT 'APPROVED',
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `StaffApplicationApproval_id` PRIMARY KEY(`id`),
	CONSTRAINT `StaffApplicationApproval_applicationId_group_key` UNIQUE(`applicationId`,`group`),
	CONSTRAINT `StaffApplicationApproval_applicationId_approverUserId_key` UNIQUE(`applicationId`,`approverUserId`)
);

CREATE INDEX `StaffApplication_applicantUserId_idx` ON `StaffApplication` (`applicantUserId`);
CREATE INDEX `StaffApplication_targetRole_idx` ON `StaffApplication` (`targetRole`);
CREATE INDEX `StaffApplication_state_idx` ON `StaffApplication` (`state`);
CREATE INDEX `StaffApplication_createdAt_idx` ON `StaffApplication` (`createdAt`);
CREATE INDEX `StaffApplicationApproval_applicationId_idx` ON `StaffApplicationApproval` (`applicationId`);
CREATE INDEX `StaffApplicationApproval_approverUserId_idx` ON `StaffApplicationApproval` (`approverUserId`);