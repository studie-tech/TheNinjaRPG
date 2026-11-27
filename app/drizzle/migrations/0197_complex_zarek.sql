ALTER TABLE `UserVote` ADD `topRankinGames` boolean DEFAULT false NOT NULL;
ALTER TABLE `UserVote` ADD `topRankinGamesVoteId` varchar(128);
ALTER TABLE `UserVote` ADD `topRankinGamesVotedAt` datetime(3);