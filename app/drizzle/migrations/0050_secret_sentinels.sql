ALTER TABLE `AbEvent` DROP INDEX `AbEvent_experiment_event_ip_key`;
ALTER TABLE `VisitorLog` DROP INDEX `VisitorLog_ip_key`;
ALTER TABLE `VisitorLog` MODIFY COLUMN `ipHash` varchar(64) NOT NULL;
ALTER TABLE `AbEvent` DROP COLUMN `ip`;
ALTER TABLE `VisitorLog` DROP COLUMN `ip`;