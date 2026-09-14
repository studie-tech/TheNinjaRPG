-- Guide articles are seeded insert-once, so rows already in production keep whatever the
-- seed wrote at the time. Two data fixes that the code changes alone cannot reach:

-- The per-item farming stubs (one generated page per seed or herb) went live at ~450
-- characters each. Their content now lives in one table on the farming hub, sourced from
-- item data, and the generator seeds new ones unpublished. Retire the ones that exist.
UPDATE `GuideArticle` SET `published` = 0 WHERE `category` = 'farming' AND `relatedItemId` IS NOT NULL;

-- The travel article was overwritten in the editor down to a 55-character body under a
-- different title. The full text is still in libs/guide/articles.ts; unpublish this row
-- until it is restored.
UPDATE `GuideArticle` SET `published` = 0 WHERE `slug` = 'world';

-- Bloodline descriptions were generated before the article helper knew letter grades are
-- read by name, so they say "a A-rank" and "a S-rank" in the description, excerpt and body.
UPDATE `GuideArticle` SET `seoDescription` = REPLACE(`seoDescription`, ' is a A-rank', ' is an A-rank'), `excerpt` = REPLACE(`excerpt`, ' is a A-rank', ' is an A-rank'), `content` = REPLACE(`content`, ' is a A-rank', ' is an A-rank') WHERE `category` = 'bloodlines';
UPDATE `GuideArticle` SET `seoDescription` = REPLACE(`seoDescription`, ' is a S-rank', ' is an S-rank'), `excerpt` = REPLACE(`excerpt`, ' is a S-rank', ' is an S-rank'), `content` = REPLACE(`content`, ' is a S-rank', ' is an S-rank') WHERE `category` = 'bloodlines';
UPDATE `GuideArticle` SET `seoDescription` = REPLACE(`seoDescription`, ' is a H-rank', ' is an H-rank'), `excerpt` = REPLACE(`excerpt`, ' is a H-rank', ' is an H-rank'), `content` = REPLACE(`content`, ' is a H-rank', ' is an H-rank') WHERE `category` = 'bloodlines';
