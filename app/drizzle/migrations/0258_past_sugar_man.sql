DROP TABLE `GameRule`;
ALTER TABLE `UserData` DROP INDEX `UserData_userId_key`;
CREATE INDEX `HistoricalAvatar_status_idx` ON `HistoricalAvatar` (`status`);