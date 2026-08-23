ALTER TABLE `UserData` ADD `avatarFacing` enum('left','right') DEFAULT 'left' NOT NULL;--> statement-breakpoint

-- Seed `avatarFacing` for the AIs whose artwork points right.
--
-- The new column defaults to 'left', which is how the overwhelming majority of
-- the roster is drawn (front-on art included — mirroring a head-on portrait is
-- visually inert, so it only has to be right for the clear side profiles). Every
-- distinct AI avatar in production was reviewed image by image; the ones below
-- are the 28 that face the other way, and combat mirrors them when the opponent
-- they are looking at stands on the other side of the battlefield.
--
-- Matched on the image rather than on userId so the fix follows the artwork: any
-- environment, and any AI later pointed at one of these images, lands on the same
-- value. Re-running is a no-op.

UPDATE `UserData` SET `avatarFacing` = 'right'
WHERE `isAi` = 1 AND `avatar` IN (
  'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJ0aATGMgrYldRWJcD6vE10SjNsXHeA9pVMfQi', -- Riptide Adept
  'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJ1WSpPs6bo95WClq4K0wxZUmJcvThgdVenO3P', -- Riku Boltcarver
  'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJ5vgNkS797jl4ubX8xrRqTZasyMp2WA5eLGUP', -- Maelstrom Adept
  'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJ5yTk0I797jl4ubX8xrRqTZasyMp2WA5eLGUP', -- Tatarigami
  'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJ8ysK4Skkp45TvAnoIBa0rtCf1lbyXYjVKQ2q', -- Kuro Ironwall
  'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJCUEyMc26OYrIJuNP1pvSyz29edFtKbngjRcA', -- Haname Saito “Petal Fist”
  'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJCzpaSI26OYrIJuNP1pvSyz29edFtKbngjRcA', -- Death's Maw
  'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJDy5UXLzEwoh0WXMnscL279N8ayVQUCbRzS3p', -- OctiKameá - Placeholder
  'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJPN7B1pKeUGyX2kj6u45AOQiSa1zYH0mqZocJ', -- Fuu Windreaver
  'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJQ6XoLxjhzBPya1rwfCIqOTU0cV5xgsMeo3u2', -- Trialblade Renegade
  'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJQlrDhU3jhzBPya1rwfCIqOTU0cV5xgsMeo3u', -- Dark Wolf
  'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJS19MfS3jWrEB7TyZlmpoAxMK5Qi16kNPVJuH', -- White Wolf
  'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJaqUUu9YYfKMcJ2B5EmWt6VsNgqxpG8OSXAQk', -- The Banshee
  'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJbhcuIUAtYUndMi56GkX19q0A4PzyeIloBrEa', -- Saurus Guard
  'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJeCUDpgPyV3OvUJQExAi0bGoIZDF74LqSnHRd', -- Takao “Ash Fang” Inoue
  'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJggQnnGcU9cpECTimBdjaqbNn7vQsxGR1wLk4', -- The Grinch who stole taverns Cheer
  'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJhTBtHCMfUBdnwAX5LTajlNc4mrgzi0RJtqpM', -- Spiral Dust Adept
  'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJhUiTLUVMfUBdnwAX5LTajlNc4mrgzi0RJtqp', -- Hana Fireghost
  'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJjcBYxV4XzPI8f1v96qBot0Q3wsUp2nxu7SMb', -- AI Loadout: Default Rotation
  'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJlIfMjIrWYxAsuC7ofQn9pM45OD0ERqkdBXJU', -- Mōmoku Inoshishi - Placeholder
  'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJmjUCFbaHE4IMO5Goa7cgLxPJ0VC6lU8vbt1A', -- Howler
  'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJn6rMwDmojJ0EqeDCvBrNmZaXVdY97gSpOWiA', -- Yuki Threadbinder
  'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJq8gh5NdkOZgJQ8mGRcdx3SsWvPelyYFTt5Vn', -- Noctyrr Eight Tails
  'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJqR5kHrdkOZgJQ8mGRcdx3SsWvPelyYFTt5Vn', -- Hellfire Hound
  'https://utfs.io/f/78245356-1c49-4dc1-9c1b-c3e43b6081ea-btb8ux.webp', -- Violent Outlaw
  'https://utfs.io/f/82e63c11-b118-4399-800b-7cee75237ba4-tug4zt.webp', -- Tor Tor
  'https://utfs.io/f/Hzww9EQvYURJFNtNLQG2iOewJtjGzvNcmEX3TBnoSfMDZPH4', -- Werewolf
  'https://utfs.io/f/Hzww9EQvYURJVpf5f6F2veAXohUuE59nTQHRJIYjtiG18aF4' -- Kazehiko
);
