ALTER TABLE `AnbuSquad` ADD `memberCount` int DEFAULT 0 NOT NULL;
UPDATE `AnbuSquad` AS squad
SET squad.memberCount = (
  SELECT COUNT(*)
  FROM `UserData` AS member
  WHERE member.anbuId = squad.id
);
ALTER TABLE `UserRequest` ADD `pendingAnbuSenderId` varchar(191) GENERATED ALWAYS AS (CASE WHEN `type` = 'ANBU' AND `status` = 'PENDING' THEN `senderId` ELSE NULL END) STORED;
ALTER TABLE `UserRequest` ADD CONSTRAINT `UserRequest_pending_anbu_sender_unique` UNIQUE(`pendingAnbuSenderId`);
