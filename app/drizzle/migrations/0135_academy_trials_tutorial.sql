-- The starter quest becomes "The Academy Trials", the storyline the onboarding
-- tutorial walks through. Every objective now stands for something the player
-- does, and each grants the experience for the next level, so the tutorial's
-- level-ups are earned rather than handed out:
--
--   eHayd  dialog                  accept the trials                   0 XP
--   tArna  arena_kills 1           beat the Academy Dummy            500 XP  -> level 2
--   tJtsu  train_specific_jutsu    learn Sonic Slash               1,000 XP  -> level 3
--   tBrf1  dialog                  briefing: the missing pup           0 XP
--   _nY7o  defeat_opponents        calm the pup in sector 227      1,500 XP  -> level 4
--   tSnct  dialog                  hand the pup to the Bondkeepers     0 XP
--   tuQde  dialog                  graduation debrief                  0 XP
--   tGnin  new_quest               starts Road to Genin
--   fsyYJ  win_quest               quest reward                    2,000 XP  -> level 5
--
-- New characters start with no unassigned experience (register.ts), so these
-- rewards add up to exactly the level-5 requirement of Road to Genin. The
-- existing objective ids are kept: trackers reconcile against the live content
-- on every update, and a player who started under the previous chain keeps the
-- path recorded in their tracker (the tutorial treats objectives that path
-- skipped as passed). The sanctuary hand-over is a dialog rather than a
-- location objective: structure positions are staff-editable per sector, and
-- the tutorial reaches the sanctuary through Wake Island's village page.
-- Guarded on the previous four-objective shape, so it is idempotent.

