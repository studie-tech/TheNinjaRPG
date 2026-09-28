DROP INDEX `VisitorLog_ip_utmSource_idx` ON `VisitorLog`;
ALTER TABLE `VisitorLog` MODIFY COLUMN `ip` varchar(191);
ALTER TABLE `AbEvent` ADD `ipHash` varchar(64);
ALTER TABLE `HistoricalIp` ADD `ipHash` varchar(64);
ALTER TABLE `VisitorLog` ADD `ipHash` varchar(64);
ALTER TABLE `AbEvent` ADD CONSTRAINT `AbEvent_experiment_event_ipHash_key` UNIQUE(`experiment`,`event`,`ipHash`);
ALTER TABLE `VisitorLog` ADD CONSTRAINT `VisitorLog_ipHash_key` UNIQUE(`ipHash`);
CREATE INDEX `HistoricalIp_ipHash_idx` ON `HistoricalIp` (`ipHash`);
CREATE INDEX `VisitorLog_ipHash_utmSource_idx` ON `VisitorLog` (`ipHash`,`utmSource`);