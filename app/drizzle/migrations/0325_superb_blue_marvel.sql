CREATE TABLE `ActivityStreakConfig` (
	`id` varchar(191) NOT NULL,
	`name` varchar(191) NOT NULL,
	`description` text,
	`image` varchar(500),
	`totalDays` int NOT NULL DEFAULT 14,
	`streakType` enum('RECURRING','EVENT_PASS') NOT NULL DEFAULT 'RECURRING',
	`isActive` boolean NOT NULL DEFAULT true,
	`ryoCost` int NOT NULL DEFAULT 0,
	`repsCost` int NOT NULL DEFAULT 0,
	`seichiSilverCost` int NOT NULL DEFAULT 0,
	`startDate` datetime(3),
	`endDate` datetime(3),
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`createdByUserId` varchar(191),
	CONSTRAINT `ActivityStreakConfig_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ActivityStreakReward` (
	`id` varchar(191) NOT NULL,
	`configId` varchar(191) NOT NULL,
	`dayNumber` int NOT NULL,
	`rewards` json NOT NULL,
	`image` varchar(500),
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `ActivityStreakReward_id` PRIMARY KEY(`id`),
	CONSTRAINT `ActivityStreakReward_configId_dayNumber_key` UNIQUE(`configId`,`dayNumber`)
);

CREATE TABLE `UserStreakProgress` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`configId` varchar(191) NOT NULL,
	`currentDay` int NOT NULL DEFAULT 0,
	`lastClaimDate` datetime(3),
	`startedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `UserStreakProgress_id` PRIMARY KEY(`id`),
	CONSTRAINT `UserStreakProgress_userId_configId_key` UNIQUE(`userId`,`configId`)
);

CREATE INDEX `ActivityStreakReward_configId_idx` ON `ActivityStreakReward` (`configId`);
CREATE INDEX `ActivityStreakReward_dayNumber_idx` ON `ActivityStreakReward` (`dayNumber`);
CREATE INDEX `UserStreakProgress_userId_idx` ON `UserStreakProgress` (`userId`);
CREATE INDEX `UserStreakProgress_configId_idx` ON `UserStreakProgress` (`configId`);
ALTER TABLE `UserData` DROP COLUMN `activityStreak`;


INSERT INTO `ActivityStreakConfig` (`id`, `name`, `description`, `image`, `totalDays`, `streakType`, `isActive`, `ryoCost`, `repsCost`, `seichiSilverCost`, `startDate`, `endDate`, `createdByUserId`)
VALUES ('streak-config-recurring', 'Daily Login Streak', 'Claim daily rewards for logging in! Rewards increase each day. Special bonuses every 7 days.', NULL, 14, 'RECURRING', true, 0, 0, 0, NULL, NULL, NULL);

-- Day rewards (14 days total for recurring streak)
-- Formula: base ryo = day * 100, plus bonuses at milestones
INSERT INTO `ActivityStreakReward` (`id`, `configId`, `dayNumber`, `rewards`, `image`) VALUES
('streak-reward-day-01', 'streak-config-recurring', 1, '{"reward_money": 100, "reward_reputation": 0, "reward_hunting_experience": 0}', NULL),
('streak-reward-day-02', 'streak-config-recurring', 2, '{"reward_money": 200, "reward_reputation": 0, "reward_hunting_experience": 0}', NULL),
('streak-reward-day-03', 'streak-config-recurring', 3, '{"reward_money": 300, "reward_reputation": 0, "reward_hunting_experience": 0}', NULL),
('streak-reward-day-04', 'streak-config-recurring', 4, '{"reward_money": 400, "reward_reputation": 0, "reward_hunting_experience": 0}', NULL),
('streak-reward-day-05', 'streak-config-recurring', 5, '{"reward_money": 500, "reward_reputation": 0, "reward_hunting_experience": 0}', NULL),
('streak-reward-day-06', 'streak-config-recurring', 6, '{"reward_money": 600, "reward_reputation": 0, "reward_hunting_experience": 0}', NULL),
('streak-reward-day-07', 'streak-config-recurring', 7, '{"reward_money": 700, "reward_reputation": 0, "reward_hunting_experience": 350}', NULL),
('streak-reward-day-08', 'streak-config-recurring', 8, '{"reward_money": 800, "reward_reputation": 0, "reward_hunting_experience": 0}', NULL),
('streak-reward-day-09', 'streak-config-recurring', 9, '{"reward_money": 900, "reward_reputation": 0, "reward_hunting_experience": 0}', NULL),
('streak-reward-day-10', 'streak-config-recurring', 10, '{"reward_money": 1000, "reward_reputation": 1, "reward_hunting_experience": 0}', NULL),
('streak-reward-day-11', 'streak-config-recurring', 11, '{"reward_money": 1100, "reward_reputation": 0, "reward_hunting_experience": 0}', NULL),
('streak-reward-day-12', 'streak-config-recurring', 12, '{"reward_money": 1200, "reward_reputation": 0, "reward_hunting_experience": 0}', NULL),
('streak-reward-day-13', 'streak-config-recurring', 13, '{"reward_money": 1300, "reward_reputation": 0, "reward_hunting_experience": 0}', NULL),
('streak-reward-day-14', 'streak-config-recurring', 14, '{"reward_money": 1400, "reward_reputation": 0, "reward_hunting_experience": 350}', NULL);
