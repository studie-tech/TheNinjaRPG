ALTER TABLE `UserDevice` ADD `widgetToken` varchar(191);
ALTER TABLE `UserDevice` ADD CONSTRAINT `UserDevice_widgetToken_key` UNIQUE(`widgetToken`);