UPDATE `Quest`
SET
  `name` = 'The Academy Trials',
  `description` = 'Pass the Academy Trials to graduate: win your first fight, learn your first jutsu and complete a real field mission.',
  `successDescription` = 'You passed the Academy Trials. Your Road to Genin begins on Wake Island.',
  `content` = JSON_SET(
    `content`,
    '$.objectives', CAST('[{"structureAssetId":"","locationName":"","locationDescription":"","structureScale":1,"id":"eHayd","description":"Welcome to the academy! Before you can graduate as a Genin you must pass the Academy Trials: prove yourself in the arena, learn your first jutsu, and complete a real field mission. I will be with you every step of the way.","successDescription":"","nextObjectiveId":[{"text":"I''m ready, Sensei!","nextObjectiveId":"tArna"}],"sceneBackground":"HJLTJ1RGIhR0g-QztlCQF","sceneCharacters":[],"reward_hunter_items":false,"reward_hunter_items_ids":[],"reward_gathering_items":false,"reward_gathering_items_ids":[],"reward_seichi_silver":0,"reward_money":0,"reward_clanpoints":0,"reward_anbupoints":0,"reward_exp":0,"reward_tokens":0,"reward_prestige":0,"reward_reputation":0,"reward_skillpoints":0,"reward_rank":"NONE","reward_village_membership":"NONE","reward_items":[],"reward_jutsus":[],"reward_bloodlines":[],"reward_sage_modes":[],"reward_badges":[],"reward_titles":[],"reward_medical_experience":0,"reward_hunting_experience":0,"reward_crafting_experience":0,"reward_gathering_experience":0,"reward_sage_mastery_experience":0,"reward_war_damage":0,"reward_war_healing":0,"attackers":[],"attackers_scaled_to_user":false,"attackers_scale_gains":1,"attackers_max_per_battle":1,"task":"dialog","image":""},{"structureAssetId":"","locationName":"","locationDescription":"","structureScale":1,"id":"tArna","description":"Defeat the Academy Dummy in the Battle Arena.","successDescription":"First trial passed: you won your first fight.","nextObjectiveId":"tJtsu","sceneBackground":"HJLTJ1RGIhR0g-QztlCQF","sceneCharacters":[],"task":"arena_kills","durationSeconds":60,"value":1,"reward_hunter_items":false,"reward_hunter_items_ids":[],"reward_gathering_items":false,"reward_gathering_items_ids":[],"reward_seichi_silver":0,"reward_money":0,"reward_clanpoints":0,"reward_anbupoints":0,"reward_exp":500,"reward_tokens":0,"reward_prestige":0,"reward_reputation":0,"reward_skillpoints":0,"reward_rank":"NONE","reward_village_membership":"NONE","reward_items":[],"reward_jutsus":[],"reward_bloodlines":[],"reward_sage_modes":[],"reward_badges":[],"reward_titles":[],"reward_medical_experience":0,"reward_hunting_experience":0,"reward_crafting_experience":0,"reward_gathering_experience":0,"reward_sage_mastery_experience":0,"reward_war_damage":0,"reward_war_healing":0,"attackers":[],"attackers_scaled_to_user":false,"attackers_scale_gains":1,"attackers_max_per_battle":1},{"structureAssetId":"","locationName":"","locationDescription":"","structureScale":1,"id":"tJtsu","description":"Learn Sonic Slash at the Training Grounds.","successDescription":"Second trial passed: you learned your first jutsu.","nextObjectiveId":"tBrf1","sceneBackground":"HJLTJ1RGIhR0g-QztlCQF","sceneCharacters":[],"task":"train_specific_jutsu","trainJutsuIds":["clh4d6pxd0006tb0h4y1yudi5"],"masteryType":"None","value":1,"reward_hunter_items":false,"reward_hunter_items_ids":[],"reward_gathering_items":false,"reward_gathering_items_ids":[],"reward_seichi_silver":0,"reward_money":0,"reward_clanpoints":0,"reward_anbupoints":0,"reward_exp":1000,"reward_tokens":0,"reward_prestige":0,"reward_reputation":0,"reward_skillpoints":0,"reward_rank":"NONE","reward_village_membership":"NONE","reward_items":[],"reward_jutsus":[],"reward_bloodlines":[],"reward_sage_modes":[],"reward_badges":[],"reward_titles":[],"reward_medical_experience":0,"reward_hunting_experience":0,"reward_crafting_experience":0,"reward_gathering_experience":0,"reward_sage_mastery_experience":0,"reward_war_damage":0,"reward_war_healing":0},{"structureAssetId":"","locationName":"","locationDescription":"","structureScale":1,"id":"tBrf1","description":"Last night a violet flash lit up the eastern ridge, and a pup from the Bondkeeper Sanctuary on Wake Island bolted in fright. It is out there alone and scared. Your final trial: track it down and bring it back safely.","successDescription":"","nextObjectiveId":[{"text":"I''ll find it.","nextObjectiveId":"_nY7o"}],"sceneBackground":"HJLTJ1RGIhR0g-QztlCQF","sceneCharacters":[],"reward_hunter_items":false,"reward_hunter_items_ids":[],"reward_gathering_items":false,"reward_gathering_items_ids":[],"reward_seichi_silver":0,"reward_money":0,"reward_clanpoints":0,"reward_anbupoints":0,"reward_exp":0,"reward_tokens":0,"reward_prestige":0,"reward_reputation":0,"reward_skillpoints":0,"reward_rank":"NONE","reward_village_membership":"NONE","reward_items":[],"reward_jutsus":[],"reward_bloodlines":[],"reward_sage_modes":[],"reward_badges":[],"reward_titles":[],"reward_medical_experience":0,"reward_hunting_experience":0,"reward_crafting_experience":0,"reward_gathering_experience":0,"reward_sage_mastery_experience":0,"reward_war_damage":0,"reward_war_healing":0,"attackers":[],"attackers_scaled_to_user":false,"attackers_scale_gains":1,"attackers_max_per_battle":1,"task":"dialog","image":""},{"structureAssetId":"","locationName":"","locationDescription":"","structureScale":1,"id":"_nY7o","description":"Find the frightened pup on the eastern ridge and calm it down.","successDescription":"The pup calms down. Caught in its collar is a sliver of dark metal, threaded with faint violet veins.","nextObjectiveId":"tSnct","sceneBackground":"HJLTJ1RGIhR0g-QztlCQF","sceneCharacters":[],"sector":227,"longitude":9,"latitude":6,"opponent_scaled_to_user":false,"completionOutcome":"Win","failDescription":"The pup got the better of you. Rest up and try again.","fleeDescription":"You fled from the pup.","drawDescription":"The fight with the pup ended in a draw.","scaleGains":1,"keepOriginalPools":false,"applyBuffs":[],"applyDebuffs":[],"task":"defeat_opponents","allyAIs":[],"opponentAIs":[{"ids":["clik9wpb0000009l606opg0zj"],"number":1,"quantity":1}],"sectorType":"specific","locationType":"specific","sectorList":[],"hideLocation":false,"completed":0,"image":"https://utfs.io/f/Hzww9EQvYURJQlUWhATjhzBPya1rwfCIqOTU0cV5xgsMeo3u","reward_hunter_items":false,"reward_hunter_items_ids":[],"reward_gathering_items":false,"reward_gathering_items_ids":[],"reward_seichi_silver":0,"reward_money":0,"reward_clanpoints":0,"reward_anbupoints":0,"reward_exp":1500,"reward_tokens":0,"reward_prestige":0,"reward_reputation":0,"reward_skillpoints":0,"reward_rank":"NONE","reward_village_membership":"NONE","reward_items":[],"reward_jutsus":[],"reward_bloodlines":[],"reward_sage_modes":[],"reward_badges":[],"reward_titles":[],"reward_medical_experience":0,"reward_hunting_experience":0,"reward_crafting_experience":0,"reward_gathering_experience":0,"reward_sage_mastery_experience":0,"reward_war_damage":0,"reward_war_healing":0,"attackers":[],"attackers_scaled_to_user":false,"attackers_scale_gains":1,"attackers_max_per_battle":1},{"structureAssetId":"","locationName":"","locationDescription":"","structureScale":1,"id":"tSnct","description":"Wake Island, the Bondkeeper Sanctuary. The Bondkeepers rush out to meet you, and the pup bounds straight into their arms. Their elder bows low: you brought one of ours home, let us repay the kindness.","successDescription":"","nextObjectiveId":[{"text":"Hand over the pup","nextObjectiveId":"tuQde"}],"sceneBackground":"HJLTJ1RGIhR0g-QztlCQF","sceneCharacters":[],"reward_hunter_items":false,"reward_hunter_items_ids":[],"reward_gathering_items":false,"reward_gathering_items_ids":[],"reward_seichi_silver":0,"reward_money":0,"reward_clanpoints":0,"reward_anbupoints":0,"reward_exp":0,"reward_tokens":0,"reward_prestige":0,"reward_reputation":0,"reward_skillpoints":0,"reward_rank":"NONE","reward_village_membership":"NONE","reward_items":[],"reward_jutsus":[],"reward_bloodlines":[],"reward_sage_modes":[],"reward_badges":[],"reward_titles":[],"reward_medical_experience":0,"reward_hunting_experience":0,"reward_crafting_experience":0,"reward_gathering_experience":0,"reward_sage_mastery_experience":0,"reward_war_damage":0,"reward_war_healing":0,"attackers":[],"attackers_scaled_to_user":false,"attackers_scale_gains":1,"attackers_max_per_battle":1,"task":"dialog","image":""},{"structureAssetId":"","locationName":"","locationDescription":"","structureScale":1,"id":"tuQde","description":"You did well out there, better than most graduates. That metal in the pup''s collar... show it to no one; I will take it to the academy archives myself. You have earned your graduation.","successDescription":"","nextObjectiveId":[{"text":"Thank you, Sensei.","nextObjectiveId":"tGnin"}],"sceneBackground":"HJLTJ1RGIhR0g-QztlCQF","sceneCharacters":[],"reward_hunter_items":false,"reward_hunter_items_ids":[],"reward_gathering_items":false,"reward_gathering_items_ids":[],"reward_seichi_silver":0,"reward_money":0,"reward_clanpoints":0,"reward_anbupoints":0,"reward_exp":0,"reward_tokens":0,"reward_prestige":0,"reward_reputation":0,"reward_skillpoints":0,"reward_rank":"NONE","reward_village_membership":"NONE","reward_items":[],"reward_jutsus":[],"reward_bloodlines":[],"reward_sage_modes":[],"reward_badges":[],"reward_titles":[],"reward_medical_experience":0,"reward_hunting_experience":0,"reward_crafting_experience":0,"reward_gathering_experience":0,"reward_sage_mastery_experience":0,"reward_war_damage":0,"reward_war_healing":0,"attackers":[],"attackers_scaled_to_user":false,"attackers_scale_gains":1,"attackers_max_per_battle":1,"task":"dialog","image":""},{"structureAssetId":"","locationName":"","locationDescription":"","structureScale":1,"id":"tGnin","description":"Your Road to Genin begins.","successDescription":"","nextObjectiveId":"fsyYJ","sceneBackground":"HJLTJ1RGIhR0g-QztlCQF","sceneCharacters":[],"task":"new_quest","newQuestIds":["9-t1rNWEzXbIfdUfxWrny"],"reward_hunter_items":false,"reward_hunter_items_ids":[],"reward_gathering_items":false,"reward_gathering_items_ids":[],"reward_seichi_silver":0,"reward_money":0,"reward_clanpoints":0,"reward_anbupoints":0,"reward_exp":0,"reward_tokens":0,"reward_prestige":0,"reward_reputation":0,"reward_skillpoints":0,"reward_rank":"NONE","reward_village_membership":"NONE","reward_items":[],"reward_jutsus":[],"reward_bloodlines":[],"reward_sage_modes":[],"reward_badges":[],"reward_titles":[],"reward_medical_experience":0,"reward_hunting_experience":0,"reward_crafting_experience":0,"reward_gathering_experience":0,"reward_sage_mastery_experience":0,"reward_war_damage":0,"reward_war_healing":0},{"structureAssetId":"","locationName":"","locationDescription":"","structureScale":1,"id":"fsyYJ","description":"","successDescription":"","sceneBackground":"HJLTJ1RGIhR0g-QztlCQF","sceneCharacters":[],"task":"win_quest","reward_hunter_items":false,"reward_hunter_items_ids":[],"reward_gathering_items":false,"reward_gathering_items_ids":[],"reward_seichi_silver":0,"reward_money":0,"reward_clanpoints":0,"reward_anbupoints":0,"reward_exp":0,"reward_tokens":0,"reward_prestige":0,"reward_reputation":0,"reward_skillpoints":0,"reward_rank":"NONE","reward_village_membership":"NONE","reward_items":[],"reward_jutsus":[],"reward_bloodlines":[],"reward_sage_modes":[],"reward_badges":[],"reward_titles":[],"reward_medical_experience":0,"reward_hunting_experience":0,"reward_crafting_experience":0,"reward_gathering_experience":0,"reward_sage_mastery_experience":0,"reward_war_damage":0,"reward_war_healing":0}]' AS JSON),
    -- Lemu's dialogs keep the scene character the live content already uses.
    '$.objectives[0].sceneCharacters', JSON_EXTRACT(`content`, '$.objectives[0].sceneCharacters'),
    '$.objectives[3].sceneCharacters', JSON_EXTRACT(`content`, '$.objectives[0].sceneCharacters'),
    '$.objectives[6].sceneCharacters', JSON_EXTRACT(`content`, '$.objectives[2].sceneCharacters'),
    '$.reward.reward_exp', 2000
  )
