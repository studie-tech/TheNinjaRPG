ALTER TABLE `BattleHistory` ADD `attackerOutcome` enum('Won','Lost','Draw','Fled');
ALTER TABLE `BattleHistory` ADD `defenderOutcome` enum('Won','Lost','Draw','Fled');