ALTER TABLE `UserVote` ADD `topRankinGames` boolean DEFAULT false NOT NULL;
ALTER TABLE `UserVote` ADD `topRankinGamesVoteId` varchar(128);