WHERE `id` = 'eYDVpL63vPhK3lywMexdv'
  AND JSON_LENGTH(`content`, '$.objectives') = 4
  AND JSON_UNQUOTE(JSON_EXTRACT(`content`, '$.objectives[1].id')) = '_nY7o';

-- UserData.tutorialStep is an index into TUTORIAL_STEPS, which went from 52 to
-- 48 steps. Players part-way through the old tutorial move to the closest
-- lesson of the new one; the tutorial then skips any step whose starter-quest
-- objective is already behind them.
--
--   old 1-20   before accepting the old starter dialog -> 0  student-welcome
--   old 21-26  dialog accepted, mission not started    -> 26 mission-open-travel
--   old 27     global travel to the pup                -> 27 mission-travel-to-pup
--   old 28     capture the pup                         -> 28 mission-find-pup
--   old 29-30  pup beaten, debrief pending             -> 38 genin-debrief
--   old 31-99  starter quest finished                  -> 48 finished
--
-- 100+ marks provisioned test accounts and is left alone. This remaps indexes,
-- so it must run exactly once (the migration journal guarantees that).

UPDATE `UserData`
SET `tutorialStep` = CASE
  WHEN `tutorialStep` <= 20 THEN 0
  WHEN `tutorialStep` <= 26 THEN 26
  WHEN `tutorialStep` = 27 THEN 27
  WHEN `tutorialStep` = 28 THEN 28
  WHEN `tutorialStep` <= 30 THEN 38
  ELSE 48
