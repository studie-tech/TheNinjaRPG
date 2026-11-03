CREATE TABLE `CombatSharedCooldown` (
	`tag` varchar(191) NOT NULL,
	`rounds` int NOT NULL,
	CONSTRAINT `CombatSharedCooldown_tag` PRIMARY KEY(`tag`)
);

INSERT INTO `CombatSharedCooldown` (`tag`, `rounds`) VALUES
('barrier', 3),
('buffprevent', 3),
('cleanse', 3),
('cleanseprevent', 3),
('clear', 3),
('clearprevent', 3),
('consume', 3),
('siphon', 3),
('debuffprevent', 3),
('drain', 3),
('increasepoolcost', 3),
('moveprevent', 3),
('pierce', 3),
('poison', 3),
('seal', 3),
('stun', 3),
('summon', 3),
('vamp', 3);

UPDATE `Battle` SET `extraState` = JSON_SET(COALESCE(`extraState`, JSON_OBJECT()), '$.sharedCooldowns', JSON_OBJECT('barrier', 3, 'buffprevent', 3, 'cleanse', 3, 'cleanseprevent', 3, 'clear', 3, 'clearprevent', 3, 'consume', 3, 'siphon', 3, 'debuffprevent', 3, 'drain', 3, 'increasepoolcost', 3, 'moveprevent', 3, 'pierce', 3, 'poison', 3, 'seal', 3, 'stun', 3, 'summon', 3, 'vamp', 3)) WHERE JSON_EXTRACT(`extraState`, '$.sharedCooldowns') IS NULL;

CREATE TABLE `JutsuEquipLimit` (
	`category` varchar(191) NOT NULL,
	`unrankedMaxEquipped` int,
	`rankedMaxEquipped` int,
	CONSTRAINT `JutsuEquipLimit_category` PRIMARY KEY(`category`)
);

INSERT INTO `JutsuEquipLimit` (`category`, `unrankedMaxEquipped`, `rankedMaxEquipped`) VALUES
('residual', 4, 4),
('event', 2, 2),
('forbidden', 1, 1),
('barrier', 1, 1),
('stun', 2, 2),
('shield', 2, 2),
('heal', 3, 3),
('parry', 1, 1),
('poison', NULL, 1),
('increasepoolcost', NULL, 1),
('summon', NULL, 0);
