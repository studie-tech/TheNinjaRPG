-- Recalculate health, chakra, and stamina values for all users based on new HP_PER_LVL = 100, SP_PER_LVL = 100, CP_PER_LVL = 100
-- Health Formula: 100 + 100 * (level - 1)
-- Chakra Formula: 100 + 100 * (level - 1) 
-- Stamina Formula: 100 + 100 * (level - 1)
UPDATE UserData 
SET 
  maxHealth = 100 + 100 * (level - 1),
  curHealth = 100 + 100 * (level - 1),
  maxChakra = 100 + 100 * (level - 1),
  curChakra = 100 + 100 * (level - 1),
  maxStamina = 100 + 100 * (level - 1),
  curStamina = 100 + 100 * (level - 1); 