END
WHERE `tutorialStep` > 0
  AND `tutorialStep` < 100;

-- The Academy Dummy is the tutorial's first, hand-guided fight, which a new
-- student now takes on at level 1 with untrained stats. At 100 health that
-- costs dozens of basic attacks -- more stamina than a student has -- so the
-- dummy gets a training dummy's health: two or three turns of moving,
-- attacking and ending the turn. Guarded on the current value; the dummy is
-- an arena-only template that no other content references.

UPDATE `UserData`
SET `maxHealth` = 16, `curHealth` = 16
WHERE `userId` = 'ICXb49Z0Jle3GyJ-rosTi'
  AND `isAi` = 1
  AND `maxHealth` = 100;

-- Road to Genin takes a student from the Academy Trials to their own village.
-- Many players who started it never finished: they lost the exam marker on
-- Wake Island, dropped out across eleven screens of tour and village lore, or
-- did everything and then waited at the level 5 gate, which sat last in the
-- objective list and so was only asked for at the very end.
--
-- The chain becomes: reach level 5 -> walk to the exam in Wake Island's
-- Administration Building -> one screen on the island's buildings (carrying
-- the tour's 5,000 experience) -> choose a village, with all five described on
-- the choice itself -> report to the new village's mission hall -> win. The
-- level gate moves to the front of the list. The five village lore dialogs and
-- four tour dialogs are dropped; a player part-way through them has the tour
-- answer reset (trackers drop a selection whose objective no longer exists)
-- and answers the new screen.
--
-- Locations come from the world itself rather than fixed numbers: the exam
-- and its dialogs stand at Wake Island's Administration Building, and each
-- mission-hall objective at its own village's Mission Hall, in that village's
-- sector. Trackers already holding a location keep it.
--
-- The objective positions are checked first, so content edited since is left
-- alone.

