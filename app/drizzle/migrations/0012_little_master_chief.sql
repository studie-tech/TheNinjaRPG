ALTER TABLE `AbEvent` DROP INDEX `AbEvent_event_ip_key`;
ALTER TABLE `UserData` ADD `buttonSfxOn` boolean DEFAULT true NOT NULL;
CREATE UNIQUE INDEX `AbEvent_experiment_event_ip_key` ON `AbEvent` (`experiment`,`event`,`ip`);
