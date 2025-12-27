ALTER TABLE `ConceptImage` DROP INDEX `image_avatar_key`;
ALTER TABLE `ConceptImage` ADD `video` varchar(191);
ALTER TABLE `ConceptImage` ADD `mediaType` enum('image','video') DEFAULT 'image' NOT NULL;
ALTER TABLE `ConceptImage` ADD `replicateId` varchar(191);
ALTER TABLE `ConceptImage` ADD CONSTRAINT `concept_image_key` UNIQUE(`image`);