UPDATE `Quest`
SET
  `description` = 'Sit the Genin exam on Wake Island, choose the village you will serve, and report to its mission hall to receive your headband.',
  `content` = JSON_SET(
  `content`,
  '$.objectives',
  JSON_ARRAY(
    JSON_MERGE_PATCH(JSON_EXTRACT(`content`, '$.objectives[24]'), CAST('{"description": "Only students of level 5 may sit the Genin exam. Earn experience in the arena, at the training grounds and on missions, assign it on your profile, then level up."}' AS JSON)),
    JSON_SET(JSON_MERGE_PATCH(JSON_EXTRACT(`content`, '$.objectives[0]'), CAST('{"description": "The Genin exam is held in the <b>Administration Building</b> on <b>Wake Island</b>, the neutral island every village shares. Travel there and walk to the exam marker."}' AS JSON)), '$.longitude', COALESCE((SELECT s.`longitude` FROM `VillageStructure` s JOIN `Village` v ON v.`id` = s.`villageId` WHERE v.`name` = 'Wake Island' AND s.`route` = '/adminbuilding'), JSON_EXTRACT(`content`, '$.objectives[0].longitude')), '$.latitude', COALESCE((SELECT s.`latitude` FROM `VillageStructure` s JOIN `Village` v ON v.`id` = s.`villageId` WHERE v.`name` = 'Wake Island' AND s.`route` = '/adminbuilding'), JSON_EXTRACT(`content`, '$.objectives[0].latitude'))),
    JSON_SET(JSON_MERGE_PATCH(JSON_EXTRACT(`content`, '$.objectives[1]'), CAST('{"description": "Welcome to Wake Island. Every village meets here, so you will return often: this <b>Administration Building</b> runs events, the <b>Anbu HQ</b> hands out story quests, the <b>Souvenir Shop</b> sells event items, the <b>Colosseum</b> lets you watch fights across the world, and the <b>Science Building</b> runs bloodline checks that unlock stronger bloodlines as you grow. You have proven yourself ready for the Genin rank. One question remains: where will you serve?", "nextObjectiveId": [{"text": "Choose my village", "nextObjectiveId": "mgzw_"}], "reward_exp": 5000}' AS JSON)), '$.longitude', COALESCE((SELECT s.`longitude` FROM `VillageStructure` s JOIN `Village` v ON v.`id` = s.`villageId` WHERE v.`name` = 'Wake Island' AND s.`route` = '/adminbuilding'), JSON_EXTRACT(`content`, '$.objectives[1].longitude')), '$.latitude', COALESCE((SELECT s.`latitude` FROM `VillageStructure` s JOIN `Village` v ON v.`id` = s.`villageId` WHERE v.`name` = 'Wake Island' AND s.`route` = '/adminbuilding'), JSON_EXTRACT(`content`, '$.objectives[1].latitude'))),
    JSON_SET(JSON_MERGE_PATCH(JSON_EXTRACT(`content`, '$.objectives[12]'), CAST('{"description": "Five great shinobi villages stand in Seichi. Each worships a deity, fights with an element and guards a village bloodline.<br/><b>Akikaze</b>, the Hidden Wind Village: Fujin, god of wind, and the dust bloodline Aerathiel.<br/><b>Hyorin</b>, the Hidden Ice Village: Okami, and the ice bloodline Hyouga Yui.<br/><b>Akasumi</b>, the Hidden Storm Village: Watatsumi, and the storm bloodline Arashima.<br/><b>Shirohana</b>, the Sun Village of the desert: Amaterasu, and the scorch bloodline Taiyo Kami.<br/><b>Tsukimori</b>, the Moon Forest Village: Tsukiyomi, and the wood bloodline Shinseina Ki.<br/>Which will you call home?"}' AS JSON)), '$.longitude', COALESCE((SELECT s.`longitude` FROM `VillageStructure` s JOIN `Village` v ON v.`id` = s.`villageId` WHERE v.`name` = 'Wake Island' AND s.`route` = '/adminbuilding'), JSON_EXTRACT(`content`, '$.objectives[12].longitude')), '$.latitude', COALESCE((SELECT s.`latitude` FROM `VillageStructure` s JOIN `Village` v ON v.`id` = s.`villageId` WHERE v.`name` = 'Wake Island' AND s.`route` = '/adminbuilding'), JSON_EXTRACT(`content`, '$.objectives[12].latitude'))),
    JSON_SET(JSON_MERGE_PATCH(JSON_EXTRACT(`content`, '$.objectives[13]'), CAST('{"description": "Welcome to Akikaze, the Hidden Wind Village. Your new home is expecting you: travel there and report to its mission hall.", "nextObjectiveId": [{"text": "Travel home", "nextObjectiveId": "pBq1F"}]}' AS JSON)), '$.longitude', COALESCE((SELECT s.`longitude` FROM `VillageStructure` s JOIN `Village` v ON v.`id` = s.`villageId` WHERE v.`name` = 'Wake Island' AND s.`route` = '/adminbuilding'), JSON_EXTRACT(`content`, '$.objectives[13].longitude')), '$.latitude', COALESCE((SELECT s.`latitude` FROM `VillageStructure` s JOIN `Village` v ON v.`id` = s.`villageId` WHERE v.`name` = 'Wake Island' AND s.`route` = '/adminbuilding'), JSON_EXTRACT(`content`, '$.objectives[13].latitude'))),
    JSON_SET(JSON_MERGE_PATCH(JSON_EXTRACT(`content`, '$.objectives[14]'), CAST('{"description": "Welcome to Hyorin, the Hidden Ice Village. Your new home is expecting you: travel there and report to its mission hall.", "nextObjectiveId": [{"text": "Travel home", "nextObjectiveId": "k3Joa"}]}' AS JSON)), '$.longitude', COALESCE((SELECT s.`longitude` FROM `VillageStructure` s JOIN `Village` v ON v.`id` = s.`villageId` WHERE v.`name` = 'Wake Island' AND s.`route` = '/adminbuilding'), JSON_EXTRACT(`content`, '$.objectives[14].longitude')), '$.latitude', COALESCE((SELECT s.`latitude` FROM `VillageStructure` s JOIN `Village` v ON v.`id` = s.`villageId` WHERE v.`name` = 'Wake Island' AND s.`route` = '/adminbuilding'), JSON_EXTRACT(`content`, '$.objectives[14].latitude'))),
    JSON_SET(JSON_MERGE_PATCH(JSON_EXTRACT(`content`, '$.objectives[15]'), CAST('{"description": "Welcome to Akasumi, the Hidden Storm Village. Your new home is expecting you: travel there and report to its mission hall.", "nextObjectiveId": [{"text": "Travel home", "nextObjectiveId": "lhFP_"}]}' AS JSON)), '$.longitude', COALESCE((SELECT s.`longitude` FROM `VillageStructure` s JOIN `Village` v ON v.`id` = s.`villageId` WHERE v.`name` = 'Wake Island' AND s.`route` = '/adminbuilding'), JSON_EXTRACT(`content`, '$.objectives[15].longitude')), '$.latitude', COALESCE((SELECT s.`latitude` FROM `VillageStructure` s JOIN `Village` v ON v.`id` = s.`villageId` WHERE v.`name` = 'Wake Island' AND s.`route` = '/adminbuilding'), JSON_EXTRACT(`content`, '$.objectives[15].latitude'))),
    JSON_MERGE_PATCH(JSON_EXTRACT(`content`, '$.objectives[22]'), CAST('{"description": "Welcome to Shirohana, the Sun Village. Your new home is expecting you: travel there and report to its mission hall.", "nextObjectiveId": [{"text": "Travel home", "nextObjectiveId": "dHuAY"}]}' AS JSON)),
    JSON_MERGE_PATCH(JSON_EXTRACT(`content`, '$.objectives[23]'), CAST('{"description": "Welcome to Tsukimori, the Moon Forest Village. Your new home is expecting you: travel there and report to its mission hall.", "nextObjectiveId": [{"text": "Travel home", "nextObjectiveId": "IhGF0"}]}' AS JSON)),
    JSON_SET(JSON_SET(JSON_MERGE_PATCH(JSON_EXTRACT(`content`, '$.objectives[16]'), CAST('{"description": "Report to your village''s mission hall at the marker, where your Genin headband is waiting."}' AS JSON)), '$.sector', COALESCE((SELECT `sector` FROM `Village` WHERE `name` = 'Akikaze'), JSON_EXTRACT(`content`, '$.objectives[16].sector'))), '$.longitude', COALESCE((SELECT s.`longitude` FROM `VillageStructure` s JOIN `Village` v ON v.`id` = s.`villageId` WHERE v.`name` = 'Akikaze' AND s.`route` = '/missionhall'), JSON_EXTRACT(`content`, '$.objectives[16].longitude')), '$.latitude', COALESCE((SELECT s.`latitude` FROM `VillageStructure` s JOIN `Village` v ON v.`id` = s.`villageId` WHERE v.`name` = 'Akikaze' AND s.`route` = '/missionhall'), JSON_EXTRACT(`content`, '$.objectives[16].latitude'))),
    JSON_SET(JSON_SET(JSON_MERGE_PATCH(JSON_EXTRACT(`content`, '$.objectives[19]'), CAST('{"description": "Report to your village''s mission hall at the marker, where your Genin headband is waiting."}' AS JSON)), '$.sector', COALESCE((SELECT `sector` FROM `Village` WHERE `name` = 'Hyorin'), JSON_EXTRACT(`content`, '$.objectives[19].sector'))), '$.longitude', COALESCE((SELECT s.`longitude` FROM `VillageStructure` s JOIN `Village` v ON v.`id` = s.`villageId` WHERE v.`name` = 'Hyorin' AND s.`route` = '/missionhall'), JSON_EXTRACT(`content`, '$.objectives[19].longitude')), '$.latitude', COALESCE((SELECT s.`latitude` FROM `VillageStructure` s JOIN `Village` v ON v.`id` = s.`villageId` WHERE v.`name` = 'Hyorin' AND s.`route` = '/missionhall'), JSON_EXTRACT(`content`, '$.objectives[19].latitude'))),
    JSON_SET(JSON_SET(JSON_MERGE_PATCH(JSON_EXTRACT(`content`, '$.objectives[20]'), CAST('{"description": "Report to your village''s mission hall at the marker, where your Genin headband is waiting."}' AS JSON)), '$.sector', COALESCE((SELECT `sector` FROM `Village` WHERE `name` = 'Akasumi'), JSON_EXTRACT(`content`, '$.objectives[20].sector'))), '$.longitude', COALESCE((SELECT s.`longitude` FROM `VillageStructure` s JOIN `Village` v ON v.`id` = s.`villageId` WHERE v.`name` = 'Akasumi' AND s.`route` = '/missionhall'), JSON_EXTRACT(`content`, '$.objectives[20].longitude')), '$.latitude', COALESCE((SELECT s.`latitude` FROM `VillageStructure` s JOIN `Village` v ON v.`id` = s.`villageId` WHERE v.`name` = 'Akasumi' AND s.`route` = '/missionhall'), JSON_EXTRACT(`content`, '$.objectives[20].latitude'))),
    JSON_SET(JSON_SET(JSON_MERGE_PATCH(JSON_EXTRACT(`content`, '$.objectives[17]'), CAST('{"description": "Report to your village''s mission hall at the marker, where your Genin headband is waiting."}' AS JSON)), '$.sector', COALESCE((SELECT `sector` FROM `Village` WHERE `name` = 'Shirohana'), JSON_EXTRACT(`content`, '$.objectives[17].sector'))), '$.longitude', COALESCE((SELECT s.`longitude` FROM `VillageStructure` s JOIN `Village` v ON v.`id` = s.`villageId` WHERE v.`name` = 'Shirohana' AND s.`route` = '/missionhall'), JSON_EXTRACT(`content`, '$.objectives[17].longitude')), '$.latitude', COALESCE((SELECT s.`latitude` FROM `VillageStructure` s JOIN `Village` v ON v.`id` = s.`villageId` WHERE v.`name` = 'Shirohana' AND s.`route` = '/missionhall'), JSON_EXTRACT(`content`, '$.objectives[17].latitude'))),
    JSON_SET(JSON_SET(JSON_MERGE_PATCH(JSON_EXTRACT(`content`, '$.objectives[18]'), CAST('{"description": "Report to your village''s mission hall at the marker, where your Genin headband is waiting."}' AS JSON)), '$.sector', COALESCE((SELECT `sector` FROM `Village` WHERE `name` = 'Tsukimori'), JSON_EXTRACT(`content`, '$.objectives[18].sector'))), '$.longitude', COALESCE((SELECT s.`longitude` FROM `VillageStructure` s JOIN `Village` v ON v.`id` = s.`villageId` WHERE v.`name` = 'Tsukimori' AND s.`route` = '/missionhall'), JSON_EXTRACT(`content`, '$.objectives[18].longitude')), '$.latitude', COALESCE((SELECT s.`latitude` FROM `VillageStructure` s JOIN `Village` v ON v.`id` = s.`villageId` WHERE v.`name` = 'Tsukimori' AND s.`route` = '/missionhall'), JSON_EXTRACT(`content`, '$.objectives[18].latitude'))),
    JSON_EXTRACT(`content`, '$.objectives[21]')
  )
  )
