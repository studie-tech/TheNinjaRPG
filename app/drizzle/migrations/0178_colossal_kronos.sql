ALTER TABLE `UserData`
  DROP INDEX `UserData_isAi_updatedAt_idx`,
  ADD INDEX `UserData_isAi_updatedAt_idx` (`isAi`, `updatedAt` DESC, `username`, `lastIp`);
