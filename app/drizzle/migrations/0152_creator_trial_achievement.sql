-- God-mode has its own achievement receipt, independent of killing the creator's account.
INSERT INTO `Badge` (`id`, `name`, `image`, `description`) VALUES (
  'creator-trial-badge',
  'Shut Down the Creator',
  'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJM57yD1tsO4cexqW2RDgkE3zZbNXSFGitmnar',
  'Fought through all five of the creator''s robot forms and shut down God-mode.'
)
ON DUPLICATE KEY UPDATE `id` = `Badge`.`id`;

INSERT INTO `Quest` (
  `id`, `name`, `image`, `description`, `successDescription`, `questType`,
  `consecutiveObjectives`, `content`
) SELECT
  'creator-trial-achievement',
  'Shut Down the Creator',
  `image`,
  'Defeat Terriator''s God-mode at the end of the creator''s trial.',
  'You shut down the creator''s God-mode!',
  'achievement',
  FALSE,
  JSON_OBJECT(
    'reward', JSON_OBJECT(),
    'sceneBackground', '',
    'sceneCharacters', JSON_ARRAY(),
    'objectives', JSON_ARRAY(JSON_OBJECT(
      'id', 'creator-trial-god-mode',
      'task', 'defeat_opponents',
      'description', 'Defeat Terriator''s God-mode at the end of the creator''s trial.',
      'successDescription', 'You shut down the creator''s God-mode!',
      'opponentAIs', JSON_ARRAY(JSON_OBJECT('ids', JSON_ARRAY('creator-trial-elite'), 'number', 1)),
      'completionOutcome', 'Win',
      'reward_rank', 'NONE',
      'reward_village_membership', 'NONE',
      'reward_badges', JSON_ARRAY('creator-trial-badge')
    ))
  )
FROM `Badge` WHERE `id` = 'creator-trial-badge'
ON DUPLICATE KEY UPDATE `id` = `Quest`.`id`;

-- Preserve the original achievement's other rewards and all player completion history.
UPDATE `Quest`
SET `content` = JSON_REMOVE(
  `content`,
  JSON_UNQUOTE(JSON_SEARCH(`content`, 'one', 'creator-trial-badge', NULL, '$.objectives[*].reward_badges[*]'))
)
WHERE `id` = 'g2ilVOzFys21wkEHwfTeE'
  AND JSON_SEARCH(`content`, 'one', 'creator-trial-badge', NULL, '$.objectives[*].reward_badges[*]') IS NOT NULL;