WHERE `id` = '9-t1rNWEzXbIfdUfxWrny'
  AND JSON_LENGTH(`content`, '$.objectives') = 25
  AND JSON_UNQUOTE(JSON_EXTRACT(`content`, '$.objectives[0].id')) = 'mKVnH'
  AND JSON_UNQUOTE(JSON_EXTRACT(`content`, '$.objectives[1].id')) = 'tFTYj'
  AND JSON_UNQUOTE(JSON_EXTRACT(`content`, '$.objectives[12].id')) = 'mgzw_'
  AND JSON_UNQUOTE(JSON_EXTRACT(`content`, '$.objectives[13].id')) = 'x1IVl'
  AND JSON_UNQUOTE(JSON_EXTRACT(`content`, '$.objectives[14].id')) = 'WmDyh'
  AND JSON_UNQUOTE(JSON_EXTRACT(`content`, '$.objectives[15].id')) = 'xAiqy'
  AND JSON_UNQUOTE(JSON_EXTRACT(`content`, '$.objectives[16].id')) = 'pBq1F'
  AND JSON_UNQUOTE(JSON_EXTRACT(`content`, '$.objectives[17].id')) = 'dHuAY'
  AND JSON_UNQUOTE(JSON_EXTRACT(`content`, '$.objectives[18].id')) = 'IhGF0'
  AND JSON_UNQUOTE(JSON_EXTRACT(`content`, '$.objectives[19].id')) = 'k3Joa'
  AND JSON_UNQUOTE(JSON_EXTRACT(`content`, '$.objectives[20].id')) = 'lhFP_'
  AND JSON_UNQUOTE(JSON_EXTRACT(`content`, '$.objectives[21].id')) = '_l-eW'
  AND JSON_UNQUOTE(JSON_EXTRACT(`content`, '$.objectives[22].id')) = '8Eksk'
  AND JSON_UNQUOTE(JSON_EXTRACT(`content`, '$.objectives[23].id')) = 'VAYLT'
  AND JSON_UNQUOTE(JSON_EXTRACT(`content`, '$.objectives[24].id')) = 'lG3__';
