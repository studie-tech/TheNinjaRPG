-- Existing players remain pending for the first daily run; future accounts start current.
ALTER TABLE `UserData` ADD `dailyCountersResetAt` datetime(3) DEFAULT '1970-01-01 00:00:00.000' NOT NULL;
ALTER TABLE `UserData` ADD `tavernDecayAt` datetime(3) DEFAULT '1970-01-01 00:00:00.000' NOT NULL;
ALTER TABLE `UserData` ALTER COLUMN `dailyCountersResetAt` SET DEFAULT (CURRENT_TIMESTAMP(3));
ALTER TABLE `UserData` ALTER COLUMN `tavernDecayAt` SET DEFAULT (CURRENT_TIMESTAMP(3));
