-- Audited appearances live on content rows; runtime resolution does not depend on item IDs or names.
-- Fill unset fields only, preserving staff overrides and rows whose artwork changed after inspection.
-- Each statement is atomic and safe to rerun; no transaction or player inventory rewrite is required.

UPDATE `Item` AS content
INNER JOIN (
  SELECT '-3RGo2p8B62r1qisApV0N' AS `id`, 'headband' AS `profile`, 'blue' AS `color`, '86904ec401132eba4ad8584c96084c6f1b0245db847a9d64f5fccaf998dd18bb' AS `imageHash` -- Ocean Helmet
  UNION ALL SELECT '-6C6OtiodwTNgFq_XqwR-', 'NONE', 'gray', '1ac8b356c23d305777515eac744895b65a073a9307073bad07748b06812cdad4' -- Orichalcum Ore
  UNION ALL SELECT '-KTImEqOJe8hwrNgJtE23', 'gem', 'red', 'cd450bd308d9b08f2e3fa90df0d24b6460bf6c7935581dbcd838acd2369eabb5' -- Fire Crystal
  UNION ALL SELECT '-LzgdTM1yTjlezOyjd-6H', 'spear', 'brown', 'ec47d9f4721896dd0013ba9959b35a5864b13a857fb6ea34b5f5e9036da207dc' -- Gaea's Embrace
  UNION ALL SELECT '-P3I5O8R5mS2PgQFDI8Hr', 'NONE', 'gray', '8e6c74b06f15f6132ee41604c6ef0a9e746ac9a130b7712e93291c8990300c97' -- Wedding Ring
  UNION ALL SELECT '-PmDx8m7gXcvFv4NWDDdk', 'NONE', 'gray', '2fd6b2c78bbbcf667eefe523e699e9d11e7db36c7f63e87fac96ed22f73d83cf' -- Crystalized Sand
  UNION ALL SELECT '-XBh4SQ8UKNRzumAv0EMk', 'leather', 'red', '2007a0d3b50a717ba19e47e76f43107c5b80cfeb44489e21153f059cf091e72d' -- Elite Flak Jacket
  UNION ALL SELECT '-aPdG6xiuQdQyRzJczUTZ', 'NONE', 'gray', 'd77d8377f48c81faf904878d33a8e135eed2e40de4661d068aad39c1a29a5994' -- Etched Stone Tablet
  UNION ALL SELECT '-ozDPxS4YAuHYB92RPLe2', 'NONE', 'gray', '687ef1b6ae5939dc0d2ca383701575ddfbab970247ebfeefd6fe9e83422129e9' -- Kappa's Bubble
  UNION ALL SELECT '-qVND9J0r_tkDi7ZdRaCC', 'NONE', 'gray', '75f753ec07fb847e623d0ab07298ea76f291f5c0588e746261ac4a6724fcc3f1' -- Scroll of Bastion
  UNION ALL SELECT '-v1OQ5QSsWbV-DcZadM0h', 'NONE', 'gray', '3e0b18a277fc0560148a1e5bd2b0ec8ca95f1b5722f2f84776308cdeff414fb2' -- Rusted Hunter's Chest
  UNION ALL SELECT '-w097M1JDuAmTRxxlCHKw', 'NONE', 'gray', 'fc865ea7b68278d13ff577e06f1b974c21c16636df336a1471c6bec67970b4e1' -- The Sea-King's Hoard
  UNION ALL SELECT '-zm5azFgRg2P1fPbo9122', 'belt', 'brown', '2fd51874708907b9afa5424269a22066ad84293449976d7c00df7d4c3da9b783' -- Element Belt
  UNION ALL SELECT '05hx4hI0I4L2vAME8CcZu', 'NONE', 'gray', '49d48f0d665ca49d4ff658c436d8ef8f0efbb62ee026180ab565937e1e7152c9' -- Rare Jewels
  UNION ALL SELECT '08MhQuN8iHBG4u0UUmpFi', 'NONE', 'gray', '6c5482c1512e17fec64877c434434fc3ad59bf540f2f7dfe88efe2f2b0699185' -- Parade of A Thousand Demons
  UNION ALL SELECT '0B6U_HcjyM2wGwWW9gGxx', 'cloak', 'black', 'c9d538bbf9aee9cff62eb4b374eb11c8d5f954494f837065df762c6088e1e06a' -- Duskborne Shroud
  UNION ALL SELECT '0BeRbkWe4fkBJcUfvTlbk', 'NONE', 'gray', 'f4cf4f3ffc1537bc33a685376a310f65edd90a641e6666bea838476cfb84e48d' -- Infernum
  UNION ALL SELECT '0Fv7BAW-zD_Qghlvt8Q_C', 'NONE', 'gray', '844b92f2e3aa53dee7142a2f5bd811d516fa6a99e597609223db9bd023c9d67f' -- Jutsu Inject Test
  UNION ALL SELECT '0HNCGP5J-s21Bk7Ec1bne', 'headband', 'black', '64cece1ff962046024af3033b6e5d278636c54e4f7159829c44932650e08ea8a' -- Element Hat
  UNION ALL SELECT '0IEz0j74jcA9l2_dvibiA', 'NONE', 'gray', 'f13b269029917d6306966347ba7cbc0cfeb68997d923d10a1b736b1a726b4d9e' -- Milk
  UNION ALL SELECT '0bDMWIfvoOAJPzh3oo1FB', 'NONE', 'gray', 'c8866f94ba57d76cdac4de4d08b8d6bda27d53b93449d0beb1a98172f3a9f3db' -- Giant Potato
  UNION ALL SELECT '0b_Wg_CAiFfb8FMtTB7Pm', 'NONE', 'gray', '91465f577d73480efcbf191f2ac03d71c6a6514033bacdd743dcc1a0e0b0647f' -- Kitsune Egg
  UNION ALL SELECT '0i6qx2sCKB-AStosx9hrr', 'NONE', 'gray', 'c6064f727c1849d3ba9129536176ce6f1fce4064e664910a40e9d808c0c09491' -- Dragon Egg
  UNION ALL SELECT '0j4znEj9HCl0lKIW_9BP7', 'NONE', 'gray', 'ed896768d5099d8ad3ee940e1e0f9cbf984cd037f6d0685ae51d4897a399b1bf' -- Genin Supply Cache
  UNION ALL SELECT '0kg56hRM_kAAasFvtFvIe', 'NONE', 'gray', '551d238ab88efaa7a19e1f7f3868cb51c3492a991e0a795c7d0fa48088408be5' -- Inheritance Blueprint
  UNION ALL SELECT '0sWF2coQ8lu6ggJaZy6ng', 'NONE', 'gray', 'd5b05c9cffbc2ee9a18066b738ff688fd92accb92638dd51b2e2162f58d1ea65' -- Legendary Jutsu Scroll
  UNION ALL SELECT '0v3JwIlqi9zteO3yXybgD', 'belt', 'red', 'fdfd16d9348834ab23050420a8729918efbbcfb162e67ae2b665d27eeb887468' -- Crimson Dragon Spine
  UNION ALL SELECT '1-SrHnw1BOYhjIwjjc6_8', 'armarmour', 'brown', 'f0fbb24bc61183a4b9ba3a5cb329c536ae3a7ef1f7f63b8c73736520bb3cf346' -- Radiant Guards
  UNION ALL SELECT '10vZ2figC-z0zljtC66YB', 'NONE', 'gray', '4a4e872da05ce7c4b05ac2b749234ccac74fe679324b421651adab14482103f5' -- 𝚆𝚑𝚒𝚜𝚙𝚎𝚛𝚎𝚍 𝙴𝚖𝚋𝚎𝚛
  UNION ALL SELECT '1DPP7Vjq2rq8dctP1XX1N', 'necklace', 'gold', '42392323e83db3d0d94d278bfed169bc38277c3aa008d2b77f3deb4f75e74184' -- Sealed Amulet of Pride
  UNION ALL SELECT '1DWceGdXyfQe93Xunxu4q', 'NONE', 'gray', 'e81cee2af8812034af8ca8feb63c98d71f822138a2e3f451ab3545accbccd1ba' -- Zephyr Seed
  UNION ALL SELECT '1FQ3NWrgKoLp1VEuq5utN', 'NONE', 'gray', '0c8ab277222d1b1783a82d02257f86809c7b4e171a0e94f9a29f1d6cfed9eebe' -- Old Scroll from the Black Stone
  UNION ALL SELECT '1GmiQAGuBZZsjIFqcqPkR', 'sword', 'red', 'abe713c5e61bf9620d15e6623508debd6c09469674ddba9895e0f9e8a4fc2272' -- Flaming Sword
  UNION ALL SELECT '1PpHMQYQ2EAzL0vueQb9E', 'NONE', 'gray', 'c8f207aba54420b6524bdb4af4cc20ce00dca341d481245486a877f3310b7c62' -- Cracked Auditory Core
  UNION ALL SELECT '1_PW5i1WTz1LBQMnOvFP4', 'armarmour', 'green', '70fd725dc0ea791138ad74b058967feeb8b57a55c0554812f0e5e8b9a79b4ce2' -- Kendo Guards
  UNION ALL SELECT '1bBM6YI3muUFDPAj0HmuT', 'NONE', 'gray', '1add57faa6e0b7c236e47903817a4f2dcd6d26488839580fd3b25c00c2da8604' -- Staff Booster
  UNION ALL SELECT '1gomcoHP7Jc7olDkfeVmG', 'NONE', 'gray', '51756ce76273c54b00eb3508ead00306c044c5f964c59a9294ba8f1f337ff8e7' -- Sealed Binding Script
  UNION ALL SELECT '1oM7py92Ox5jfMJeoIYUs', 'pants', 'black', 'd9115f288ff06a571bbce8f9751dcbdbcc58070fb6fb096b1d0c846ded37db7b' -- Desolation Legging
  UNION ALL SELECT '1ovHq7jsGdut2fSNKs5q_', 'NONE', 'gray', '7f6ab79d0363337538decdab8fe6cf4d3948e08bfdb216220c642d781e6b14b6' -- Repair Kit
  UNION ALL SELECT '1rOv-F4_-DXXT6YNlqi05', 'necklace', 'purple', 'e67626bedbd56035920c677bfe7dc1c9eed44e956a91dcae210faf9f5b8db356' -- Wind Binds
  UNION ALL SELECT '1ujZnbrdlRtZUjIuOJHmM', 'NONE', 'gray', 'ad9f4b21f5246b29f90242fb426c64baf301f7dd4660877fe1a8b45c0a965b45' -- Fortify Crystal I
  UNION ALL SELECT '1wJsQWvK2L0fhziIE4gnA', 'necklace', 'red', '0453df8b9960a743085c7a0b5c923f6b7dfc3f049c0ec92254b52c8a23481c76' -- Wraith Pendant
  UNION ALL SELECT '1ztmAEEuO6nEUko-sdDEo', 'NONE', 'gray', 'b616915082bd365698161cdabd4cfb980da4c3fa98d5d1e5671d5a9facf24b3c' -- Pizza box
  UNION ALL SELECT '29ijB0Njb1aPHrSag1ARI', 'NONE', 'gray', '3d51214a96ae00a0cf1894d87116c7f3d63298aeea97b4505b9eca6f28dad784' -- 1st Map piece
  UNION ALL SELECT '2EoxvVMtQjD73FKnHcMMX', 'NONE', 'gray', 'a8bcd9dccc17cb0887d75611021ef769671afe5019e991bcb97b5ef101683c09' -- Nightshade Thorn
  UNION ALL SELECT '2Js_5yjMYUW35T7eQ1fQU', 'NONE', 'gray', 'ca47b6bcac13129cbdb0edb6964bbac1bca9a67cc8c5ddf3a549c7383c7ebe5c' -- 2nd Map piece
  UNION ALL SELECT '2KQkU-IQR7DEHMrf1QJtP', 'NONE', 'gray', 'a332bf40c4476394ea30dc4386c0c15ee9e359d3eb835b2b1f1be5ab83998e90' -- Golden Sleigh Bell
  UNION ALL SELECT '2KzsaYIDMV2FPe_AMW02O', 'headband', 'red', 'd2e8df74d92143ab9ff100d9b7c89a6aca012b45d12da1bfa3d5782f5a4f0821' -- Brawler Helm
  UNION ALL SELECT '2LdMc6cJdw7oFC0V-xGiI', 'necklace', 'blue', '76b4507b90226842f957ddfbb7a59dd8f82ffb6d35b302ff96143fdb4c845438' -- Feint Charm
  UNION ALL SELECT '2M6XEQ_b5QjD360f3Sfsq', 'NONE', 'gray', '3d558454efb7c6ec86ce6e72c6c4be0355ffb80f421d5f923513e3f455a8845a' -- Godstorm Aegis Conduit
  UNION ALL SELECT '2MX-6qR99lkJ0SjUFDUZ2', 'NONE', 'gray', 'aa200ae24a842a93e3f96b0d569aebce957bcf50cb19686aa377510e30a657ef' -- Pouch 3
  UNION ALL SELECT '2NKgQ_2v14xqZwvDOY8nj', 'NONE', 'gray', '4368401a173f98cb8ad934ffb4fd7011d59c99973e085f874d97497b202d839c' -- WaddleWaddle
  UNION ALL SELECT '2O4_T8R57Xm_QuZT07Uh2', 'NONE', 'gray', 'b1c6252311994abf3a321fb30a806af931cf61c52bac582a416059e7a1d89389' -- Honey-Roasted Plums
  UNION ALL SELECT '2Sd_ZbYerb5B6C55Y4VSc', 'NONE', 'gray', 'ee087b32a4046f3697b16ec6b4acbaa78b83d376e3d9079dbb762707f2552c74' -- Cowrie Shell of Swallows
  UNION ALL SELECT '2aF0gz4PIPOBrzyRIAMk8', 'sickle', 'purple', 'f9fada8a31d3e37aedef2a7a2ef92269c2158cc5c5bca0f6802b552441e28d65' -- Sabaku's Bite
  UNION ALL SELECT '2b6mde9fOg87cI0LKYx0t', 'NONE', 'gray', '1a0e1412dc417947226b5dcdaad654afd810912584d828f46816ae6a234ad56a' -- Susanoo Prayer Beads
  UNION ALL SELECT '2jpqjB_717KVG-GBcJl62', 'NONE', 'gray', '6f374c7c122fa0ea9c2b730fe6c39e887b447b48b1429855e93eaa719df66b54' -- Preserved Wooden Carving 
  UNION ALL SELECT '2lM7hCCqFE7Pf2VzujpH1', 'NONE', 'gray', 'a565efb8b0a6f4e86b2211e696001ca4cd92c90cc6c800ec4884801a5e412f63' -- Shield Crystal
  UNION ALL SELECT '2nXVUwlS4MPfauXrhsLYA', 'NONE', 'gray', '42306b7f9153ca1198b813766a622740fffbdae46971e30e0449473ef5b79527' -- Moonveil Moss
  UNION ALL SELECT '2u-e6gb1E8NoKEVOmHeAs', 'NONE', 'gray', '44844e5d375657f5de089736c086c94c19e50e75c4125810b606ac6fcba62534' -- Thread Core
  UNION ALL SELECT '3-M3atiLl9q0BMCWjWTP0', 'NONE', 'gray', '756c1e5bc78b43a4e667de1805b3e7b6e1c2fcfe9dec9f4acd33a5483525b29c' -- Aika's Love
  UNION ALL SELECT '32k2rXF6W-7gn_Fubp4kU', 'NONE', 'gray', '062f28c29ff4e27486ecd161508f5ada7598399b85ca78b585f764043934713a' -- Epic Hunter's Chest
  UNION ALL SELECT '37cwfQEY1ww0RglWYKUTO', 'NONE', 'gray', '25647412f8893a81dce78533e84fe805b13d81969eea3627ff57badd3554c2a2' -- Apple Pie
  UNION ALL SELECT '3EioEk3tLF0SzQTEZPsSm', 'dagger', 'blue', 'f0edb37f37c284fda9105d08a85680cdf1a4048b60678542681a4afb21d94dbb' -- Liquid Daggers
  UNION ALL SELECT '3QiLUMMQipEl_rtFoxwL3', 'NONE', 'gray', '6a51e8eed6369f9a8a08d7a80d808a91565517d8f0a7006aee40008fc494ea5c' -- Compensation Scroll
  UNION ALL SELECT '3mAbGP5KtirPztTKCRcmw', 'NONE', 'gray', '191940276ebbf4d61c52ae930a5690b0123e5d1f8c58ebb0dbeb3137bc472cf9' -- Bloodline Scroll
  UNION ALL SELECT '4-VstzmnYZVYFV7-sNta6', 'NONE', 'gray', '331a4e86f96858b281c82101b8d9bd31bd8ca2b708229f7c8dc0b247bca58504' -- Killer Clown Riddle 3
  UNION ALL SELECT '40XfVLwXWNof8i55IuDu1', 'NONE', 'gray', '767d88318c045c3fb50ab594fd528f69a032349c498bc73070c6c521575da95a' -- Tempest Heart
  UNION ALL SELECT '41lbhjo6EbeDY9ChPEkcE', 'gem', 'green', '6e672f984686ff146d236454bdf4f3fbe71acf31bef4c2b7666d5c06aa58877c' -- Wind Crystal
  UNION ALL SELECT '46qBtWx7swzJGRKbuQUpb', 'whip', 'blue', '69542b03e15bb67d4861eebdccc58c74053fcb048b08c841a4266155993d8e41' -- Cosmic Embrace
  UNION ALL SELECT '4C4Jt4ohyisINmNRmAxn5', 'robe', 'blue', '9ebd0f62030bb67294f64f0540d7ed51c44744383f8872796b736bd82eeac67e' -- Element Plate
  UNION ALL SELECT '4F-lQq9jbQb45Oxdx34D2', 'skirt', 'brown', 'd7cb09fec772f62a02a82c4a5b122d2fea97eb12187c500a946ba202b1da2812' -- Kaeruun’s Scorched Tassets
  UNION ALL SELECT '4HvM8v9KQxcX2xrLYvb9U', 'NONE', 'gray', '3fed70decbf0f611f3fe4b54dce311e9cf6092e098defb1b2e56dfa2e5869bcf' -- Captimus Prime
  UNION ALL SELECT '4ILs8HFIRQG56ygG-uGrW', 'dagger', 'black', '6f3fb22812587666cf4273dbe4ef2597568999e95b48d6b1a415a928de17ef1f' -- Stonefall Kunai
  UNION ALL SELECT '4QhVOJQjIz1HLudTh7Z8I', 'NONE', 'gray', '7cb33b60dbf4e1d52d089800581394941e3532a24804fb1b7171a36235203290' -- Raspberry - copy
  UNION ALL SELECT '4UkvD8_WPviQiRHQvN4xl', 'NONE', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- Item for Fixing account
  UNION ALL SELECT '4WuraRiYAqrGosudCC0Df', 'NONE', 'gray', '8ca7bcc640cd158cbefaeb702f02ab1748e3cb55af07de31f1b8ae4364ea9fcb' -- Tied-Up Tempest Triplets
  UNION ALL SELECT '4XY2pZQpyASTVLkNMUhfh', 'headband', 'black', '1af4e410f5fdb68260b0660fd371c1d3825d9a801701957d561a153d84ef19d4' -- Basic Shinobi Head Guard
  UNION ALL SELECT '4huDnXDq5zInzZ3dLgykM', 'NONE', 'gray', 'd2cdcf4a89eb6ad69a56153e36227248564779c221ebf7f81e61cd5dacb11d9e' -- Scroll of Hollow Veil
  UNION ALL SELECT '4voAt9Cg1z7X0Wg3YKQ_m', 'pants', 'black', '9b4de9ba30aa29aae3dc8ba43a5a5dc256c5e66bb844ccf70da590565f5043a4' -- Two Tails Tabi
  UNION ALL SELECT '59SDrDCzO9IeGJ0j-sXcI', 'NONE', 'gray', '3637ab43d516ea4d4f7f0afe87da0260997723316c17382c07673142fc81bdeb' -- Moonless Chakra Thread
  UNION ALL SELECT '59mZMEYVU24dxG4z-vDz9', 'headband', 'purple', '772b6068d043c69163fbb848aad6fa98b113971dd32aaafcf998cbd260a6ec8f' -- Radiant Helm
  UNION ALL SELECT '5I0R-9ji569-zMqbTNdH8', 'NONE', 'gray', '16b1fbb82bdee2aa41a6e68cef31fb224b4cae8500003ee6b9e8a229f91f7c27' -- Moonpetal Weave
  UNION ALL SELECT '5W8HJUSPt15Lu14EFvHqi', 'NONE', 'gray', '25c6b438301367559ab6c39fbf2cd610be9fb6e592dba3ccd73bf2fe1f68ec62' -- Heaven Scroll
  UNION ALL SELECT '5Wg0YiTBdo_MvDiZbL7e8', 'NONE', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- Wyrmspire Cache
  UNION ALL SELECT '5b4dSggNUW_rYeScvQUMM', 'NONE', 'gray', '28f5dd59162884c3b47f81f2b6fa8157715b12d6d0ad7ec072b97d178db65383' -- Rust Ferret Pelt
  UNION ALL SELECT '5bE37-iAem57eiOi9LdRa', 'NONE', 'gray', '0a13b8210a8522c0cc3c2d1a587ea73d51053f4e24b7fff9406e9a5e44c3b8f3' -- Inari Fox Figurine Whispers
  UNION ALL SELECT '5carRNXB6Bguaj8NIHyRu', 'scarf', 'gold', 'c52a0b2f3099cba6bbccf04345b65cbf0a519f246a3de4bcec3483099fc67ec7' -- Golden Mantle
  UNION ALL SELECT '5dPLCoArwrQuqJQ7bc61Z', 'NONE', 'gray', '99eb7ee46ebe82aefd7dfb641462bfe45108254804d23bd270c686582537d13e' -- Underworld Ledger
  UNION ALL SELECT '5k6lj7QqxvuH5wQ0NWXpl', 'gloves', 'black', '5783f5641455ad899d3662caa2a865d0bf2fae22a595ebfbc193111e935ab4ec' -- Grippy Gloves
  UNION ALL SELECT '5kN43XOd-VYuRTQZ8OW-B', 'sandals', 'brown', '0eaba9581c20a9d393868fbee8323e3b2b339153ed96c6253387e94241f4a1d6' -- Sun Sandals
  UNION ALL SELECT '5tbcIc2L15-pV57ZrvHKU', 'pants', 'black', 'd9115f288ff06a571bbce8f9751dcbdbcc58070fb6fb096b1d0c846ded37db7b' -- Specialist Legging
  UNION ALL SELECT '68iOJW5-j5km2ColZ0NmQ', 'NONE', 'gray', '7e47212ad1e8b1c997e1dfe12bb6b6fb61b03b8eee76b618955be18046290798' -- Fertilized Grass
  UNION ALL SELECT '6CHUDyxrAzZxc4Btmfs2h', 'NONE', 'gray', '9a244dce23383ef326501c5599e93bc0eeaf2a3da0e854d4a3735b0c74dc5332' -- Susanoo's Tear
  UNION ALL SELECT '6CLUqWKf_RtvePbbdXG_A', 'legarmour', 'brown', '2f520a1999a53d73e3686ebc2a07bcbf16b9ca6994a5c2064dc8e64678ab36fc' -- Radiant Leggings
  UNION ALL SELECT '6CdpgOevc2UpDd9UDqMpv', 'NONE', 'gray', '2eded2cab5342f7c7970017c0bd706415620ea922accef807502d5633a749805' -- Violet Stormglass
  UNION ALL SELECT '6DnJn4x6LWWXtBu7UZybb', 'NONE', 'gray', '67faacfa1672f61bc6169696d16bf19e6c57bf745e65a96576d800a3da9497b9' -- Dr. Kim's Miracle Potion
  UNION ALL SELECT '6KjoLwLAkKiPWfSjKc5aX', 'headband', 'black', 'eb7e895bb1e002a46fe5afe2b456fea4d88634d6f8d9f571b270ff64d33ca39d' -- Shadow Dragon Helm
  UNION ALL SELECT '6PguSHDJikU8y35qGcBWa', 'NONE', 'gray', 'f0f09ce75396b44583173fd665372b17a9f9931f654f1e0aa091605accb57475' -- Shinobi Tool Pouch
  UNION ALL SELECT '6YQRrkF9Cm1JW861UH4kV', 'pants', 'blue', 'd35d08bbf62ae10c53ed00ac03b0540c0639af6bdba9e7d9a6106cd2c50c89ca' -- Bise Leggings
  UNION ALL SELECT '6fshPfZ8AwU228nn5y9hz', 'NONE', 'gray', '844d3fb8731c97967706cc9ea898291f075989d749ba02b06e18ac4786a5b388' -- Beast Claw Slash
  UNION ALL SELECT '6g-leb_pyJJlDjY1i-gz3', 'plate', 'brown', '72850737e84c15cbf40a9e7fd2325c9bcef0374a7bf452bcc936a70796f345dc' -- Kaeruun’s Ember Carapace
  UNION ALL SELECT '6rMb-Ly0T1o4pbXBkFNHx', 'necklace', 'gold', 'e9be6747ce061acacc8b096e60c7331699221c14ecfbe6116abe036db01f97c1' -- Sloth Pride
  UNION ALL SELECT '6v11zvGO6YnGx8dVcBhXs', 'NONE', 'gray', '3c5dd320e4221d0d9f225d50cccf40bfba70a6dcb69448ae4588c0d4dae72773' -- Silver Bag
  UNION ALL SELECT '6zSX6hJOfleiQmNWoKxED', 'NONE', 'gray', '9a740026c391b9b8051325f07f78e90d1d45aaf9e289602f0dbfb16ac81acf79' -- Countess's Silk Ribbon
  UNION ALL SELECT '73jeO_F0cCCnwmQVfQNZH', 'NONE', 'gray', 'db16445d8945d1f88ccf15c669da9f096de676c3366b4ee4a9472592682504a5' -- Note from Elder Lich
  UNION ALL SELECT '74RxQoqSNYcfRnLxVDTfB', 'NONE', 'gray', '2d7a360f3e1c2be8ab11eed1b1188232c2d46483c7a1972aff877a477742a7ae' -- Earthen War Cache
  UNION ALL SELECT '780vwu1sa9DoLqPCvxwYt', 'NONE', 'gray', '0f9107ca1a24dc6bf3a90464c34b7e4f011195f810c7dad3701ef48c1b0a9200' -- Scroll 4
  UNION ALL SELECT '7I2YZ9hcb597Jn7hTdVXw', 'robe', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- Court Regalia
  UNION ALL SELECT '7ShuV3gE8RKyJlGjh1EfL', 'NONE', 'gray', 'ceae6bac08b9618a03cd46310f75554637ff70803ee28aabe931f60512db7431' -- Sun Scroll
  UNION ALL SELECT '7i0EfWdstwf-2FKtgH5_a', 'NONE', 'gray', '3c5dd320e4221d0d9f225d50cccf40bfba70a6dcb69448ae4588c0d4dae72773' -- Phros Bag of Silver
  UNION ALL SELECT '7jB392kxaagZ7HuuxuSYu', 'footarmour', 'red', '4a9a4048f4745aea8292101eb8253426da3d2718d5b61695bc4b2719c1c6c348' -- Crimson Dragon Soles
  UNION ALL SELECT '7nbCBsFwaePPGDnqDRl0c', 'NONE', 'gray', 'e67d9ebade593c736155545f4f60c9ecadcc2df13adde635a181c656286bca6c' -- Festive Scarf
  UNION ALL SELECT '7tZoY3uG2Jxg8Fp0dZlwE', 'NONE', 'gray', '4ec45a4e0194f0166dcc12fdad9e16c548ba0d1dcb8b3ad08a354280466ef461' -- Shadow Scroll: Oblivion Seal
  UNION ALL SELECT '8-JfO5cZX_n6rfnCTF2jW', 'katana', 'blue', '59df999677d9a6553280fd8aa79c4e6ff34248300eb6e8f2b3a1b93d36ce3561' -- The Blue Blade
  UNION ALL SELECT '81LAIMYRUCSDUoO0UNqXz', 'NONE', 'gray', '4ba099dfbb848a42dae81d13815ba42de01af9e416f8e832c303d9820caa0f74' -- Slithering Tentacle
  UNION ALL SELECT '87aO38h5cBs7vOFk-y8Yg', 'NONE', 'gray', '37ad91fb4c1c947ec00ecc8b68030b28e14d2043f09c16b5b8f801935ccfe9d5' -- Decaying Wood
  UNION ALL SELECT '88mJ_HVf-__u3YYPXzJE3', 'katana', 'blue', '4a1fdef9c8aec1798787b3c8970b489d5de3c94feedd310b23dffe9ecb3a9b86' -- Veilrend
  UNION ALL SELECT '8CZTvnnFxf3MQfP7itjjH', 'katana', 'green', '653abc33256e807a74368625355ee813e47ec21335209b7b9f01568506a384c2' -- 𝚃𝚠𝚒𝚗𝚋𝚕𝚊𝚍𝚎𝚜 𝚘𝚏 𝚝𝚑𝚎 𝚅𝚎𝚒𝚕
  UNION ALL SELECT '8ThTs6ASxHi8UdtXWoAGC', 'dagger', 'black', 'd012ce00ddf5cf89eed9063c7a82401ca3896362f1f01bf0692382e8b33b08c8' -- Widow's Bite
  UNION ALL SELECT '8iiJYkza-6d2LDiFWQeCm', 'NONE', 'gray', '60d3deecb785f115202b8e3f4f520bc0307990d073228c0f6e695ef27dcbdcb0' -- Scroll of Summoning Momo
  UNION ALL SELECT '8j6tg2zqd_UwHqBcG84Ml', 'belt', 'black', 'e5eb88f25ee6d9fd41d6f34f544645569dbd4692f140c657ea918b1151334235' -- Desolation Belt
  UNION ALL SELECT '93-XH8W9SGzy9bQ22ife7', 'robe', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- Ashen Regalia
  UNION ALL SELECT '9B39LchezltTS3qM4GvD5', 'sickle', 'silver', 'dbc165b54e4f098f79603a4c1ad23d305e675fcf0cdddbf7021e27f9263bd7a5' -- Chained Sickles
  UNION ALL SELECT '9CVwLD0gbxwm9LfG6IzTN', 'NONE', 'gray', '91062815112beeb6efd8c2cfe1a25574463e35735ab30ab288e0e545839fc61d' -- Blood-Garnet Bead
  UNION ALL SELECT '9ahQy8sTSzsa09VOx48fI', 'NONE', 'gray', '2a605a1327e19176f472d50af0a53af8e6b0937aac5856b34bf0382b52fafdd1' -- Egg Plant Seeds
  UNION ALL SELECT '9i3v7gKD0KjOTQWCi_Ur6', 'necklace', 'red', '0453df8b9960a743085c7a0b5c923f6b7dfc3f049c0ec92254b52c8a23481c76' -- Wraith Locket
  UNION ALL SELECT '9ufiyZwUFvn3-VoFtr177', 'NONE', 'gray', '3c5dd320e4221d0d9f225d50cccf40bfba70a6dcb69448ae4588c0d4dae72773' -- Content Bag of Silver
  UNION ALL SELECT '9v3itTmn7owqCUFVRRSQ-', 'NONE', 'gray', '8b848710a9c2db2eed5ad22a31234c10ace1b0843e59101533f5fd2d9a02ae51' -- Empty shark egg
  UNION ALL SELECT 'A0ErggpVp7CjTmhLnhmL_', 'NONE', 'gray', '5757f86d7a0c83d361cd4a76c999918bf5b74c5c14bbbae6e2341019ba2df21d' -- Fish
  UNION ALL SELECT 'A1w-tM5zsC8ORXt_i2U0M', 'boots', 'black', '4569161945f0c81ee8e1d6be0120ac2135dc7604b8bd63b11aefb024a6fd6a3b' -- Basic Shinobi Soles
  UNION ALL SELECT 'A5rgavBvGPrN16N4XoDY8', 'NONE', 'gray', '1e5507959f59e50b817115b5a3c63921148e6595510e52f4346f8807c72dedfe' -- Muskshade
  UNION ALL SELECT 'ACz3MvMZeKArhqCiWQPlv', 'dagger', 'gray', '31f14838e89cd01922f45f1c2da8cf97e98c36ec7dfde1d937c09dd7af68f05f' -- Short Knife
  UNION ALL SELECT 'ADWB3p-CY5RFusXI_t70a', 'NONE', 'gray', 'db19bb7a2b3674925df6d328d2305167240596ce4c1636800db6cab77966d397' -- Marrow Blueprint
  UNION ALL SELECT 'AFybmwGEKISAVFNQift9T', 'NONE', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- Neo Test
  UNION ALL SELECT 'AGCiQ_Qq1zkCEHvMZUtQN', 'NONE', 'gray', '57b72b01e1d4cf0cbd7c61fae9a0196d04816eaba04dc245422bff31f0ceb21d' -- Storm Fragment
  UNION ALL SELECT 'AGIWmYOnh1HaEVSVHMTZX', 'NONE', 'gray', '7cb33b60dbf4e1d52d089800581394941e3532a24804fb1b7171a36235203290' -- Raspberry
  UNION ALL SELECT 'AKAgc5uBfs2uMrATdmnov', 'NONE', 'gray', '2be5ea339a4dafd8d43747e700f691338c9e22b5579d891a25c17ef77515b58f' -- Starfire Petal
  UNION ALL SELECT 'ALqXVSL58QMfJ4DgoJ5Il', 'bow', 'gold', 'd25dfc8b90465db3d3ada9943c5f2692dfb6f3189fe6da180df635df7c3626a9' -- Solar Bow
  UNION ALL SELECT 'AXIrtSJ50h3qXvQ0vIaGx', 'NONE', 'gray', '71ab7b4a489ec0a503872a1cbf5412c34ff84f54550703e78da5f52b534a20c1' -- Drained Effigy
  UNION ALL SELECT 'A_G5c0VZZMEngRUh41wxe', 'leather', 'brown', '6c32e56e42f0dca94b9850073ea3bf26925c1adaae3d2b3ebfedb977fddd8769' -- Radiant Plate
  UNION ALL SELECT 'AeVsP9ZfP8gIv8LKUNcUo', 'sword', 'red', '5e17f10c249d427bfa2890dec7624a973038eee19af63c908fb00f26c05f86df' -- Candy Cane Blade
  UNION ALL SELECT 'AgdwELpt7w4SASPjD35re', 'headband', 'black', '64cece1ff962046024af3033b6e5d278636c54e4f7159829c44932650e08ea8a' -- Plasma Helmet
  UNION ALL SELECT 'AmPR6ruTnuNa2lxK1cXS0', 'NONE', 'gray', 'ce182413ae1822a1bb8070034c3115ef82ba8803241402a6d0810b18a4f4b59f' -- Pizza Dough
  UNION ALL SELECT 'AmtbbB3Jm2dDB3t3r6kSW', 'leggings', 'white', '288e3df31efec03af71f863a079d626375ddf1567cb7834df11304ccfa622438' -- Kitsune Pants-F
  UNION ALL SELECT 'An9G-YkaAonclWsmcpx4E', 'sword', 'silver', 'cf543899bb79c142e6a711dffc518b48f2caf8a127d61d97b419dd736fdc0c4f' -- Masamune
  UNION ALL SELECT 'Apc3YBy_gWux5g9dpN1kB', 'NONE', 'gray', 'df72505d88a2eaa025035e43b15e6cd0b65a85ff49aa45c62bde827afc98fe4d' -- Dragon King's Scroll
  UNION ALL SELECT 'AtamnlrtJSDBEwrPmQ-cB', 'NONE', 'gray', '988e0ce816ad75d6c7ca2125759dbb38420ce56e23567b4f10f696d3a6b3e11f' -- Moonstone Bead
  UNION ALL SELECT 'B2jlvCWrCEDNbv4MDaw1s', 'shield', 'blue', 'a1fc3b9ca4096ce96df0797441cebb04c7d24ebbea943be0977975840ab2c7d9' -- Gate of Rashoumon
  UNION ALL SELECT 'B48dTRsoLJGKBWIUbeUoG', 'NONE', 'gray', 'ca47b6bcac13129cbdb0edb6964bbac1bca9a67cc8c5ddf3a549c7383c7ebe5c' -- Archive Chart Case
  UNION ALL SELECT 'B9GaOd5mbOTStLJJDg7PR', 'NONE', 'gray', 'c7b9fb269ee654471ff2a7a1ff878c4d6aac320abb9681df7e8bc2252b42c179' -- Subaku Amulet
  UNION ALL SELECT 'BCuUAvk1R419nA4m1dL21', 'NONE', 'gray', '6ce88d0657ece4fbb9f3612d7c0a0fbd32bb64aafaf2d804a7546bf2989f5a75' -- Damage Crystal I
  UNION ALL SELECT 'BGbJPJGhjZxN8XzvfXf1b', 'NONE', 'gray', '01599aa92905ff3376b8805705775609221a3f5dd70aacc3f101d4ac9008027f' -- Tide War Cache
  UNION ALL SELECT 'BHc06mkf9TNiel0W2klsv', 'NONE', 'gray', 'fb7c6fe798d8bd1612a70655f17fa58ee389adfcff37d8258d769346d4917ba6' -- Unbroken Blueprint
  UNION ALL SELECT 'BIulsJR3ojGRqsvzpF9UE', 'NONE', 'gray', '3b54fa4f992ba18fb610fa2f70f3072011fbde179e37647f2e8c84e100fb1479' -- Wraithbloom
  UNION ALL SELECT 'Bfdaal_TF70jdkCKghWfU', 'NONE', 'gray', 'ed32c65c743dab2b087a6740a8ee14c9fe2a9513d192d15afa03b6c383958aef' -- Murkshade - copy
  UNION ALL SELECT 'BhGK-UWNk_QnORODB1qAb', 'NONE', 'gray', '44a6caf633a20a97a058405fdd279e55dd6d719b8dd594db934efc45cafbb07a' -- Frostbite Leaf
  UNION ALL SELECT 'BjhSrtb5_CpoagvQd9hY9', 'armarmour', 'green', '9a12e47deed163d7fd87f605ea353ed83766f088877de76e6e1d1561a217f01d' -- Flak Gloves
  UNION ALL SELECT 'BuNnwBemXJ0nV68f6hNzs', 'NONE', 'gray', '2208f18610e4f996efb223b5a1944a92574c0b4e2f5e53a7eabde022da7cac92' -- Christmas Present
  UNION ALL SELECT 'BxMXVYw5KYbBG62he1Yvr', 'pants', 'blue', '2c371e9c5f69c7b8d9e8f09dffa17bc47e372f974682cdc98a19b5f2dc96f560' -- Ocean Leggings
  UNION ALL SELECT 'C1m-NiEbV9WgVT85J-qJ1', 'NONE', 'gray', 'ca87682fdc08bbc2dedb70b05e89ace9f1db4d11b8b14309b9fe9b84d565a997' -- Footprints
  UNION ALL SELECT 'C4dJPU1B04ib9TJBym8dl', 'NONE', 'gray', 'dc14aa935da98b01075ef7a6d297309eb9a8e95510638a8adc1e1d9cf9e851f8' -- Dungeon Key
  UNION ALL SELECT 'C4v-tbPSPPxWCXikSOvhK', 'NONE', 'gray', 'e52a58f08a1dbaa6915980bcb2267284045358943372bbc3668ea77ffcabe866' -- Hollowfoot Fur
  UNION ALL SELECT 'CAIzJpB4EUB91MFBEr3Vn', 'necklace', 'gold', 'e9be6747ce061acacc8b096e60c7331699221c14ecfbe6116abe036db01f97c1' -- Pride
  UNION ALL SELECT 'CBp4scJi9XzMKRqxpshwT', 'fan', 'blue', '29485ef0c0e2d65a94f07529dd1bc36d0fb5639ad7778dfe5c99cfb4e7ded98a' -- Zephyr's Whisper
  UNION ALL SELECT 'CIT8c_SvjTP59tmNz1ghy', 'leggings', 'white', 'de2555cbaafa2a8b68a4d6268b5685ece60f6278eb2eb31b71d1ece048519ec5' -- Kitsune Pants
  UNION ALL SELECT 'CMLcrx5P_atbjuZSa4_0B', 'footarmour', 'black', '0a6435f54fdfbfcf5c9e3784b5b48709add0d7df71a634305cd42f5edae4c7e3' -- Shadow Dragon Soles
  UNION ALL SELECT 'COavLYIiidwXf_RzDqZcj', 'NONE', 'gray', '03e0a751699648f3131a8783794dff7e753f746af7b1367b33ea03c6e466ce3d' -- Partially Burnt Scroll
  UNION ALL SELECT 'CTZ1mwhHrICLtiCaZATY6', 'NONE', 'gray', 'ef6a53ac19c3bd34aec5c1c832c12733a48a755597c24d084e09594def268d87' -- Skyglass Filament
  UNION ALL SELECT 'CaWaH4I4hR9LYGYE9IuJ_', 'NONE', 'gray', 'ea225197cd0e94c8b3767d4f5eba34be29e0b242634775eee4acbbb984611a34' -- Corn
  UNION ALL SELECT 'CbUq--UpWnawD_7Xk_GCV', 'NONE', 'gray', 'c62886cb9e07c72633a149ec10d23e01793d2fdcca13c8a358b4d16758959d0b' -- Stamina Pill II
  UNION ALL SELECT 'CdYJXjqMUvknIAXCYP78M', 'NONE', 'gray', 'f6d3fb76f787b8b4570d79c3e723fc1442c2942e84e3b844aad852468f80d033' -- Holly Leaves
  UNION ALL SELECT 'Cmo3JU-D9Nl_-xUxrvEJN', 'NONE', 'gray', 'ed533135df90feda5fabb3dc4151629d2642db9b673c422f83721e3c1aebf4ee' -- Skyglass Crystal
  UNION ALL SELECT 'CoPTfp2Lw_3x01RHdoKH0', 'NONE', 'gray', '219fc6dcccec4e1365cd14c73fb1d629a63ff72aaef5db0940cb33996e682f6e' -- Shiverthorn
  UNION ALL SELECT 'CtNJeNE3h2eZMpMsWAvq5', 'NONE', 'gray', '06a60446c669ef11ad798c57c39445d6c108f69b17358f1588fe3c5fccbcb692' -- Pumpkin
  UNION ALL SELECT 'CtSuEEfUFjLpNuGSjA4jQ', 'NONE', 'gray', '730b57e76d7b347277da47130a390122d3767b60a5cce61643edcfebac35bfef' -- Tomato Seed
  UNION ALL SELECT 'CuKT4SwjghcfAZ9ppTyx-', 'NONE', 'gray', '04444ad61ba3bf772d3ccf278d29d84834f15d792b4d8c43a8a62901cd80977c' -- Tidebound Heirloom
  UNION ALL SELECT 'D0Qsl1cQWNMy9kDDTGnqI', 'katana', 'gold', 'faea91741a3a1f919ab39e9174b1b45a545e47e92b7039ed1e64dd10b48da549' -- Refulgent Shūren no Yaiba
  UNION ALL SELECT 'D0gtI5dOgj2dFO4VexsLJ', 'NONE', 'gray', '547ad823c4df920a6d0328f11d623a3fa566408b1e2e88e0f727872bd5cc9f92' -- Katon Tool Pouch
  UNION ALL SELECT 'D1hfS-W2iZgAMfPSZQH5J', 'NONE', 'gray', '24a45d4388b93694f55f72b821459526da60921ccd1676ebe0054a321bf0497d' -- Fractured Ore
  UNION ALL SELECT 'D1mAhTk5lgGOuui9M3Moi', 'NONE', 'gray', '10073adb6daa2254b9aa007941041ded6d7ede239b743d55d0e7eb7a02e59685' -- Large Fertilizer Bag
  UNION ALL SELECT 'D9pEvpmoVE-uW8czNpZ2f', 'NONE', 'gray', '75c8727ae92ddf15f7886051cc55d3f3c33d8f27d55a2ad39d101ff8dbd22500' -- Enemy Pill
  UNION ALL SELECT 'DAMFOosOlbZLF7hSxvF2o', 'shield', 'silver', 'fbbb73e9b3b4d3b1b490685ab0f3ad56d4cb212905c4e03c85f90cd0c949da48' -- Mirror of Retribution
  UNION ALL SELECT 'DEILccCULyDDKOz8UqFhM', 'NONE', 'gray', 'e5492d36f29ad7b4ece795d3a88d87c0497cb4e90eec05ab71e2ece769576aec' -- Hemorrhage Cystal
  UNION ALL SELECT 'DMiq3GDftWWW6Bc_KRPjZ', 'NONE', 'gray', '5acebffb7b2afc223bf44407ecb680444da81412c6c6be77674d0c4a663614d9' -- Torn Stonefang Banner
  UNION ALL SELECT 'DPDzt4Rhmd8bdyD1Mv3kC', 'NONE', 'gray', '80063c668cb306aff13f381b7d23bdb3d9176e5ca254af95d6bf74ea0d15ae48' -- Apple Crêpes
  UNION ALL SELECT 'DWFRB8hWCaWpWpUWUO8t5', 'NONE', 'gray', '67af283aff1e76f34af61edea77caab2e4e5e76154b8780e964eac0b34f4ccb3' -- Wood Scroll: Shinseina Ki
  UNION ALL SELECT 'DaDQtbfTztCA4Oj8fpe1n', 'shield', 'gold', '84182779bb0830d0eae4d15175f76a983bdb1555e252bc8a43a3dd9768ef053b' -- Undying Rage
  UNION ALL SELECT 'DaQ-BwQs0Mho-tM4zJnC9', 'armarmour', 'black', 'aa7c42bec50b761bcb1ccdbd1556c26fc492b74c718a3ec1584a0397a527f6c4' -- Desolation Guards
  UNION ALL SELECT 'DcJxDys4NpA6YKeAN0nU1', 'NONE', 'gray', 'e50533bdd57ebe67253fb8ab543f9d4354aa817f1166d19c694ba1ede9cd9359' -- Ordinary Knife
  UNION ALL SELECT 'DfV_RZr-4mSvuS1E452aj', 'katana', 'blue', 'b9a9748c1aa3ea1e3d5addaef1ecaac6b10dc7368a4b7da8d5130598859bfced' -- Mastered Shūren no Yaiba
  UNION ALL SELECT 'DhqmcpRR9fUI-MNSg2Rgu', 'NONE', 'gray', '2e78eb7ae51649b0c19317b963552c808138bd34b511c2e596416b10d3bb0b5a' -- Protection Crystal
  UNION ALL SELECT 'DlyEYHiOp3SBlFTAxjhiu', 'NONE', 'gray', 'abec9ecf20859b24ed9990adbaa0cfa894264835018196b06950370f5aaeb2b9' -- Ryo Distraction
  UNION ALL SELECT 'DnPPuv7qWh6FthuR05OPb', 'sash', 'red', '26ec543dcab7f3b72508a8bc7f2360e1fd34bfb2a8637801bf6e72b4fdb87daf' -- Brawler Belt
  UNION ALL SELECT 'DoDrH6CM7o0euz9UQXBS8', 'NONE', 'gray', 'aa77f569e92125f719fb7820a68bac973c864a11c3f550728c2b86a77866f268' -- KGK Scroll: Veilguard Pulse
  UNION ALL SELECT 'DpbyHbF5ESe02Ot8N_YG6', 'NONE', 'gray', 'd1a6f75a2dba57982f9ffc92b81c4b8f5efa35f8f73c400aefb0e09f8fec2db9' -- Pear Seed
  UNION ALL SELECT 'Dtcn6oJOEs05QkGW1TSrT', 'NONE', 'gray', '69716cd3b0362cdff893718057835f1fb659d0c0540819cadf348a42ac8559a9' -- Calmness Cyrstal
  UNION ALL SELECT 'Dthn-B1i4eC7D-_oPkF9u', 'NONE', 'gray', '007f432d1cfeffe71c87b0f8d4bb569ac755f002908a0aadbbfdb449cf8fd7d8' -- Vibrance Crystal
  UNION ALL SELECT 'DzeZwYq5GdnHvuM6bn1Q3', 'necklace', 'blue', '04288e4b05320f77357176363bf1f2b5ce5b019992f413d02cb08602e3016aed' -- Stormanchor
  UNION ALL SELECT 'E5L5HLBAfew8RpbBIbUjT', 'NONE', 'gray', '0c6a287ad1f390a91d0d962623bf255be3b2bf9543fbb5e52a901da6aed6912d' -- Plague Mask
  UNION ALL SELECT 'E6tlRU8OAucemGbYQu55l', 'NONE', 'gray', 'eba00f794609aa32066b65ac9519a5a0f431e2fb830955a72b57a189a83d2972' -- PVE Test Amor
  UNION ALL SELECT 'EH3LEk61e1O_hBbm2_hKV', 'NONE', 'gray', 'f4441d9a0880dce8a47f3495a609e4418f93c1829532430412fcde7572671ab2' -- Mushroom Seed
  UNION ALL SELECT 'EL3MnXz4GeKeKvhNP7Sx0', 'NONE', 'gray', '838a7b9b7bd34551261f1f1739a3e2af19b66f50d043d8c6c2f03a3c8f78cb53' -- Witch’s Spell
  UNION ALL SELECT 'EMfgHAXm1z3iHd4U8ldZk', 'NONE', 'gray', 'd17f39519e4c5245a4f3ee4a542fc03bddefa71be0c452cf1d7e5e27654d4b77' -- Akane
  UNION ALL SELECT 'EMh8bXJ1Nf-PI2o4JArRA', 'NONE', 'gray', '0d2520c0f50e74c3047090d62839abd5fdca2e446a3026407b77850f4de782b6' -- Plum Seed
  UNION ALL SELECT 'EYhVsqNz72Uaoj4wUhlTC', 'bow', 'blue', '5217e0e8e8c728659309a3da8660e3ca164b66cc23dbcbfd5c91454220fbb527' -- Static Handbow
  UNION ALL SELECT 'Eudi3vPDCDeRc75xmhXA_', 'NONE', 'gray', '954dd05dcdf558b2cf1e0a0ee571d34c862ab505f4ffc34694e9d1a66b3da70b' -- Gold Ore
  UNION ALL SELECT 'F6Ps-ij6yBwvpJeNNC6IW', 'NONE', 'gray', 'e78193bf37b887b376389e47991c65ebfcdf00322df7bb8f059ef639d87c0f3a' -- Scroll of Last Rites
  UNION ALL SELECT 'F6RVC1zKcpgD95u0HI1Rv', 'NONE', 'gray', '5868aa1127c0a07f140d7633c3898864a7eb6662f94a842983d74b7486756073' -- Sacred Wooden Carving
  UNION ALL SELECT 'FB45pYVTANy1DjPiLUlNt', 'belt', 'blue', '7dbb64b7847483a20468c5e89a0498f8573b33844e50bda67605568e629533bc' -- Bise Belt
  UNION ALL SELECT 'FCqGTz3jEFEJoGCeagx1P', 'NONE', 'gray', '3d0b2d60aa6d417c3d5d8424d1d9011f4efe2e375c2a797908c6c90d10dc5b2d' -- Dr. Kim's Poison Potion
  UNION ALL SELECT 'FEaV0h7on2ZHy_ST5fSOs', 'NONE', 'gray', '7e511f756aebf927f73ddc6435509d9931f77b7868da5aeb8c8f226cdc55392b' -- Imperial Gold
  UNION ALL SELECT 'FG4xYkI8UmRrJCdD3yPxI', 'NONE', 'gray', 'f1911ed7d47d212642ff34b84faf60f42f5bdb93ca03866d218c8bb3122ee7ec' -- Lion Token
  UNION ALL SELECT 'FMXKxNEvVl800QTIYoqyc', 'belt', 'blue', '676a7fb8e01ed8200b203ffed7860f05ee0c131966e44e2cbf52d1efbf24be92' -- Azure Dragon Spine
  UNION ALL SELECT 'FNDzQfUD91SZwImk940kO', 'leather', 'brown', '8f30391133a98f90eb93122b52295c527cdedfff4c314218b65c06e8e3b8602a' -- Comfy Vest
  UNION ALL SELECT 'FO7a7BlDpjx1Rxoy3X5bR', 'NONE', 'gray', 'e17041a5948bb488fbeff5674df5bacc349c4dff8ef7117ea0d2aca0df108499' -- Scroll of Celestial Dew
  UNION ALL SELECT 'FPPfHAAHWANWlpAvnt2os', 'NONE', 'gray', '29c625faed8a8e1607652780473055fafb00490f6124a874e9a79029f521db53' -- Moon Pie
  UNION ALL SELECT 'FVYuxw5E5b2lPOn3cbFfF', 'NONE', 'gray', 'd9beeea63a1ab961cf59e3de6804b15e90ef66498f77969d2823964671113571' -- Skyglass Reliquary
  UNION ALL SELECT 'FVlGFU3AeqfshrmwZg-jw', 'NONE', 'gray', 'aff9f958619bf67282aa5e8cd059f604bb87dbe9fd849b49095c3dcd759f4008' -- Ember Frond
  UNION ALL SELECT 'FcloJZm2zhMN13tbSgOoh', 'belt', 'black', '1645f8b02b303358dbbdf233d7e997068e85dda62f8415196c1d6f72554b61b4' -- Basic Shinobi Belt
  UNION ALL SELECT 'Fh3xch8ox_JMaHj0-ntTF', 'NONE', 'gray', 'cda1ec4892c34daea0a4534dee5cfae8718eea5127ee0693702897c4d591a818' -- Legendary Gatherer's Chest
  UNION ALL SELECT 'Fr4XnfPPnxSrM-AegBm9t', 'NONE', 'gray', '74762083afa5d287ab719515b3331f1fcc44671c0d94fb773b828783c852a243' -- Brasel Spine
  UNION ALL SELECT 'Fz1MU04kLIIM0EMXgouo6', 'NONE', 'gray', '9217eb32c1e011b4a8c7d8afd6b49f5728a6ae89bce76f12bc8effa7ed72f4ff' -- Armory Requisition
  UNION ALL SELECT 'G37PHrTIk6JgNcgUI850y', 'NONE', 'gray', 'f8afe4bfbf4c127d000510430a42a162dba39a6c73edcc205cc37a3ece28506e' -- Akane's Grandmother
  UNION ALL SELECT 'GBiY-W9ERESlsbp96cXdb', 'legarmour', 'blue', 'ef129f49f902e292d55b68edcc2f1d31cb31eb6a98adde85b6bdfc201356ec52' -- Azure Dragon Scales
  UNION ALL SELECT 'GHe_D2wR5vpM2r7LSnApe', 'NONE', 'gray', '6987548106155d49ced5cef32721cc1a5b4df1c2dfbe7959428e99ad460d5e38' -- Ashrend Wing
  UNION ALL SELECT 'GI7O1Ze9DnuOw0-WcazsN', 'NONE', 'gray', '0876e3f660600cab878d04ba928206ed07d5ccfebd0cbbb70a50030227628977' -- Fujin's Breath
  UNION ALL SELECT 'GKHC24Cl37LXIeS-7mbAp', 'sword', 'brown', 'f927bc033bf25c80b92918a2235cd7dfef9a2b7955907cf3d5fe4b41dbc06b19' -- Wood Blade
  UNION ALL SELECT 'GMF1JZ0MChUHc7AtnKABw', 'dagger', 'blue', '34d76c37ae34f831d76f45194ca6d5ffb2d664ed664688ff00b06dd629d06041' -- Ikazuchi Kunai
  UNION ALL SELECT 'GNGrfEDnxbRBgOHHCjPX3', 'NONE', 'gray', '6f9d27e99440b58a50fb30482917d9f2432cf32e110aee6323abbcefcf8236af' -- Stamina Pill
  UNION ALL SELECT 'GVtP73hkFgf_2WLwx-CIX', 'NONE', 'gray', 'a124024064f3fdc1aee049a1e4c89f39841ae421c3cc1737ccf54e954e3e2bbe' -- Abby's Potato
  UNION ALL SELECT 'GYsYwFalQ-8cCPJg3YyK-', 'NONE', 'gray', '4f4347a3f267098363d1263c8d5e6eee51968afb850f889c85b76203f52558d2' -- Trashed uniform
  UNION ALL SELECT 'GdTDdhX5p279sm9rMQaPe', 'armarmour', 'black', '6bfcb0d2c7b9aba16b17a9beece3c0a6b8f8e2875bd002f655fc058734ad797e' -- Basic Shinobi Hand Guards
  UNION ALL SELECT 'GftCvLtDPdUC22_HmfiZI', 'NONE', 'gray', '992568130690911f9ad26f1ac3041aaa3d943c51caaa7f39c888782858811ef4' -- Froggo Wallet
  UNION ALL SELECT 'GhjeOfd0e3kshRYKU1MHf', 'sword', 'silver', 'fd5303864e8e67648b6cf6c20b9e9a14bc05ad90ee549b7791b8176de9873249' -- Sword of Shadows
  UNION ALL SELECT 'GnLWYlrwoCNuhJYFkCPEw', 'NONE', 'gray', 'ce9ad7e24eabef163799d28518ed251b10e1c5c6d81c3ea29fbc48904d0d021c' -- Raspberry Seed
  UNION ALL SELECT 'GpvRMgpvBMP3Sq7Bid1gO', 'NONE', 'gray', '4f4f1cc52a5dffd9e2a58adc67e7d39c71f12a43c6d2c18661f5daf43562c84b' -- Diamond Ore
  UNION ALL SELECT 'GukK77zn6jsJpWO0LpvIo', 'boots', 'black', '9eef5aea88812631ced5587cad8cd76f89e3cba863c2b84bf8c78112ff564aa7' -- Ninja Jordans +
  UNION ALL SELECT 'H1yz5-aKshav3uQyE4biC', 'necklace', 'purple', '15b3ae1b7b9ccc244198d7f08ad06ce1ab7583852051d3c087d94ad53983d64e' -- Sealed Necklace of Lust
  UNION ALL SELECT 'H2iA-9n_Af6-A9rUkd32B', 'headband', 'black', 'eb7e895bb1e002a46fe5afe2b456fea4d88634d6f8d9f571b270ff64d33ca39d' -- Dragonmancer Helm
  UNION ALL SELECT 'HDLLej-TeKIcLnFK05Bo8', 'NONE', 'gray', '7e511f756aebf927f73ddc6435509d9931f77b7868da5aeb8c8f226cdc55392b' -- Imperial Gold - copy
  UNION ALL SELECT 'HH40CbBle6eLK7Wb_VKgj', 'NONE', 'gray', '3324b501b9909e777beaa64d22379a52737d69da1ef884d476864b3c10b1b91e' -- Hunting Experience Scroll
  UNION ALL SELECT 'HLycjzUcVwKZenBWpd0V-', 'NONE', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- Endless Night Chest
  UNION ALL SELECT 'HS430LRytJ3xK6fHlBjcF', 'ring', 'gold', 'b3f0c064df67feb70f4b8b36eb60741bd141964d5aa2eaa03d5c2d84458eecbf' -- Sealed Ring of Greed
  UNION ALL SELECT 'HSvTtRH06xgCW5XRIcFX2', 'NONE', 'gray', 'fc7f37b030950efc2c877830d90f539e7f80457470c1f5b49c5049931a7a3bfb' -- Sea-King's Scale
  UNION ALL SELECT 'HTa2LemKvEZzS_olrB56T', 'mask', 'white', '7ebf3e900d75c97ba8c87f97e57497a55e991395be2d78a68a32ea68085406b8' -- Konoki's ANBU mask
  UNION ALL SELECT 'HTfGjp71UF8K9SHgBTvBu', 'NONE', 'gray', 'b5f19ebae901ea64a64e25d0540706a2bbb752192bc2ddbde28fe2888a2a8edc' -- Brass Signet
  UNION ALL SELECT 'HWmro5lrtllnCaHOhJI6k', 'NONE', 'gray', '2712d0b399c11898d00313690e929bca0172c1cebf7504cba79cc47de3e05f42' -- Pizza Cheese
  UNION ALL SELECT 'HWsGFmA0mXMfx3TF1HqqH', 'NONE', 'gray', '3120bd43de16de08e77fa45f6bb449ae55fb02d7a7b25618e7ee548475758a2d' -- Yamabiko Egg
  UNION ALL SELECT 'HZaroWR5XtGcpP6PLWMDu', 'NONE', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- New Item - HZaroWR5XtGcpP6PLWMDu
  UNION ALL SELECT 'HnQUoPbYCsBGBk6-LyHbt', 'NONE', 'gray', 'bf680af1e0e1ece739150c5ee78731eb299b4717561ceda430c28d67df1a4026' -- Bounty Reward: Kim
  UNION ALL SELECT 'Hq47884VUykLOkauQ7mzY', 'dagger', 'blue', 'f0edb37f37c284fda9105d08a85680cdf1a4048b60678542681a4afb21d94dbb' -- Tidecaller Blade
  UNION ALL SELECT 'Hr6o8rw1_J5V4u05mjsI5', 'NONE', 'gray', '77523c4650538b742dda981ef84c0d85ed9324ee54e0c94ccc78ea3c05276ee8' -- Snowball
  UNION ALL SELECT 'HxGx2wXebsMuH2Q13XLDl', 'NONE', 'gray', '4e7844f4e8555662ac38a10e3efe4f763c55f04c8e4db2b107c5f9f4dcc5b167' -- Crackling Spiderwort
  UNION ALL SELECT 'I1jCcqs53PlxyToM5XcWQ', 'sickle', 'black', '875a4d5574d2f0b7257fc5b85592eaa8a428e8b4ed4c55c0fb011b0cc67814ac' -- Hyaku Sickle
  UNION ALL SELECT 'I6BenC2f5ETLp6BgDF_4v', 'NONE', 'gray', '7a2f949a82029aefad4f1f847afd2f68c729a6590e3f484e801646a17d04af80' -- Galecrest Sage
  UNION ALL SELECT 'IASx-a5w4AHBcmuZvKI1b', 'leather', 'green', 'f24471cf1a6a3114834f6d66e0ba463b3ed471af96f04828d27749520967fb08' -- Rugged Flak Jacket
  UNION ALL SELECT 'IIx5Jk533i2jmzGjADqTN', 'NONE', 'gray', 'd0f91ffbd863dae32ee5de17dbbecd58c0d9a463e13fb1703ed2e7cd2493da3e' -- Eclipse Marrow Core
  UNION ALL SELECT 'IhWrwebJHk-daB99xIEWT', 'NONE', 'gray', '4b10fea6a148069f71f6f284d855c72e145336450c0aa51b7b73072ff46a7c2a' -- Void-Rune Parchment
  UNION ALL SELECT 'ImK3bc35rTKV9v3eqMDGu', 'gem', 'orange', 'a3e35156571e993dfc135f8c9141f71b230f50ce7e37581c4c849238f19333d6' -- Earth Crystal
  UNION ALL SELECT 'InPbAQg3-Tf6yqoZWD4zT', 'NONE', 'gray', '816b922f6a4e6dca45a8ba6fcc11488fc6aa88cdad9e8124bea6211561b12e4b' -- Storm Scroll: Arashima
  UNION ALL SELECT 'InxJ9D3Nc-o4jaEiNmdQg', 'NONE', 'gray', '1add57faa6e0b7c236e47903817a4f2dcd6d26488839580fd3b25c00c2da8604' -- New Item - InxJ9D3Nc-o4jaEiNmdQg
  UNION ALL SELECT 'Izs2ylsFzJ7fZtdvwDwcH', 'NONE', 'gray', 'b9c4bd7cf7ceb6ca20c75551041b0cbb442a9c031fb7bc21b53dfa7d6e3aa67a' -- KGK Scroll: Black Fang Lance
  UNION ALL SELECT 'J-EWFSGXTaVa0fy4u3zeq', 'dagger', 'black', '35c3df5521765f22ffa095768d02c387a5df04a742a06ff433c89ec716597ee3' -- Whisperleaf Poison Dart
  UNION ALL SELECT 'J4POMn5ZNwDhu5qPBT3Fj', 'NONE', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- New Item - J4POMn5ZNwDhu5qPBT3Fj
  UNION ALL SELECT 'J4X4RA-QlWv3WvnUOgqEA', 'boots', 'black', '9eef5aea88812631ced5587cad8cd76f89e3cba863c2b84bf8c78112ff564aa7' -- Ninja Jordans
  UNION ALL SELECT 'JRXaVvNa8j-BCQL4TPanR', 'NONE', 'gray', 'f05a16ae830f38a50dd7d46186e7c76c301ee6f8b28039ee3f7f4cc699b305a5' -- Dagger's Steel
  UNION ALL SELECT 'JXUPquG8izBsQUXrwohF1', 'glasses', 'black', 'df146ba2172af548c8218eb67c893e785c9ea0d16c1e3c60b113894e2426a97c' -- Ninja Goggles +
  UNION ALL SELECT 'JYRogCuIKGocAaA0jXDD8', 'whip', 'blue', '9aefa757d54f737c35d356d708448c2fd7662407733dafd5eca5b1967d2b3375' -- Demon Whip
  UNION ALL SELECT 'JZCkTvYUkWPHhvzghtHhC', 'armarmour', 'blue', 'ca2c94a607633f3e81e151a95aacd60ec73aa8a932feb557efcbf2891049e0f3' -- Bise Guards
  UNION ALL SELECT 'JlR8m_L4CySVnS1E9YcTe', 'belt', 'green', '48b7c3e6f91c42202a7d65d8953f6cd8be825ec5358a3ecf2863622aae055554' -- Elemental Belt
  UNION ALL SELECT 'JmIHn693Ticb1pZIOx9fQ', 'necklace', 'purple', '10c774b0d0d6037ff48098714a5e6c614dc4411c24021c50d8d331c4f3b3269b' -- Moonfang Sigil
  UNION ALL SELECT 'JorDFhVI4GlhXUtyxxChp', 'NONE', 'gray', 'cfb11356ef8629e5df83bff450c66c12bb78d2e2c53b71058da1b24f481d313f' -- Lotus Seal Crystal
  UNION ALL SELECT 'JuF5712y6Geh1CaLBC7gh', 'NONE', 'gray', 'e084fbf0253ccdb45b8c7dfe701013da5f6f684e6c422561a24097d74778ebd7' -- Tournament Prize Item
  UNION ALL SELECT 'Jy_zudf1zwpz_dbXH3S-q', 'NONE', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- Water Elemental
  UNION ALL SELECT 'K-Ty4TKSpb5PpVqQy2Qxj', 'leather', 'purple', '4091ab9585e2074da225a01f6c5e575a42f4c253a9df9fe5684192392d6089b7' -- Purple Series: Armor
  UNION ALL SELECT 'K5j9Hq19eRftSFDyIX6TN', 'NONE', 'gray', 'edc9c4ca31883d448fbdccaa0e6c3b1899e07b3342ef994cc89be0af90bc9bbf' -- Scroll of Cleave
  UNION ALL SELECT 'K8-Re-iMDiVKkZaZ4MxlJ', 'sword', 'gray', '15074b46ac39c9ad8bc33e8cc33d797de806059a5f5876db0d859c688c81f820' -- Mercy
  UNION ALL SELECT 'KHXgnUKQ34vzNW0I5WkGs', 'NONE', 'gray', '11364f756156c8ee571c921a038b8f9287eb1c6b90f91c3921247bc0bea40590' -- Blueberry Seed
  UNION ALL SELECT 'KLzoW697agd2yrQbUQId7', 'headband', 'green', '7ef2fbc2715a9ec76986082f9514def1dd21dca75605e4defbf9e95bae236096' -- Flak Head
  UNION ALL SELECT 'KU15e6z-0ZekGOtFx5bJY', 'glasses', 'black', 'df146ba2172af548c8218eb67c893e785c9ea0d16c1e3c60b113894e2426a97c' -- Ninja Goggles
  UNION ALL SELECT 'Kd_R5KdEpe7TrN7ZRU94v', 'NONE', 'gray', '47b92bf00c682befebefae3d35aec42ce25fdedb37546657f042f3b7708be8d0' -- Voltleaf Plume
  UNION ALL SELECT 'Kdr6vpy-EMxhzjm2DoPGi', 'NONE', 'gray', '5528b5975a33b096b7396cb5125f9ad0b6cae300a1b2b6a4191cd29d062c64ab' -- Kinoko Sample
  UNION ALL SELECT 'KieS0hgBAWS_Ek_-7GtHK', 'NONE', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- Wyrmslayer Keepsake
  UNION ALL SELECT 'KwgjMOya2XT6uYsgXbsh6', 'NONE', 'gray', 'ac82622b38ca72dff555efa7b703be798006e75da3dcb76ef631df8b278102b5' -- Common Hunter's Chest
  UNION ALL SELECT 'KymzsdOT1edwokLGH1T-9', 'NONE', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- New Item - KymzsdOT1edwokLGH1T-9
  UNION ALL SELECT 'KzITKJ5BUQRz5QuYWw-0B', 'NONE', 'gray', 'd0d3efc6a5fe7f280a6f968fe93b32f03fa996be33dac7312fadf810b2268a8b' -- Unmarked Cargo
  UNION ALL SELECT 'Kzx7F3FsKMqfWNNVhpMbG', 'NONE', 'gray', '701c8586a243271505ab0f8210b804ec953093df14f6881f656bfc71c002dde8' -- Scroll of Metal
  UNION ALL SELECT 'L-sFjRGAVL86ulBKmLy8R', 'legarmour', 'red', 'ea31dacc092d90dcaceee73fb32048fb511ad931de77ed6cc543f654b540f690' -- Crimson Dragon Scales
  UNION ALL SELECT 'L0yW5-ZYfvmBGMP5N-Svl', 'NONE', 'gray', '16c668ca05e1362df7d07290439f4a99e50d8012258036459e5fd495defefe7f' -- Alpine Lotus
  UNION ALL SELECT 'L6w37XhJ-KgE0_z0B5_PU', 'NONE', 'gray', '5a83680058747d2e3aadfdb7c12b5c48ca678e5788803f3b9f3881f5aca0400a' -- You know what it is
  UNION ALL SELECT 'L7dE2p9X5cSrs2E7NZyUV', 'pants', 'gray', 'd9766f920657c9a50b6897ab7845cd112be75173e16671f2142a1098c7edf3b7' -- Basic Shinobi Leggings
  UNION ALL SELECT 'LAXdwxslmOqnoaCQ00-0u', 'sword', 'purple', '8158cec8aad1f5b8548b9075f70507b6e36ed38780d717a28fd9d999356a3eb5' -- Crystal Blade
  UNION ALL SELECT 'LAZ8tsSVTsFckdujp_9rQ', 'boots', 'blue', 'ea8935afe8b599960ae90eca40e112b8bbb09df03b5799dcc491db0fb654ca39' -- Bise Soles
  UNION ALL SELECT 'LApaC6jp2yPRqQW9OuIA0', 'NONE', 'gray', '939bfaf6a10bfb1887518a718b8ae1ebaa055ab112a7cb104ff28cba65d849bc' -- Wound Crystal
  UNION ALL SELECT 'LGfxZnJvUSh933l7x-5PD', 'NONE', 'gray', '1add57faa6e0b7c236e47903817a4f2dcd6d26488839580fd3b25c00c2da8604' -- New Item - LGfxZnJvUSh933l7x-5PD
  UNION ALL SELECT 'LL-lQ14P3REM9t8RvIlMA', 'belt', 'black', '6c2c18199dab10bb5ffe6c76376bdc928599935035c47d93c70b316ac0ea4983' -- Utility Belt +
  UNION ALL SELECT 'LOm3u4TYAgPQQ16DPfT3_', 'NONE', 'gray', '61f16c3f5ba8b045883462d62b20cb8926da80aa10a56a0ab8afe09044e24b06' -- Solar Petal
  UNION ALL SELECT 'LXnvFbOKBm7NJ-SVcgd-J', 'spear', 'brown', '57cf51341189c09e7f64f6c5f5a77c74cdd27f162f49d271f1af50bd1b406f0a' -- Sylvan Conduit
  UNION ALL SELECT 'Lam37-hhmwCRPhVfNwzsW', 'NONE', 'gray', '6d472bca9bc0527ed144ecdb6dfccba6fb8ab9f7f4d6f31e7fe7a9cc81575421' -- Sunken Silver
  UNION ALL SELECT 'LbccOnzfsADLgTBPSHjKK', 'crossbow', 'brown', 'd1196410502730c1a7ef98bec71cbe665b2e6f629048ecb3f903314c52a8d5d1' -- Crossbow
  UNION ALL SELECT 'Levop_8tm8VEe1bd9z-Nj', 'NONE', 'gray', '5f3bf54d7e7b2acc6a162ac41c215fb3ab306401dc900503e9496f26972d230c' -- Unbroken Thread Vessel
  UNION ALL SELECT 'Ll0tEiDfhbAveShhmdKjl', 'NONE', 'gray', '391ff650bd687c0d82ead80118f724de1e8a4fe154bb6bec9d5da7cf14bc09a5' -- Bashōsen
  UNION ALL SELECT 'LmoVnF9I06ZPcYRsYuOr9', 'NONE', 'gray', 'd4c66c6939cd0eac58d1a9bf7341b0a8e5f7766f242a2a8588f0062121609c3c' -- Potato
  UNION ALL SELECT 'LnRVMzyVmVwgaKvTH52Zy', 'crown', 'silver', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- Ghostly Sovereign's Diadem
  UNION ALL SELECT 'Lq9uU5tfgntZNB_SLs0Yj', 'cloak', 'black', '4ef5060fcebea7a621a02dcc13c49d24d4fd0329cff501022fa4b8bf8308e25f' -- Obsidian Cloak
  UNION ALL SELECT 'LxGTlVcJd0JBnYlURar_Y', 'armarmour', 'red', '1b8c356669d5aefe421a8247a672ad086a2609152d2b4510ccd7e7fa3d26101f' -- Scorch Guards
  UNION ALL SELECT 'LyI7H9DIhW_l041AlqeUD', 'NONE', 'gray', 'e3e6026a8023a0f4ca8083c0b1016a0727b265398a4a21891ad68d47ec1fea97' -- Honey
  UNION ALL SELECT 'LyqNOjQq4natFX--29rdh', 'NONE', 'gray', 'a5ceb534eabc356b5680b0616e157fd86770363d579baf40ed8a1471534d5ee4' -- Chakra Laced Quartz
  UNION ALL SELECT 'M-0CPw9yBmmreLvJU6gav', 'NONE', 'gray', 'f6a891c48d4b4789bc4f3b711620cebf7c91a9ba0a985acd0607d2e514462309' -- Rare Hunter's Chest
  UNION ALL SELECT 'M031_8uiQ9O-vc5zoHLK6', 'whip', 'silver', '97bfec0130dc5c68e4a927cedb05447f484151bffdffdf282ab0b852f49221e0' -- Confinement
  UNION ALL SELECT 'M3UdoLW5WFx3Wb1aCqoar', 'NONE', 'gray', '509c1f377ffceb95c7c493770a39ba00dd9a7b1607ebfa449d2c7d2ab4aeaf25' -- Pizza Toppings
  UNION ALL SELECT 'MBxT8NMS0ZWVOsFBQKFD5', 'NONE', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- New Item - MBxT8NMS0ZWVOsFBQKFD5
  UNION ALL SELECT 'MEhSPU5bXKpx1_9Q2KeZl', 'NONE', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- New Item - MEhSPU5bXKpx1_9Q2KeZl
  UNION ALL SELECT 'MLBWIjP6f14FrUkBJ1Uaq', 'NONE', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- Lightning Elemental
  UNION ALL SELECT 'MO7lhudS9M7AZ9FTqU_bs', 'NONE', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- New Item - MO7lhudS9M7AZ9FTqU_bs
  UNION ALL SELECT 'MQ5mJqH-5MkQdtLGSZ5nb', 'katana', 'blue', 'd30ac704e7adb61c0df0fd3f3598c4ce55b783b2ecb5cb2ec507bfaab26b3f06' -- Thornsilver
  UNION ALL SELECT 'MXiiqPZI8tMADJVm9AHK1', 'NONE', 'gray', 'a8954d6eecf6b8ae589453c50200f753be07d924c680d5affe99247b5848e2b5' -- Eggplant
  UNION ALL SELECT 'MZZP7jWhRQHhxIT1XTr6A', 'NONE', 'gray', '13cb54836ae7b866cbcb792d89c3e49662ddcd0bb8a859bff5bde9dc664740e6' -- Gilded Treasure Map
  UNION ALL SELECT 'MZss7PaRLXlG9QhMsiRXl', 'NONE', 'gray', 'e56222dfbe4cdc90a59e80a4a687a2beae860585e0e554db52a02a1dcf0efff6' -- Heal Crystal I
  UNION ALL SELECT 'Ma8S90Nmbi0Xvm4u4FzJh', 'NONE', 'gray', 'ff97c58fb79c42dca3191f13dc0f29442c3a8e807f000e5aeda6c6ec3855a985' -- Sealed Treasury
  UNION ALL SELECT 'MaOYSCzv2StXSdGdWWa1w', 'dagger', 'blue', '6ef88e8401bc253efb5cc685f6f95cef0bed9eeff9153d197c38330db07339b5' -- Sealed Dagger
  UNION ALL SELECT 'MbPhG5El3UYjS5Bk2K3Bl', 'sword', 'silver', '49c576c4dca8e626f56a74cafda7a78a84a25b8d5e1d7513167a558681de85d6' -- Eclipsed Dawnblade
  UNION ALL SELECT 'McKQIkyiuX1qIN54qI7UR', 'NONE', 'gray', 'ad9f4b21f5246b29f90242fb426c64baf301f7dd4660877fe1a8b45c0a965b45' -- Fortify Crystal III
  UNION ALL SELECT 'MgHdY17GhAQD2kG1sxBB5', 'NONE', 'gray', '0addb08a77c6d562011311f7a64da12f06e259a57fc64f4a2c4bf31ed00f1bae' -- Eggs
  UNION ALL SELECT 'MlWFwQrhOft2LYX7WF70z', 'plate', 'blue', '5b69995ad5a839dd43ef5bca011d41ebc9e54a4a75cca27c3ea2d8efca11fe2e' -- Azure Dragon Breastplate
  UNION ALL SELECT 'MlupjXuO7OhAhr6k7JMoY', 'crown', 'gold', '48fe9b18f1e2a141af7e14c28b7de9dfb5d97059a61830a78593ee4aa911b51b' -- Monarch's Crown
  UNION ALL SELECT 'MnJjf3TDSNI5FaEqkQEmi', 'NONE', 'gray', 'b04f366f9f3ff72f645eeac50d20108daa036d2fc41f273d18b4f53f88629e7a' -- Field Tonic
  UNION ALL SELECT 'MskL9ctwDbnkfmSK8j0-X', 'dagger', 'blue', '16ba1213a58797cc6caf136d4d20ffb41eb9db78f9088fdf60f7f4f517f39591' -- Cursed Dagger
  UNION ALL SELECT 'N9J6pPyjGEniXJDnvmXk0', 'plate', 'green', 'b8d99b236896ee2f23d7ae2e9999693a774bcd25fdb8f97b107fb4de1b56f8bc' -- Emerald Dragon Breastplate
  UNION ALL SELECT 'NF4EFtGa8hyKH_IWxWrOa', 'mask', 'brown', 'e994fc26ff8a58227fd9e303c5fd00a5713747a44b2554ff0472bc2762ded339' -- Sealed Mask of Gluttony
  UNION ALL SELECT 'NUHTFivNE-evbcl5VJeAx', 'NONE', 'gray', '3c5dd320e4221d0d9f225d50cccf40bfba70a6dcb69448ae4588c0d4dae72773' -- Sukuna Silver
  UNION ALL SELECT 'NWZkcby2D9CGLUzkafRRU', 'NONE', 'gray', '10e1c9baeddfe73f65a86f2d925207dc802be4178a652d93711609fec3300551' -- Clown Catching Net
  UNION ALL SELECT 'NXNMrAwPSNlmUBhhbVxRh', 'NONE', 'gray', 'd66eb2555d5fc812e74477d0d415c928e4820a9c8d18392412e1fa956eb0e4ec' -- Shinetology Contract
  UNION ALL SELECT 'Ngsj1x0wl8_mKj1tGRscp', 'mask', 'purple', '3c831c7d6fe3ed77b2b4099addefd288cf6c78d6f4219cee9bad2721b5293953' -- Subaku Mask
  UNION ALL SELECT 'NnYP2epwQk8ej-q-7yuxi', 'NONE', 'gray', 'b9d74ca5e404685329df5460ecbc6217665c5ad3927064d1e17f99cece32a093' -- Sun Scroll: Taiyo Kami
  UNION ALL SELECT 'NpOHJoLl2ZdfoGGl530C2', 'NONE', 'gray', 'b67feb7411a66f1c2e5974dcb2b231d196ea130b34109bdf26f774f09bc40b30' -- Mithril Ore
  UNION ALL SELECT 'O3WBjMGJ-s5qrI3SepSIL', 'NONE', 'gray', 'ee1934dcfd1bbe893ef213af95e793a3fe06921233290031df54e61e892951e0' -- Shadeleaf
  UNION ALL SELECT 'O80MDQzDsXLkajJVPx8V_', 'NONE', 'gray', '239ced71c3ef54987746cb47d5a9c839b6f180feba31c6faf3449185ffeb2d9c' -- Sofa - copy
  UNION ALL SELECT 'OBhhA6RMLySBVYl-ssXat', 'NONE', 'gray', '1add57faa6e0b7c236e47903817a4f2dcd6d26488839580fd3b25c00c2da8604' -- Halloween Tournament - 1st Place
  UNION ALL SELECT 'OD7IeZhMapDA2gwXj7LuI', 'NONE', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- New Item - OD7IeZhMapDA2gwXj7LuI
  UNION ALL SELECT 'OFmJFchjLMBc4pgYSJ8f_', 'plate', 'black', '5eddbb5510020ebc5e9c3d6d2e96297d5d52f940570d9bd894c17bd218e09ce7' -- Desolation Plate
  UNION ALL SELECT 'OIw9FjNd-PXnSVzMtbclP', 'NONE', 'gray', 'd9949d2461479d867e47b9316d86995f0a06dfd960d0b4d076c63965b9c4bd74' -- Bloodthorn Cache
  UNION ALL SELECT 'OIwF4M35Rvky_qvU_-Eyf', 'NONE', 'gray', '0c09755f8198baa66ff57ae4564386d90d297fa07440a17f3aa35200f6001e9a' -- Pouch 1
  UNION ALL SELECT 'OK-q2AS9ASkmloBFgUk1_', 'NONE', 'gray', 'a279f9dac6127f5fec1891aec6016296ffa7747dd84826234a91781691a8060d' -- Apple Seed
  UNION ALL SELECT 'OL_cnpR4FOVJbezVlhmaB', 'NONE', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- New Item - OL_cnpR4FOVJbezVlhmaB
  UNION ALL SELECT 'ONMLl57L7o0MivjhySHMA', 'NONE', 'gray', 'ff97c58fb79c42dca3191f13dc0f29442c3a8e807f000e5aeda6c6ec3855a985' -- Ornate Chest
  UNION ALL SELECT 'OXN2xhQHsap0eoSFbgXv4', 'NONE', 'gray', '8b59918d16baa4ef76a9d69c459cd8ef134ddfded2d1f3f79f4d32a59ef6df11' -- Recoil Crystal I
  UNION ALL SELECT 'Oal0VOlgkiYwK3NZAg5Jd', 'belt', 'brown', '6f18c78d636a943fad1a6fcead97008515905f02d40acda3650ec80c956bf45a' -- Scorch Belt
  UNION ALL SELECT 'Og-Y8BEJ5fcAtLAGPQjvq', 'NONE', 'gray', 'f5f41ad286a662e7ceda25943826c57137f4d1ba0e07632ca3a7145771160b9e' -- Pouch 4
  UNION ALL SELECT 'OpFNFZ2chOgXOm-P_9Q5m', 'pants', 'black', 'f5af936d31b282d9023c7f17ac9f2603e20ff302949f05e7e789dd03d282d2e5' -- Plasma Leggings
  UNION ALL SELECT 'P3R5lzRQQJMwM4JvzWVu-', 'NONE', 'gray', '07e21a4fc13fcd6a3598a664be32b463c043d6704fb5e8ff7f303a10e728cdeb' -- 1st Kage of Konoki’s Hat
  UNION ALL SELECT 'P5V1fPbpzm-Fq12p01C_A', 'trident', 'gold', 'fd74411c9ff8c80bee3eea669d99c806f08d5886cd62d8815bcc9d90cf0d9abd' -- Jingu Bang
  UNION ALL SELECT 'P71MY-CSimGg9E7v5zWaQ', 'armarmour', 'blue', '2813db88f2f4c14c8d73d599d80a2f0d32ac78c6e3416164106bd254761e95f5' -- Azure Dragon Claw
  UNION ALL SELECT 'P8blSysgMtpciGgo_ZMMl', 'dagger', 'blue', '8bc25ac60df4e45e86fef3df54042f3668948c0e091a76fd33c9461836b8c403' -- Diamond Dagger
  UNION ALL SELECT 'PJdYGU3d0EzlwfPXbYgC6', 'headband', 'black', '9a286c5153270e523975eccb61fc7a0efc5a7016bcd050765a7f4554478998fe' -- Desolation Helm
  UNION ALL SELECT 'PK53p7GDUgIwT-uFXzJLZ', 'NONE', 'gray', '03ea8a5767eee187100e49990e973b4291fc69f381f7d85edb2083a5f7bca74c' -- Mushroom
  UNION ALL SELECT 'PLFMUOsLDYa9evFzYVxb3', 'NONE', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- New Item - PLFMUOsLDYa9evFzYVxb3
  UNION ALL SELECT 'PNYIVIHwSJ9AiFoeXYFqy', 'NONE', 'gray', '2208f18610e4f996efb223b5a1944a92574c0b4e2f5e53a7eabde022da7cac92' -- Presents
  UNION ALL SELECT 'PRc2glrHugsdNqZEKI6yt', 'NONE', 'gray', '64b5a52106779e58b0c9994ca08f309f526034947542119fd0668dfbb4b8d552' -- Pizza Sauce
  UNION ALL SELECT 'PX1K1COX2FlvNypkpGeQg', 'NONE', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- New Item - PX1K1COX2FlvNypkpGeQg
  UNION ALL SELECT 'PbdBW9u_7zqsBQwbxtgd1', 'NONE', 'gray', '9c1c31f983d41939a1ae67ea450780f6f9d0d23590b9b01b24324f6fbaf5df73' -- Yūrei-bana
  UNION ALL SELECT 'Pem3eOQ5EYyep0Tgkzj2_', 'NONE', 'gray', '40d0f1fe6512d3d7b1ff033bd342831ce92788fa94efda0b20f36f4f091041ac' -- Potion Sample
  UNION ALL SELECT 'PhP5ZEF5iVa97jcumJ15c', 'katana', 'blue', '147697d6c02ab1077e2b51b5fe6df3dc3d9d9176f8368bd1668c69594b4cde3c' -- Aetherion
  UNION ALL SELECT 'Pp_6ZixXnnGgD1w1U862i', 'NONE', 'gray', 'a2bc06e2aa19bfef666bbdd4e3a53691248505ec88458c930870671b4abcad29' -- Jewel of Life
  UNION ALL SELECT 'PzLjwhfMromUDvXNvCm6u', 'NONE', 'gray', '9fede506c9176725c8f7a26ba12b8c2fcbea7fb89b961b7382894553adc55253' -- Pouch 5
  UNION ALL SELECT 'Q1nBWBsZvZkqEn7tgkg48', 'gem', 'blue', '711bdbf7e9f34aaca117b0987fdd3a6ffa32d8c34573f36d9726ff01622b206f' -- Water Crystal
  UNION ALL SELECT 'QIHMBV4uzMQ1nTP1Ol1IK', 'NONE', 'gray', 'c29512fb49b0f880b72e99071f1ab0e795e1719e3b5887ee3abe4305440716c7' -- Bread
  UNION ALL SELECT 'QV2BgPDDtaNSagQr_j7zz', 'NONE', 'gray', '92774a641033d2bdd57753ee30a6ed42dc0cfd3db9169c2b9315e5addbe8f630' -- Chicken
  UNION ALL SELECT 'QWTkvCjouQRC1QDtoOT-h', 'NONE', 'gray', '917a1d8784176c6ab9444dae64de47a0d4e655bbf9a2fa988852163810a4b770' -- Potato Seeds
  UNION ALL SELECT 'QYH3R-3Inkh5CBsLn265N', 'armarmour', 'blue', '1e5f852e1bd28089a1c4a9e0b56e0e0972f3305e8a21ad3dc83ea5671e8ba147' -- Elemental Guard
  UNION ALL SELECT 'QcC8M2NZAUdhYZZegNE4J', 'NONE', 'gray', '3786d41f0de9ce6a61691852ccfa970ff6637117ec7c0be06fa247d9d4882531' -- Fortify Crystal II
  UNION ALL SELECT 'QdI69OPqqsX3gm166DX62', 'NONE', 'gray', 'd22cebb2fba3047e5f2d9e47be7f62f775231b6092284ab840d0855bb0d0bec5' -- Amp Crystal II
  UNION ALL SELECT 'QeQtevFEEL766JJQZ5tWK', 'NONE', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- Test Variant
  UNION ALL SELECT 'QhQ1uVl9j3JDQzSsQuQsS', 'legarmour', 'black', '38ffb6f25a9138c2e3208965a3587f21fd1081e04a964a0dea147e81f1dcd827' -- Shadow Dragon Scales
  UNION ALL SELECT 'Qtwn25mKs09Hyq6TB7u9F', 'NONE', 'gray', '3c4a514bc42d16c670b343c3385e01c34e3674ae9b5b343939e96c508f94efff' -- Moonlight Antlers
  UNION ALL SELECT 'R4I8RbPsDqME4PV46vrBL', 'NONE', 'gray', 'f3c5bc490786c78a36113dbf0d3c51909ae3abd4bce21587d222fe69a429f7c1' -- Small Fertilizer  Bag
  UNION ALL SELECT 'R5G0IXf740mYqmvqwiYaX', 'NONE', 'gray', '91465f577d73480efcbf191f2ac03d71c6a6514033bacdd743dcc1a0e0b0647f' -- Kitsune Egg - copy
  UNION ALL SELECT 'R9G_uQRpiQaa8N1Ilwxte', 'pants', 'brown', '84afeb046fa845116d9e4a1ead1a3a0ec2d98b8a2baed716bad264644897418f' -- Scorch Leggings
  UNION ALL SELECT 'RHkDltHEtWiBJ89KggWmY', 'staff', 'black', 'a467a67f068612eb51649efec9fcf649d97c16dbb3062281686aa84200d98c8f' -- Elemental Staff
  UNION ALL SELECT 'RIK6tVrKHPEJHz8B_y9dK', 'dagger', 'silver', 'e42102a3b19fa9a1b986b46a8395e131a14c18e7799a133fc959cadd19701301' -- Zephyrfang Kunai
  UNION ALL SELECT 'RM9DjOswzqNTRWnd-FsdE', 'NONE', 'gray', '13f2409c004c4f68d4564ad0f5aabfa7cf88fedf3a44c5d53d399f542986d53d' -- Dr. Kim Disaster Potion
  UNION ALL SELECT 'RVasXH1xAcut0P8RfvsCC', 'armarmour', 'brown', '2c584ae9fe497f54ae2652b084a480ea2128325c71f4f33cbcd7803c9634c777' -- Kaeruun’s Ruin Claws
  UNION ALL SELECT 'R_xTf5Fy8EDcrJrRCwAcf', 'NONE', 'gray', 'b95ad3f273441aa9b3a7da8c98514b9b550ffefd326b4a9bd4ed57ff80e6b47c' -- Senbon Needles
  UNION ALL SELECT 'Re5nm3c6JjZgC9IalLreH', 'NONE', 'gray', 'a27f0a72ad3d3e16a08cc247c7579ff0b7677ef33978e9808db0c3179f92778f' -- Iron Ore
  UNION ALL SELECT 'RpFcFm-Z_GxbFH4GGaG7Z', 'legarmour', 'green', 'c8067bf395a2fa0e3ff342ef2fdb123cc936c663443dc0ab8b2f70541fdd437e' -- Flak Legs
  UNION ALL SELECT 'RtKMesZKmHSyV9PqyGcjy', 'NONE', 'gray', '45b2d41586bdc00fc35d5a97671095986c5628177f9bd87386d832918f4ca35b' -- Pile of towels
  UNION ALL SELECT 'S-YnvBsm0hdAO4PPGnU6D', 'NONE', 'gray', '1d5d1c881c882414d64d5f4a4d7d443683cb00948a7988bdf0583fe09edf967d' -- Loom Signet
  UNION ALL SELECT 'SBDJ3wJ9dQZlrXJ0mecLA', 'NONE', 'gray', '83b5a832a0dba58636d2a5524e74b8b711a0ae23148d79f699e7d2f092ac89da' -- Headless Rider's Skull
  UNION ALL SELECT 'SDwiBkdtjjbqEkolTQphH', 'spear', 'brown', 'fd295aff0df527a6e5dc6df6c953f858db49787148770df62c0b3bc2b099fc91' -- Pointy Stick
  UNION ALL SELECT 'SPyb1Df6im2zc8IONIc9_', 'plate', 'brown', '29eea50d260c80c183b43aa98bc2197470e160548a594599db112c1c515184b5' -- Kaeruun’s Molten Carapace
  UNION ALL SELECT 'SWQpaXB8csJWL3zZMTz4r', 'NONE', 'gray', 'f6a891c48d4b4789bc4f3b711620cebf7c91a9ba0a985acd0607d2e514462309' -- Rare Gatherer's Chest
  UNION ALL SELECT 'Sh0dEnqn8tsUw9TWpguRP', 'NONE', 'gray', '856f22607219484ddc2327221164600f926fdca52996ad004d03fbeac2183930' -- Widow's Kiss
  UNION ALL SELECT 'ShaED6ebzrrg6zXohvWBv', 'NONE', 'gray', '6858ee9cf998100e258bd923d1bca0d6697d60f087e8511fbf6cd5248f0c543b' -- Blueberry
  UNION ALL SELECT 'SjfA4Cmaj_CeXxtU397gc', 'NONE', 'gray', '6bab0b40796d2b4832bf78d557d6345c313a198228440f088b24b7f7695e9703' -- Cauliflower
  UNION ALL SELECT 'SqFyiWVXmokGIm7FO2114', 'NONE', 'gray', '358be98cc668919be6be01f1c0990dcc5a0a3fc861618d8c2ed833212150bbd8' -- Voidshade Petal
  UNION ALL SELECT 'Suj1eCaga70nYSKnM02qU', 'footarmour', 'brown', '79fc47f405a1d38b5274cd86bc4bfb90c73832eafbc9af2c4e5d8c43e0321f6d' -- Specialist Soles
  UNION ALL SELECT 'Sx6OQA0c0kUuekFJY3Qo0', 'NONE', 'gray', 'c519c54d80c7976723c9d6909a4828e891fbdda6e01bc67da6288bbeb79c967a' -- Amaterasu Prayer Beads
  UNION ALL SELECT 'T2suAUBwdOOCp3Yr6AaSV', 'sash', 'red', 'c67109fd4ab05f10e82b171ba4c1b23657c3b561dc88368b4cc26377edf6ce49' -- Sash of the Crimson Court
  UNION ALL SELECT 'THo7rfzP-S82_43aN8fs3', 'NONE', 'gray', 'd0d3efc6a5fe7f280a6f968fe93b32f03fa996be33dac7312fadf810b2268a8b' -- Skyglass Coffer
  UNION ALL SELECT 'TLjdSkY5kiaoD1n49y_3j', 'NONE', 'gray', '6f29e01d6d9d3efd2176f9ca84d67c28d81e5060cefc4d6288bad6854f88d3ec' -- Ember War Cache
  UNION ALL SELECT 'TammshplER6gu0Q4De_gG', 'NONE', 'gray', 'a0a8bb3115875638acaebb9567615561512a402159045553bbf042d8f79f266c' -- Fujin Prayer Beads
  UNION ALL SELECT 'ThsuhY54LknDlcNKLTEQA', 'NONE', 'gray', '2906ca6cc6c508bbc6f6684ef9ccf0ac3740a0c69575944766f6e1784fea714e' -- Mask Core
  UNION ALL SELECT 'TkLC13yWtETa5-Rep1QXG', 'shirt', 'black', '0b2af8dd9cb560fe78291a859971dc31e85168177f1eff2329cba8fe3593657d' -- Basic Shinobi Chest Plate
  UNION ALL SELECT 'TkvhR1pm-EwFeGPC8yNA0', 'armarmour', 'red', '863a88c0012beb099010ef9ff239a51945b911479264ea87d0930f4e337bfba1' -- Crimson Dragon Claw
  UNION ALL SELECT 'Tok8MLoFVcLmJ1ITw4mZ0', 'NONE', 'gray', '5263a1268a441498f7608e75739dfaa572839355ecadfb8ab39db0c5f7c3baab' -- Saki
  UNION ALL SELECT 'TqQS9xw4rEeGx2LUMSPVa', 'sword', 'gray', 'f2818eb651d8a107ee625e1b0f7a462f7c3375d6eb74eae0aa1304a0e64165b7' -- AI Blade 40AP
  UNION ALL SELECT 'TrKR2WskoIRI7ifainRau', 'necklace', 'silver', 'd5f2d5f728323b4888a889bf5a612b32af16ad977c03c030a97cf462ecce1217' -- Wildhunt Fang
  UNION ALL SELECT 'TtYPd-LcXKeK3sMuhq1TP', 'NONE', 'gray', '2045950c490a5761e249b8290efa9f64e3a52514a47ad48aada3247465713877' -- Elite Smoke Bomb
  UNION ALL SELECT 'U00YHAnwAJFgM4sHg1vl8', 'sickle', 'black', 'd57b79e77e05ce879dcd2a9c5ad25ab5695bcedda5c752100a8a33d7d5963064' -- Reaper Bane
  UNION ALL SELECT 'U0S2bR_OGTcFVh_UBMjlB', 'NONE', 'gray', 'e725dbee3f446787294b50a87be942ed01460563b76f39256f2d2b76ce96cf11' -- Aiko's Pen
  UNION ALL SELECT 'U6LFNfcweghWuqU-c4P-O', 'NONE', 'gray', '87b56a58651b09a892299ff414d6e887c2511c130f4fc2f1743e54268dfb9dbe' -- Gale War Cache
  UNION ALL SELECT 'U9QppWhGBn_nGAQ_Wk50P', 'NONE', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- 2 silver reward
  UNION ALL SELECT 'UBUdXGw26FmHpFq5AH7x6', 'belt', 'brown', '2fd51874708907b9afa5424269a22066ad84293449976d7c00df7d4c3da9b783' -- Sapphire Belt
  UNION ALL SELECT 'UEZu0xWy40AuYQrBLTa22', 'NONE', 'gray', '332942fec0dfc010b77476f0f53b8db0f8376cf3acac1ea0e1af32c7f2a2e8a6' -- Owlcat's Fur
  UNION ALL SELECT 'UIGk6S0B4AZST1rrewLoN', 'spear', 'orange', '511fc3e9385be620c14ef42a4092bc2276426327885fd8a4ce4f20ce2714c31f' -- Tectonic Spear
  UNION ALL SELECT 'UJMra3bIY3GVK1-I4GGva', 'NONE', 'gray', '6df346a784ce85625904f5528b7574bbe1385a86fa160ae16332778b72610265' -- Smoke Bomb
  UNION ALL SELECT 'UNDbo9P2QFRxMdk4XGmpJ', 'ring', 'black', 'ab6607ad897594811ea0f1994a8afee290537baf194786201378223f7a428c6b' -- Reaper's Band
  UNION ALL SELECT 'UR9lJEsp7F-B0JeN9HrU4', 'pants', 'brown', '85d0305796b52be0532560f0420b47e7458a4fca5321e5d74a331be04bf355b2' -- Sapphire Leggings
  UNION ALL SELECT 'UUBUDwotIh_clrBWp3b_9', 'NONE', 'gray', 'c9404cae19b774d222288247a237ce6a68442ede94d6f4fbc392db4d9db7eedf' -- Onion
  UNION ALL SELECT 'U_vp884X6iwsgUVnGj6GR', 'NONE', 'gray', '3f66a7ef7eb47cb4bc45efc0209b22c5578aaa698613099a4b90808b561318e8' -- Tiger's Scroll
  UNION ALL SELECT 'UcY0iTcV-VaXZs4q9VTtX', 'NONE', 'gray', '33e8fba689af3c608a6a3fe1f5a767196b23a0e16a59fa7cb1d078bbd17ebfe9' -- Godstorm Eclipse Inheritance
  UNION ALL SELECT 'Ug5m1PfABEBHFy_WAusLC', 'gem', 'yellow', '24085dbe9b07e783e5ad4e8792774062be2cf1da25384925544828b274208a8b' -- Lightning Crystal
  UNION ALL SELECT 'Ug9hxLyjkooBEYBbIG96C', 'NONE', 'gray', '4ba099dfbb848a42dae81d13815ba42de01af9e416f8e832c303d9820caa0f74' -- Collect Them All
  UNION ALL SELECT 'UhiDAW6daxZ4jDHvOGibv', 'NONE', 'gray', 'd2fe8408c38a159b20f89888263497b5622c3372129bae86b12b922fcda3f140' -- Orb of Glacier
  UNION ALL SELECT 'Ui-fEmxr-9Dqi-NGuEmk7', 'skirt', 'brown', '7d9c3ad7d6e25a59fa5725baa0e49c245bcd7d8e15f96e715194f324dd5dabcd' -- Kaeruun’s Ashen Battle Skirt
  UNION ALL SELECT 'UzI0nWa_q1Q3b2fQdfvNv', 'NONE', 'gray', '5da855a935cd679e64d3cce0af3a67e9448a125afbb215b5806ee74431b92e17' -- Twilight's Requiem
  UNION ALL SELECT 'V7se_xiWrZ2aBoHWLuO_N', 'NONE', 'gray', '1b979306fa7201fdfda85d5ffd5a1b84a62c107a308413d372ef87c7d4c54ba9' -- Kuraokami Prayer Beads
  UNION ALL SELECT 'VMfaLekqnTOj0weavey6W', 'necklace', 'gray', '791b46fb08ca788052f3d60da4b1cc31cafada0ed5239175decf13f43d75b1af' -- Drained Talisman of Grimjack
  UNION ALL SELECT 'VOditPJ3X2id0yC-F5Kz3', 'shuriken', 'silver', '43de325633568582687eb79c26d2d1cdbb192da066178adb349dddc1cdc669f0' -- Shuriken
  UNION ALL SELECT 'VPAQCqtNYO9k_JxRpiNh1', 'headband', 'black', '8f28af4c7787cf0682e62bb355e835e9fb617f8d76a093303ab1b250b597a16d' -- Elemental Helmet
  UNION ALL SELECT 'VPLmBobycTYFLhB4qX23A', 'NONE', 'gray', '2f75f86752d4dd99941073ad342516fe3682c2144ffac76c4626af11b7cdcd91' -- Scroll of Blazing
  UNION ALL SELECT 'VSrOr497JFvg4NvQFEb_A', 'NONE', 'gray', 'e845f962c470fac4bb8e6439a8dd2cb9c5de195e56e98c9e7425bdee06651b5e' -- Cooler full of refreshments
  UNION ALL SELECT 'VTUt74ZnOkJCPSBM5X8qB', 'plate', 'black', '1ee14e2d2c4b27d098a5c75c7b398236ef4d08246da35104881543704aac8361' -- Scorch Plate
  UNION ALL SELECT 'Vjiu90WZ01UFm-PYXzWAC', 'NONE', 'gray', '9275ad3d7a0742aafc77b44d1523012fcedd934b99006d86446aab0ede631f88' -- Aegis Blueprint
  UNION ALL SELECT 'W3WoY8u-b_b2m5XVTZ-hL', 'NONE', 'gray', '199659555be19e1228ab1322ade50875e052f5ff01b91655aa2806e09813c61a' -- Sunroot
  UNION ALL SELECT 'W3lOjQhhIPUYPkIZmiNum', 'NONE', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- Countermand
  UNION ALL SELECT 'W5040X13S0qB58RgWeyyo', 'gloves', 'gray', 'e73db147a1e8250e65a400e981e813e1f9770866db0ebefda92aa4e5d7be5dc9' -- Titan Gauntlets
  UNION ALL SELECT 'W7Qy4PGjkRs_resLyTBTL', 'NONE', 'gray', '6edb699d5b103b9c66132489b7b927bfcae6c5537fa12a0269c8d524e65fa72f' -- Ten of Cups
  UNION ALL SELECT 'WAi3_w7BeUcNqnflI3qwz', 'NONE', 'gray', 'e948116805d6648e554ba163a07543509f006089ae2a4f9df11d777af54e296c' -- Dummy Armor 4 
  UNION ALL SELECT 'WDSYRRF3TOMLrWVrA_wtj', 'shirt', 'black', 'fd545c68b6b574f443d9f0c552ae89edd5e1f51843cfd89bf479bddea7faf763' -- Thermal Jumpsuit +
  UNION ALL SELECT 'WOZAR8VXUceHHTUMThzSu', 'gem', 'blue', '0e6089d19d1190f933524812eefe98fd5bbfd7ecb374495a2d221ff72d4c5fc3' -- Storm Crest
  UNION ALL SELECT 'WPDAduxkprRA4PXXwf-Y9', 'crown', 'gold', '512bc3da4eb7d3476102ca79251b65e6b378165af72107a41fae0ec41ddbcda5' -- Sealed Crown of Wrath
  UNION ALL SELECT 'WQYgF20VXz1qggJrIgv7V', 'sword', 'black', '95958f2504001aea7cf81c07343930a789d4e86f086c754056744717c3385f1f' -- Bloodstained Blade
  UNION ALL SELECT 'WZf8gIpqZTm8u9rimRTVW', 'robe', 'blue', '02d054feea43a2ed0cf4ced484ff6d5caf6d0686fe6675348d038bf7cda03bd6' -- Elemental Plate
  UNION ALL SELECT 'W__jUR0eBDphibzW44gQF', 'NONE', 'gray', '1e4ccd4ef43344ec859b53491d3f0b206672771c7c2e74cc7872f47497cc83cc' -- ID Card: Sorin
  UNION ALL SELECT 'Wc68sUMJqcjttr2lLtMc-', 'NONE', 'gray', '3cfdc568a701e2233d0cac685c36be59bbbdf8d99a0fc9f58f51f1b08b0ea294' -- Larry's Tackle Box
  UNION ALL SELECT 'WgXIvANXaffar1zCYcEKf', 'NONE', 'gray', '4c8e3d7daf93fbfb5c49c10877619baa3721f1aa857cf918a5063e01d8857af0' -- Bloodcore Ore
  UNION ALL SELECT 'WgjbuICAqrLq1y6wmNHTd', 'plate', 'white', '6bd757f3b499f55574da2aefb3ec6c2928dd27ed19473c343de8cd4e456e9ca9' -- Kitsune Armor
  UNION ALL SELECT 'WlYWR3Fit50gKxDUdnZXt', 'axe', 'black', 'a87ffbfbd35920761bc1d04c9f05c007ed09d97cfd226724cdc5b4027a9a3323' -- Soul Harvester
  UNION ALL SELECT 'WoaNqRnyBBXRwmKbq8h1D', 'dagger', 'blue', '243eadcfe6c4421c77f2bb959d78f26d3a729b84e4871fc55cde37ff8d292c28' -- Kaiken
  UNION ALL SELECT 'WrysFacmHs7ip9KvDUQGq', 'NONE', 'gray', '7a8ede9ebd5125f3fb50fd4482676b5cf06fe78c2c677568ff628337d388b933' -- Absorb Gem II
  UNION ALL SELECT 'Wt5B-XJaQO1KeLZZi4BQl', 'NONE', 'gray', '3c5dd320e4221d0d9f225d50cccf40bfba70a6dcb69448ae4588c0d4dae72773' -- Draco Silver
  UNION ALL SELECT 'WvEjdMN0uHCbQhjJy96Kr', 'NONE', 'gray', '1e4ccd4ef43344ec859b53491d3f0b206672771c7c2e74cc7872f47497cc83cc' -- ID Card: Mira
  UNION ALL SELECT 'WyeY2g5DyUoTf-80_tszo', 'NONE', 'gray', '3c5dd320e4221d0d9f225d50cccf40bfba70a6dcb69448ae4588c0d4dae72773' -- Q Bag of Silver
  UNION ALL SELECT 'X0-snQ-GNGpqn4w5Ir2M0', 'mask', 'white', '7890498352e883d9965cdf82d41da31bbfcb23d7abc59479b43442fbb8c980e3' -- Kitsune Mask
  UNION ALL SELECT 'X09Fs9kyxIj6ZZcM3Hkfr', 'boots', 'purple', '8491dd2a43d7f56be0502f26cb6782fd8817ad31b5793a73ea43f97a17274dc5' -- Plasma Soles
  UNION ALL SELECT 'X1D7lrqZz31_kNGXs6MK4', 'katana', 'black', 'abd12f5010cac6ff87af52fc8fc9f1c1f74a8809eddd3c58a7c576e4d892c4f8' -- Forsaken Blade
  UNION ALL SELECT 'X5q3Ww-yfCeJ3m6ZqPmmz', 'NONE', 'gray', '2f50e6e4057d20d5450631efad1b6c5ae760166ef344f26f2032cee56803ef34' -- Forbidden Jutsu Scroll: Rebirth
  UNION ALL SELECT 'XCUHuOaoQqOs8HDZyt4Or', 'sword', 'black', '18e60462f2afeb78113f3910d31b7edc24de36a639f1da9b211232a7e0279f55' -- Hachiwara
  UNION ALL SELECT 'XCkEfXHnoK6zgB5y5rhw5', 'NONE', 'gray', 'bb8349d3c7620332be22cbc001636e292e91c58d39e1fa7e013255fc08c58714' -- Tsukuba's Panicked Letter
  UNION ALL SELECT 'XMsOqatPbFXEEJPtOJ6os', 'NONE', 'gray', '61f2106adf15ca81e8e604ca5d03ada66b2f1f577a134f6d0c62486fcbdd2839' -- Damage Crystal II
  UNION ALL SELECT 'XOO82n43HAsrjZbvOSUd4', 'NONE', 'gray', '58f8c552a24a9c8be4f062ca81f6511785dd33ac205a3c09ee5ba0b6e7d38736' -- Orb of Shine
  UNION ALL SELECT 'XQCPxK-WdQUCPigjVop1Z', 'NONE', 'gray', '87191187c40fbd87cc1b4acd46a52ed8c86404036ca7636da568599406c346ab' -- Seven-Beaded Rosary
  UNION ALL SELECT 'XTnsdgWblnfVV2-enGxwc', 'NONE', 'gray', 'a9687ea8d0fc3f6c0759ee3b4b59c27a337d0b866b280b98f6f257cb80795e7c' -- Exhaust Crystal
  UNION ALL SELECT 'XUMREbUUEUGXX2vaiwlO1', 'katana', 'blue', 'ae4e3a2c2b2e4c7f48ecbebabf9dea473a2afb79eab502bcf6187f6efc0a9b4a' -- The Blue Edge
  UNION ALL SELECT 'XX8TLmUNJtqeiGM1T99tD', 'NONE', 'gray', '21958e434a705239f9abba7c0a92d3cb3e491352d5bf7c4df962c771e52baad4' -- Pill Pack
  UNION ALL SELECT 'XZfVErGEkHpPiPtPa7_VC', 'NONE', 'gray', 'bb4d956ed3cbcd514761fd6a259c45f502e7fd390a319d1cb073dcb3ab53b880' -- Forbidden Jutsu Scroll: Nexus
  UNION ALL SELECT 'XhhoU_Y34R1uop8WuUx_U', 'NONE', 'gray', '4ba099dfbb848a42dae81d13815ba42de01af9e416f8e832c303d9820caa0f74' -- SY SY
  UNION ALL SELECT 'XhilCv1Hq4eNt-Wddok-m', 'NONE', 'gray', '7cb22f3db6fd4d5ea5389c5b8103d2f7af011027e1cd7feca3680a745dc28e36' -- Skyglass Serum
  UNION ALL SELECT 'XmFscRje4vUzUorOI5plt', 'NONE', 'gray', '4d51db5169601c7b3049f10e4951aa78bfac3b4ad756afca6cc5531f566c00e9' -- Small Health Pill
  UNION ALL SELECT 'Xq9lxOrJx0z5yfXjg2P7T', 'boots', 'black', '3c4ca6277e63a9eabd40c7cc0029bd603f20d290c95d21c5269e8edd773cf85d' -- Desolation Soles
  UNION ALL SELECT 'XuJXXQLXkbI9CMy13dJyG', 'NONE', 'gray', 'ee1d8994bcdfeb8dc959e7cf0683677ae1aa8d78d59ef1e30d432d68cba21f6c' -- Clump of algae
  UNION ALL SELECT 'Y1GO3wJjnWlXLi6K7ZMeV', 'NONE', 'gray', '389d4934ec4a8d9842ddfb45272611b4e079b3a10fa954307e59f7eca5da365f' -- Vital plasma samples
  UNION ALL SELECT 'Y2V6a7gUu8ojLcOYn8eZB', 'bow', 'blue', '5217e0e8e8c728659309a3da8660e3ca164b66cc23dbcbfd5c91454220fbb527' -- Stormweaver's Arc
  UNION ALL SELECT 'Y7QqCGuFqpzb329vc2xjJ', 'NONE', 'gray', '3c5a84e5504156bc2e27f33dbc9571fea996d74673ec3c0d1c2ef320f1288349' -- Dont Die. You're Too Pretty 
  UNION ALL SELECT 'Y8lCO3hAPivjpTSZQOuR2', 'NONE', 'gray', 'dd0e6f18a16d319e38f18f7840e14380a498f3fe34dbe2254c41dd5ee4305c52' -- Wind Scroll: Aerathiel
  UNION ALL SELECT 'YF2lcQ9IcM-MhQU8nOlPO', 'boots', 'green', '2a5e0eaabfb3003e14911b644f200305f0b86828610c9f424ce86cf81c547e26' -- Flak Shoes
  UNION ALL SELECT 'YKEmqU90hrfRAOT-XaIKD', 'NONE', 'gray', '7d100d2796f22f13ad59a92c9f711ca7e802a03a10852ce86e0dc62121740713' -- Beef
  UNION ALL SELECT 'YLOPemGfJGKkwV3DqT-09', 'robe', 'blue', '02d054feea43a2ed0cf4ced484ff6d5caf6d0686fe6675348d038bf7cda03bd6' -- Bise Plate
  UNION ALL SELECT 'YMFBNPVKAjHNvkdAGrcZK', 'NONE', 'gray', '3a0b75bb00c3029533a9533e2467486f8ace0ec284b95bb62d21f80b7dd5b64f' -- PVE Potion Bottle
  UNION ALL SELECT 'YMzUkPsD7q968PzLhg1uf', 'NONE', 'gray', '87251348e6f889080ff58d9838d2bd4c136cb551dd756b7b4babe67ab9483f4f' -- Scoring Markers
  UNION ALL SELECT 'YSPiFD9kmYt3pZ2j3GRFD', 'armarmour', 'blue', 'b289ec914f381b66ea19d72b25425813c6a2c02e0d2aa859150b64ed08e69b1a' -- Ocean Guards
  UNION ALL SELECT 'YZ3k1X8U84Er7r24_vYfz', 'NONE', 'gray', 'e1676482e67029cf8a111eb0d0aa6b453d8a04b53f5adbcf902cafa1c8e455e3' -- Syndicate Note
  UNION ALL SELECT 'YfP8NN3u68EIiSBW725p0', 'necklace', 'white', '032df84ea925d7c41ad416caa793d0f8103e04b134d88005f39cdeb78dc7a0c5' -- Lunacy's Price
  UNION ALL SELECT 'Yo1xlMce3pXJLchha9hJw', 'NONE', 'gray', '948aaec821dcd0c3bfb157e0d0e4d136837a2f9c283f5cc77e31659d02369c0b' -- Silver Ore
  UNION ALL SELECT 'YqQ5dZb1nKHS8yqnLL8hF', 'NONE', 'gray', 'fe63d7f1172f1bb2aec0a24459d5579ba2f52982b0934bf0e88a0b5d360b42a4' -- Ice Scroll: Hyouga Yui
  UNION ALL SELECT 'YssHkW75PtR9WptulWywV', 'NONE', 'gray', 'dcc3d0fe7085ec5fad53fefc488f6d33f0b7feb12c15e3ce3ce9265ea49d1e15' -- Corn Seed
  UNION ALL SELECT 'YuI94RWzRFdZUpTAZIx4h', 'NONE', 'gray', '038712b0a6f8d1f4fa166dc2c3b8264fe35f3cc5c82609e458da0a87741833b5' -- Pumpkin King's Seeds
  UNION ALL SELECT 'YvxXX5doB6wUsn7p8YPPc', 'gem', 'black', '29633997c081583546b7b8e54edc8a192af0ad11404db9ff328c6aa47f696d03' -- Black Gemstone
  UNION ALL SELECT 'YxKgPqbgEeiPvZWBknxvW', 'NONE', 'gray', '9a044c4f4cdd613cf1a05af9b04c41c5819bf7f0d302aff3cf495b8fb6107084' -- Fool's gold
  UNION ALL SELECT 'Z-JdppXvrSokRymXavpOw', 'axe', 'blue', 'c253343d27b6b5e24bb81cf6c10906e612008af26af0a9cc16bcf6ad204ef789' -- Yuki's Frostbite
  UNION ALL SELECT 'Z7JM5yxPzAN7U6dyZCnMO', 'katana', 'blue', '09158c5c92dbf192d6ef5745c7586e4314c3df927c19bb55d73e0ba68a863a45' -- Tachi
  UNION ALL SELECT 'ZB-QHBCunfhapU9V782l7', 'dagger', 'black', '7acc78a400ae242be6694b114d4cf9b7255b1cb2bae3692b2f3f21302d88c783' -- Blacksteel Fang
  UNION ALL SELECT 'ZCMizjlADoeT1WuGcckeZ', 'NONE', 'gray', '0053fe96f5be0fb65ae7ca6e7e4088786887b7e41535fb04765986f405ac1bfc' -- Shard of Willful Steel
  UNION ALL SELECT 'ZHHFba1VW9JrDXdWrbtrv', 'NONE', 'gray', '7c78b0a110aab7f52393890f5a6fb4067c26dac1c824f892c3b55587f31bcf19' -- Mona's Mermaid Song
  UNION ALL SELECT 'ZLUFDFDC50X1cjZTgydzh', 'NONE', 'gray', '023bae19d18443c0e85fc7e0db107b186676bee172a2df8f6ee30d32ff7cc734' -- Frozen Crystal Idol
  UNION ALL SELECT 'ZM04-oSZuOoBncud6zIG3', 'NONE', 'gray', '14714e1fa138312cd0d6c0b160dcb783b7a27d7ed64790408a160f713c9a05cc' -- Robe of the Fire Rat
  UNION ALL SELECT 'ZRHGfwypUYLUJIRGcxw2Z', 'NONE', 'gray', '21dfd210f8d925c65cc5c061222b5e2b7ef239e730bb639a19cda4ffced2222f' -- Larry's Big Catch
  UNION ALL SELECT 'ZRrluzsDengJNuRYM_lQ6', 'NONE', 'gray', '4a8f13f1436a08745cde15a77a9ecdceba062b0bcf5630d900da0e37d29029e9' -- Scroll of Renewal
  UNION ALL SELECT 'ZSUdrzzgorepP4CQrBfEk', 'katana', 'blue', '1a3a9173ef8a60331bb4ae819e88bfe39984068ee0b57c72a4c58a315f9bea60' -- Skyglass Katana
  UNION ALL SELECT 'ZSqAUkR_gDFPD7PYtbX8g', 'pants', 'green', 'd1c27665bc4ad725a2134596690f55e05a4c46395478f9e6f7939c1f9194cf60' -- Kendo Leggings
  UNION ALL SELECT 'ZZOrFciKSJazAtkW9nt_7', 'NONE', 'gray', '7c534884bbd5b2c128f4015bdbacca648e31e966bc4feb88507095fde73cb8bf' -- Wave Tool Pouch
  UNION ALL SELECT 'ZaTCUYIgRUoB2CBRo7pLY', 'necklace', 'purple', 'ec6755753ec477dfc48ca30f701724139e08f28008d4e345ce9719eb1099828d' -- Eclipse Marrow
  UNION ALL SELECT 'ZgPsIengkviTysQBnooWA', 'armarmour', 'blue', '0eb17987841157c1b97cf1b906030db29d74ab468ac7f6c897cec930e722bfef' -- Genin PVE Damage
  UNION ALL SELECT 'ZhXD29UHVXX0rD05YGDgG', 'NONE', 'gray', '2ad8eb96d49f3fd8fa50fc92a712a0d359f9f849ae137fd63d2c9942760a26ad' -- Bolster Crystal I
  UNION ALL SELECT 'ZoGWziCUzryOdBAm72exJ', 'NONE', 'gray', 'd083188af39475e246ce831abfcd4c2636592b201273c0fa431bdeeb38c7cc9e' -- Potato Sunflower
  UNION ALL SELECT 'ZuPPzB5vgkLF3l9m31xEP', 'piercing', 'blue', '1bc8529dda100f490110ce3e799a223e7ae572aad291b69a9b326954356b7956' -- Sealed Earrings of Sloth
  UNION ALL SELECT 'ZxhY60DL63SuclPd2OnPv', 'pants', 'black', 'f5af936d31b282d9023c7f17ac9f2603e20ff302949f05e7e789dd03d282d2e5' -- Elemental Leggings
  UNION ALL SELECT '_5152PR1inHUEZUBjiaHJ', 'NONE', 'gray', 'f4f9b9cafb52ad67f3fb354fca72af970f804a0894e04dccb5f8fe83f0930ffd' -- Venom Cask
  UNION ALL SELECT '_8HEbybzN5QPX8vUG24Tk', 'NONE', 'gray', '50819d0ba6007b80c1c8eaccecb08d3e69252cfddd1bc889ea7a2878ed5fc647' -- Colored Jewel of the Dragon's Neck
  UNION ALL SELECT '_8z8xD2GPZK6WGrlCqV0B', 'NONE', 'gray', '2e2bb98c5a740c1aa93fa9cb86c028477e6838fcf68076fed61c626a74cbd86f' -- Mosswolf Tuft
  UNION ALL SELECT '_CI8W2944oJVyR2mDTJ1Z', 'NONE', 'gray', 'ef37cde62bed5c9379815e07f961b213a808274621f2788976e255521148d302' -- Old Scroll from the Sand Golem
  UNION ALL SELECT '_D8hWBKaDzUEwTnLOTvCP', 'dagger', 'blue', 'fe52dec0de5fb43678007f0eaa5ac76cd4ebf14fe4dbad1163979d6aa1351b47' -- Robber's Friend
  UNION ALL SELECT '_EVMCAUxvlT8FG081fu4a', 'robe', 'blue', 'd378b34f6a5ff49e2360a37c71aca4718581b0f47b40e69f18cbb714108aad08' -- Coat of Diamonds
  UNION ALL SELECT '_JYBIKp2yspE-lxvmo24t', 'fan', 'green', '1e6f8013ee7b3bd0caeeaf2e1ce25a2f8c6f0dc95afbf34429dc28b90f1cb6ac' -- Gale Fans
  UNION ALL SELECT '_LBl_abDuOY3jVwq9eHKn', 'NONE', 'gray', '9bf87f1948bc301eb26d1e89b7b5ab4e18ac71a17be3c34bdcb9708fb603c942' -- Copper Ore
  UNION ALL SELECT '_M2UwSUpP_szhbuicUoSC', 'NONE', 'gray', 'c2e8a1e536011e5f5f165e01a70eb607a6365e08f767fb282f6fc0b02806c218' -- Scroll of Time
  UNION ALL SELECT '_T49KqN408thmoYm2CPsZ', 'NONE', 'gray', '42c0d77aaca8916b6c21c04786671356e0b4b635356812bee80552586ef2a431' -- The Deterrant
  UNION ALL SELECT '_TwmwcFlwZmmbClEF8cjR', 'NONE', 'gray', 'ed32c65c743dab2b087a6740a8ee14c9fe2a9513d192d15afa03b6c383958aef' -- Murkshade
  UNION ALL SELECT '_yLw6vKw_JNWAgwhgsdqw', 'NONE', 'gray', '8b92afa5b7151bc278ae95f91cbe48e67246dc333f39386aa73fec3dccf548f5' -- Whisperplume
  UNION ALL SELECT 'a0jUU9QC806UqZq1kvk6d', 'pants', 'red', 'b2f74cba9c26a577e71063438db7d426398a81d12c5cc0da1ab2eb0b9a35293c' -- Brawler Leggings
  UNION ALL SELECT 'a4QaaaT7B4XlRZyZmNHc4', 'armarmour', 'brown', 'cec14025077292e2b61f7fdd8fecac4a6bc7910d6ffc72cf265cc180a62c9437' -- Kaeruun’s Ruin Claw
  UNION ALL SELECT 'a7YzCTnB8jzQMGowWmuXW', 'NONE', 'gray', '38bda94510b266425319a0dda3dd9bf5306b8bd228945a08a2b14ee64a2523ca' -- Wind Scroll
  UNION ALL SELECT 'aAZv8maejPS94mrGsQFiW', 'headband', 'green', '943554f564f1ae53334956566b5d07b20caf2ebaa59ada9ccb2fde7b0f1ad91e' -- Kendo Helm
  UNION ALL SELECT 'aHFNuo5RkKpDcaOBLIKiu', 'NONE', 'gray', '321e18b2b90f6de61c793006d91b255cacc9584c76329fc04e521821afdf70f2' -- Chart of the Captain's Watch
  UNION ALL SELECT 'aL0otNeY81F8cFkl_r0Ej', 'NONE', 'gray', '4ea955ed4a0c7c27619e2c8bedd71360b095a8e0f2d126528e9b9e222ddb2114' -- Rendezvous Note
  UNION ALL SELECT 'aRGyZfC_2-9DrqbaGm2dZ', 'flail', 'red', 'd710e953b9637cefbb2c22b7d0be507bdf4f2eec41f75234982833ec30ab519d' -- Dr. Stein's Blood Flail
  UNION ALL SELECT 'ae5u8QFD2pCYTAtczYuO8', 'NONE', 'gray', 'ee875fe98379119eabb274a5a64fd36e152e761d074294aa52fd8cf59dc4410e' -- Offense Crystal 1
  UNION ALL SELECT 'alepJR43IRbCEOD427gGv', 'gloves', 'gold', '4456206b0d6adc1bc9e5b1daa7def798f4257b0b476cb5d2fe243c3f1e260799' -- Brass Knuckles
  UNION ALL SELECT 'ayiRmSjWs05lMPyL3G-1d', 'NONE', 'gray', 'f3e97d16c9f4d01dcdcfa0fe9f002930caae33ac7a531772996d1b078722f14b' -- Fragment of the Skyglass Crown
  UNION ALL SELECT 'azCAd-Dy8A5zgzPPUOIW1', 'leather', 'black', '63a84aaa18d307ea5e5983c35cc36f934695f6d95b0f0583d1ea4e28eb9601cd' -- Plasma Plate
  UNION ALL SELECT 'azW5XIYUZQRt8QHd0BFGm', 'mask', 'black', '9844a20c9c1d53179702ac015e042bedebca3f6c2f72b6b2f9977c4145752d67' -- Blacksteel Balaclava
  UNION ALL SELECT 'bFwgTNYwC5kzvhxx5v1lx', 'NONE', 'gray', '53eee1fb38334c69c0af7b1dfb6e60f8945d32ba832f68ac7497620ff046cdb9' -- The World
  UNION ALL SELECT 'bMQs8yRazQsNhN1RjWiSD', 'NONE', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- Clown Outfit
  UNION ALL SELECT 'bNQv6dz6lLyoJI_fX2hn1', 'NONE', 'gray', '7bda0ec18f1af869a09c3abfdd5e56da5b04d7ab7a42d4157c45f81d3ff21b49' -- My Deepest Regards
  UNION ALL SELECT 'bVfWIr0y7kHGc4yw1gIi4', 'NONE', 'gray', 'd5ed334315a9174653ea67f96ab7595dd77ac01d032dcfce2cd4d330aaa80dc6' -- Bone Flute
  UNION ALL SELECT 'baQjOExMctrvsZkuTrpay', 'boots', 'brown', 'b4c95ec3c834fa1513d001264a1445fb622f869acd3e103ec982902ff13d6e3e' -- Kaeruun’s Dunecrusher Greaves
  UNION ALL SELECT 'bd5sJs8I6YEUaGRmNYMq8', 'NONE', 'gray', '27a975f9755b7089e7f1deb3c019cd0d43ab0851a51eafe02ccf8dd983623408' -- Scroll 6
  UNION ALL SELECT 'befDA_5Q3SsnbiaJEdSBB', 'scarf', 'black', 'ed428f255efdc824341c2d9b45059f83300dd9844b8e5ecb110778f3cecd6255' -- Hollowveil Sash
  UNION ALL SELECT 'bgt6b8G2Zi0EayMSHcO2N', 'NONE', 'gray', 'e735fedb91717f54469a8cb378eff770fa02dd35782e3a3507118fc7f8ca9442' -- Stun Blocker
  UNION ALL SELECT 'btW77HZh7oIezwJhYleeE', 'footarmour', 'brown', '79fc47f405a1d38b5274cd86bc4bfb90c73832eafbc9af2c4e5d8c43e0321f6d' -- Radiant Soles
  UNION ALL SELECT 'bu_Yzoe7kXOmD61yYH_CR', 'NONE', 'gray', '868a8d79ae6738406e697aff564bf685cef1dbf004bda178bbdb6de0142f03ca' -- Key
  UNION ALL SELECT 'bwamtJ4EycVE_lG0gaYf8', 'belt', 'purple', '4fb02e6a2b52210ae6aa7ea1348ccc808628d605eb11a1bba9878cc0d917dae4' -- Radiant Belt
  UNION ALL SELECT 'byQ3Z9UtHzaQwvWJEG9jv', 'NONE', 'gray', 'a62f8b595464f9cca4c22e7fe9f2055e7a195895022407fc989a671827675945' -- Ruby Star Ring
  UNION ALL SELECT 'c5dUPtXmCedfKssqiwbpt', 'NONE', 'gray', 'e3b692546f5929aa2f50e72f1c202fed3ae445ab92f41a96c1f8516b54dc29e1' -- Mystery Chest
  UNION ALL SELECT 'cH89eJ02IjHDCxeeGBc9o', 'NONE', 'gray', '19213e3e74efd975a5df485e7c88e97ab3c178dbcc0f0a3c47495610e6adeca9' -- Talisman Fragment [↓]
  UNION ALL SELECT 'cLXXf8RJv5l9B_gGsYN2a', 'katana', 'purple', 'd161156829e491375d67dadabe98136fc9a6546b53f1634ac2c0ec8806fca415' -- Stormrender
  UNION ALL SELECT 'cNQ4s2UedYrhF2tt3L2Sm', 'NONE', 'gray', 'ea8b4bc04438af9167e97383a7b6698984934b251e1965568081945c975a08ee' -- Orchard Signet
  UNION ALL SELECT 'cO2z6U2QQNRCTZZjZ67z2', 'belt', 'black', '6c2c18199dab10bb5ffe6c76376bdc928599935035c47d93c70b316ac0ea4983' -- Utility Belt
  UNION ALL SELECT 'cObgNhqS_lSYEbspWKufL', 'NONE', 'gray', 'f18b4f07b013bb12807d7dd439c8b60980b3b174bc2bd226d105ea822427f688' -- Old Scroll from the Lake
  UNION ALL SELECT 'cR-xWQX8EatrB18C9PaiQ', 'NONE', 'gray', '82f4afcd5c9ddf28516bcf8000acc05b19bbc8e65f0bd32732f8243aaebfbad1' -- Phoenix Ash Bloom
  UNION ALL SELECT 'cRZT41zm5vhPTQwwn8vtv', 'NONE', 'gray', '4a1847299cdce8a046d6b8e2fed8e946585427909d4cb040013dce09ebe426cd' -- Chart of the Quarantined Archive
  UNION ALL SELECT 'caGxCFaXpUtT5uU9_AR_J', 'gloves', 'purple', '07e5fc1828a9b0e64486de39ad6b4e09f95b1aef41d3db23be20a078b9ad2ef8' -- 4 Finger Gloves
  UNION ALL SELECT 'ceHajLdSIxQd07L3wH9YH', 'katana', 'black', 'abd12f5010cac6ff87af52fc8fc9f1c1f74a8809eddd3c58a7c576e4d892c4f8' -- Reptile Blade
  UNION ALL SELECT 'cpY0Hg14jSVnLA4iTuyfw', 'NONE', 'gray', 'df5c88b1c808d91e80ce891d4dc4c1b8477931f44536ae80ed4440020a02cd7a' -- Celestial Thristle
  UNION ALL SELECT 'd0hdx5PdIsH9ITSsNn0JO', 'NONE', 'gray', '51d8608515248771443dfa7ec0022df25b78ec0de40589663d3b96388e17a85c' -- Moeru Chi’s note for you
  UNION ALL SELECT 'd2dJaAMxRDA2kYZDZ3WFH', 'robe', 'blue', 'd378b34f6a5ff49e2360a37c71aca4718581b0f47b40e69f18cbb714108aad08' -- Adamas Mantle
  UNION ALL SELECT 'd8QCyEaggQzYGV0Drn4fB', 'NONE', 'gray', '5221ec3b2b2896119816e1eb188c5cb44af1d1bfbaa955eadfbb08714fa1e5c7' -- Potatoes
  UNION ALL SELECT 'dC43E-VhpHNpFbE5EMAz9', 'NONE', 'gray', 'd5bb530f4c03cfc36399284427856a1216626f5e43e49d6d323d8b34b7f54289' -- R.E.M Hands
  UNION ALL SELECT 'dF2rv0HX-LwVndOZEpBdf', 'NONE', 'gray', 'fcd7501536c7161a92e5f5fb1c58c400ad47923f1a197b644017cbf5d7fb76d9' -- Kiln Salvage
  UNION ALL SELECT 'dLYXcST8dUXgLJcXa_XTC', 'NONE', 'gray', '067fede0547651e31942c0f45533e1f4678010190e57afa11efd57b925c72ebd' -- Corn & Cheese Empanadas
  UNION ALL SELECT 'dM-0kkFkJ38IyAuCr8Xj8', 'NONE', 'gray', '8699963995ad8e500160cfb5eac2c46c7d8a38dd2001a869a954068386d5588f' -- Pizza
  UNION ALL SELECT 'dM11KNt7fpvTrJ-UwVJg3', 'boots', 'red', '5fe0d6df94f8b4196370890757bd4d815bcbe27736ae3b46e957be2e0f7e0abd' -- Brawler Soles
  UNION ALL SELECT 'dRTqiMxkL5mYmIokiWyJP', 'NONE', 'gray', '31bbcacc53d0f9721b53b0d9aa9d35ffdd5680b02a6e23aba40d8eceee35fae1' -- Lunaris Bloom
  UNION ALL SELECT 'dUuZCVb8BdCObVv-qBx_p', 'armarmour', 'red', '954552b74347da5fc8712f72369d35ca99d8f3a3ba401a5ba5003ebfb9e28d5f' -- Brawler Guards
  UNION ALL SELECT 'dY00WA51Mr7-uS6zbcS3r', 'dagger', 'gold', '4a27e001bb0afb961fc52d04507ef8acdea1b34b6e857b1c0aeaed5d63d79bf0' -- Elemental Kunai
  UNION ALL SELECT 'dYY7TAC0Fm5jGWrFBa0Pw', 'NONE', 'gray', '7e47212ad1e8b1c997e1dfe12bb6b6fb61b03b8eee76b618955be18046290798' -- Whistlegrass
  UNION ALL SELECT 'd_NcVl4ahDktckHflgBbF', 'NONE', 'gray', '7bfb23e7e4354ad878dc2a21f628bb432e6f722f2b41d88a400359490459fa5d' -- Witch's Brew
  UNION ALL SELECT 'ddimnKkOaFn1uCOxigNx_', 'NONE', 'gray', '87fa5a28d6ddb88c56d9baa21a55b6ba9ecc8365024c52b285caac6875329855' -- Ember-Stained Edict
  UNION ALL SELECT 'dhRRW1ENB73Xd7T-DVXYq', 'pants', 'black', '697a7a61cee7a6953c4676db57899ba0e651ce4bcf8826d32158fb0b2cd95a49' -- Neon's Crim-pants
  UNION ALL SELECT 'drKYPuUX3-SY51x5RHAWF', 'NONE', 'gray', '6e38b372bcf95bc08ebb47288e52ed0558846bc78fca1f146fb43792857ef406' -- Explosive Pumpkin
  UNION ALL SELECT 'ds0pCohYM95gqjEFtuEWa', 'NONE', 'gray', 'cae53c4e1ad4f3ece728f2e4a391f203731cfc02f7f221bc437253749dc646aa' -- Pet Food
  UNION ALL SELECT 'dyKasrYgZYOY7ai4ec2zN', 'trident', 'blue', 'd9730d380b3032c78ac76a57f9840d855d34aa42a91a0baef8ebc0a94cc440f8' -- The Threefold Sight
  UNION ALL SELECT 'dz4YwPavTK8dbmHp9_3F7', 'NONE', 'gray', 'b60da6183b4b212d9c50b92fee58d28f6d9c09566ef73158b76934587b89bf80' -- Gilded Clasp
  UNION ALL SELECT 'e8YJ3dwJvXrHXruqsENSv', 'NONE', 'gray', '16e2e909da0578e29dce31227b8d90c8f57575f3fb73364d94330ae06c6b5051' -- Killer Clown Riddle 2
  UNION ALL SELECT 'eDtb6vAHFShsb8ZGlD_V0', 'NONE', 'gray', 'aa77f569e92125f719fb7820a68bac973c864a11c3f550728c2b86a77866f268' -- KGK Scroll: Flash Step
  UNION ALL SELECT 'eEIqP__Pw8yq3jQM-si5C', 'headband', 'black', '8f28af4c7787cf0682e62bb355e835e9fb617f8d76a093303ab1b250b597a16d' -- Sapphire Helmet
  UNION ALL SELECT 'eHEcrKs2kZ_H7CXzVAmdj', 'leather', 'red', '8ebeebf8795427b9c5fa53fae5f8b7080c4eca30a41ea8c1463518020854e90c' -- Padded Leather Armor
  UNION ALL SELECT 'eHXoPCV2QdZuKEs2ykGzS', 'staff', 'silver', '8a40bd353627d19a84cf539898e348cd58961eb78aab77b0d554a58980295dab' -- Iron Tempest Bo
  UNION ALL SELECT 'eJYAXn8laYaG9BcHuc67B', 'shirt', 'black', 'fd545c68b6b574f443d9f0c552ae89edd5e1f51843cfd89bf479bddea7faf763' -- Thermal Jumpsuit
  UNION ALL SELECT 'eL5qY9k21c7nfvgQiBaZp', 'NONE', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- Ash Test Key
  UNION ALL SELECT 'eLYL6l8oVG1UBQ8kLm25L', 'belt', 'green', '48b7c3e6f91c42202a7d65d8953f6cd8be825ec5358a3ecf2863622aae055554' -- Ocean Belt
  UNION ALL SELECT 'egvBUU2dhYsGJqOB9k7Pr', 'tabi', 'blue', 'a9884d2d4599df023f33bd3413d9a0f626184731acd560c08e254be7046736d8' -- Ninja Tabis +
  UNION ALL SELECT 'ekFpo7eJvvrk54V1fNxn7', 'NONE', 'gray', '8cf3f5708e1f53dc5564f0f9914f49dd7f5bf2c456723863ac42d0c1dd35f6d5' -- Glimmer Dust
  UNION ALL SELECT 'eomyjQgU2vtZBwgN74q5V', 'spear', 'blue', 'bd27374b5576453c19964d924b2e0cc4e52c25ade3d2dc0f9d85a07075725482' -- Yasei's Bolt
  UNION ALL SELECT 'f1nOooLwnIlLJpHgIcrbz', 'NONE', 'gray', 'a6a63a48a574dd5de487f77030b742d5337a7bbdb522fd687f061ee94ef82c85' -- Diamond Chakra Receiver
  UNION ALL SELECT 'f3HuJEBxvwyk2G2TAZYG9', 'plate', 'red', '441d3bedb8e37b4a3d7b0648b637a8c9e4d86b0d2106a74cfaae0af794f42b5a' -- Crimson Dragon Breastplate
  UNION ALL SELECT 'f5IvuLwZeJjs2I5bV2VjA', 'NONE', 'gray', 'd140b0e4a7da20b0a56200814b7b7c1243c3a82884ada021484dc3d03c627f3c' -- Dummy Armor 1
  UNION ALL SELECT 'f7JjDIyXAb0iyugbWIf3l', 'plate', 'green', 'f62fa4bf2804a9f2e73674954aba43eeb6b982170b22e61b08b88d6fd32ea8b8' -- Kendo Plate
  UNION ALL SELECT 'f9EM5LFOTrSVCS9Hx3BpL', 'boots', 'blue', 'f9f4cc5d65adb718ca4d15ef645e93ad7e371ccabc14f40e9eca72a15032bc50' -- Ocean Soles
  UNION ALL SELECT 'fD0vAHWGRIOuEQgGG9ZXO', 'NONE', 'gray', '46e28ece9385178073a8fa1975b957ce0a0ab8a71c8d36c46ef91031df5d3e51' -- Storm Scroll
  UNION ALL SELECT 'fDCSF_o_BZez6-CDFflhf', 'NONE', 'gray', '88b5cbb3a6fb04a954cf97824db99edd37c9e0638f6dbc3d32cd422b247a8eb2' -- Test Armor
  UNION ALL SELECT 'fJ70Qja34mW8AkOLDN-Bd', 'NONE', 'gray', '122656f957df1f6b06cf99fbfd210bb203bf5caaf93897cc77e67fd18ad39c0b' -- Wicker Loveseat
  UNION ALL SELECT 'fJsqyIEWvxiEAnD1wpYh0', 'NONE', 'gray', 'c14498f9b914fca5196ca5b9eaf5f88ee251e729cc64149f461755016404c3d1' -- Tsukinari Bell
  UNION ALL SELECT 'fLCzCAD_NLpLF-Yb2Ak8r', 'NONE', 'gray', 'c113e0e7728bc44e47117adda40d3094a9b7577b31bb80bc8e28790f2325183b' -- Riddle Fragment [ V ]
  UNION ALL SELECT 'fQsoAM8JSwwkH1YXSchvM', 'NONE', 'gray', '4f05c4f1a793e51a6b36e327b76aa5816403a9f6db6b56b5431cc8227b7f100e' -- Mising Cat
  UNION ALL SELECT 'fa-03qBubUsad8CxItCS-', 'NONE', 'gray', '413a5b9ee5599395e2a6a3abbefd6f141ea7b9bfb514aea940befb69c5866ff7' -- Gathering Experience Scroll
  UNION ALL SELECT 'fouSck835ZxcfXu_RWu3q', 'staff', 'brown', 'baf5da74ac54d4ea78c163d93a473b54372496574f07f9698d59d610f4891dc6' -- Grovekeeper's Crescent
  UNION ALL SELECT 'frPdUi7MRN178aoGZX4VW', 'boots', 'green', '37e0ab7bfbbf39eb029f708ae544a581a9b45ad6c6fd223169e080e534f09c5d' -- Kendo Sole
  UNION ALL SELECT 'g0hPGnF9lLYauTsjxqpAZ', 'necklace', 'purple', '355e7438dab670ebe0eb4b590b2fff10fd5dcdfaf532d64e8f1733e87c42f6dc' -- Godstorm Aegis
  UNION ALL SELECT 'g1OmUFPWkrrzh8ac9fvER', 'NONE', 'gray', '3c5dd320e4221d0d9f225d50cccf40bfba70a6dcb69448ae4588c0d4dae72773' -- Dauntless silver
  UNION ALL SELECT 'g7pyoQp8YS2RWJZWpPSkQ', 'NONE', 'gray', 'f0523bd9a46afd0126b3bd8a77d68c2fa8aca6fb117ed759c61a3239b58a43d9' -- Conch shell
  UNION ALL SELECT 'gBbDeZh8uKMUYW2t2JcKw', 'NONE', 'gray', '4ba71366f6c811a05a3019d15f6f2f5d7b7636cdf1320b0df7d0bf16da20954d' -- Your Christmas Present 1
  UNION ALL SELECT 'gIKW28_N5LQECzDFWXnZY', 'NONE', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- N silver reward
  UNION ALL SELECT 'gIRFsJYIpzgmYe9mEl1HW', 'NONE', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- New Item - gIRFsJYIpzgmYe9mEl1HW
  UNION ALL SELECT 'gSADjk5kPcQaTZYdVWtd_', 'necklace', 'red', '65d63e1fbb63762bbfd7a693a4e2e1ea6c0d26de827d692da71963097949b139' -- Emblem of Unbroken Flow
  UNION ALL SELECT 'gb6vxdzWTYZR--7s-4kTX', 'NONE', 'gray', 'ac82622b38ca72dff555efa7b703be798006e75da3dcb76ef631df8b278102b5' -- Common Gatherer's Chest
  UNION ALL SELECT 'giLeP3h85cqZbbynQRfKB', 'NONE', 'gray', '3a9d7c6eb9d20ca4b57b7cd4cf4c7149e27e4d165e5ad2c11e44ab719a698411' -- Cursed Mirror
  UNION ALL SELECT 'gzPZ_6i1kouHvzyrCIz19', 'leather', 'green', '1325d5e0f44e17d4d336aa6b76271c6915740eaf68231f519f83c6d25cb0b429' -- Flak Jacket
  UNION ALL SELECT 'h-V9uiuxbL7lAWkO6nZWt', 'plate', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- AI Heavy Armor
  UNION ALL SELECT 'h-d58UCSuHN8EZKbLjT5R', 'NONE', 'gray', 'a809b6e8da9d38788946393bc30f02f0b07286f74321bb6763efbb84f16648b4' -- Sage's Strongbox
  UNION ALL SELECT 'h-mvWaKK5vNNOwS5Y9KQj', 'NONE', 'gray', '44fd93227feb7f57f02ff6a5c5e7579b739c8fbaac35696f421a5e50cb7fd731' -- Energy Potion
  UNION ALL SELECT 'h2imLPDZTGtZSkeXrmyDf', 'sword', 'blue', 'ba27a0032f0f7a56013125035809740f7bb848ea8c5f0503c7e39ecd6637cf73' -- Celestial Lament
  UNION ALL SELECT 'h5VREG9-wcWb15QQyyTfH', 'NONE', 'gray', '1add57faa6e0b7c236e47903817a4f2dcd6d26488839580fd3b25c00c2da8604' -- Halloween Tournament - 2nd Place
  UNION ALL SELECT 'hDvjJp4aQlMW_jeYA8U_L', 'tabi', 'white', '6b354e3ca611621272ea7afdffe88913b763c38c01e245d40cbca5f62d48ba94' -- Kitsune Tabi-Shoes
  UNION ALL SELECT 'hJGakxgpaYL43r1CyqEwu', 'NONE', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- New Item - hJGakxgpaYL43r1CyqEwu
  UNION ALL SELECT 'hJzY3EzO6-WP8ZAw9ETJ_', 'NONE', 'gray', '5e391e04ad5778c4896eda30df3e6b81bc3a1b0e7fb0150757d0dba450246022' -- Pumpkin Seed
  UNION ALL SELECT 'hPO4lHQFNMGtz2Dgv-L4g', 'NONE', 'gray', 'a812571520ee41e9dc4b8c8d0e353acfd7e4d65e83898cd5273bfcad3e4948ec' -- Hearty Beef Stew
  UNION ALL SELECT 'hXpJwQqanTs2gOSwgHHFp', 'NONE', 'gray', 'f58213a65486d494a35e7c3f38898061b35350635da02e684e16df073e2a1ede' -- Jack-o’-lantern
  UNION ALL SELECT 'ha5JPFLjmKNrdP2fDW6uj', 'plate', 'black', 'be3eb17738dbf6c7bd2ed6c2db8139f73246e3569d8d53305989dbcf1465c272' -- Shadow Dragon Breastplate
  UNION ALL SELECT 'hcvHkfcYHP6qBEO_dRFl6', 'NONE', 'gray', 'a394ebf827fc91755e6202335dc24a9bd171fe413752c8669d859bcfea4e6832' -- Stonefall Tool Pouch
  UNION ALL SELECT 'heZTbHCjEACrJ-_Vrulq4', 'ring', 'black', 'ab6607ad897594811ea0f1994a8afee290537baf194786201378223f7a428c6b' -- Reaper's Ring
  UNION ALL SELECT 'hfOUSyB2yhXpfo0M9a8mv', 'armarmour', 'blue', '1e5f852e1bd28089a1c4a9e0b56e0e0972f3305e8a21ad3dc83ea5671e8ba147' -- Sapphire Guard
  UNION ALL SELECT 'hikAzfsQPCvNUaFw_P8vs', 'NONE', 'gray', '062f28c29ff4e27486ecd161508f5ada7598399b85ca78b585f764043934713a' -- Epic Gatherer's Chest
  UNION ALL SELECT 'hmWiJb_-Mo2tzd-ltR7yl', 'NONE', 'gray', 'f3c5bc490786c78a36113dbf0d3c51909ae3abd4bce21587d222fe69a429f7c1' -- Fertilizer  Bag
  UNION ALL SELECT 'hnosWG4cV_4hf8_Gidd9s', 'NONE', 'gray', '6853c1c80fddb993effcc2ad8c93a74207af448b294965a8892be637d56d4f9a' -- Okuri Okami Pelt
  UNION ALL SELECT 'home-armory', 'NONE', 'gray', 'c9e71467d50df254c82557bfcb63a1c4dfa77a62c6343ae3cdb2d971ea3c1f44' -- Armory
  UNION ALL SELECT 'home-bed', 'NONE', 'gray', '0d29e732bd5242c4e84aa4cd75df737cec3d2d1eb56ac3d87917431cb6c764e6' -- Bed
  UNION ALL SELECT 'home-bonsai', 'NONE', 'gray', '22ea69fd65c4d66f1c2b42ce3d81bb6901b385f315c763d57cbb54cc7e4e4cea' -- Bonsai
  UNION ALL SELECT 'home-bookshelf', 'NONE', 'gray', '1d5128c33fceffa487bb2f3b8de1accd60bc6a424bd14dfe50a1bfc62328db0b' -- Bookshelf
  UNION ALL SELECT 'home-garden', 'NONE', 'gray', 'fa14e4a611a232f24e4743bd9cf5f2e6a8bde6d5b8cbd31e3f9ab97d003d3bf2' -- Garden
  UNION ALL SELECT 'home-kitchen', 'NONE', 'gray', '64ce409cfbee269cb847ba395c947da9ac5ab5a1677c535e98e6b0c7161a27dd' -- Kitchen
  UNION ALL SELECT 'home-kitchen-utensils', 'NONE', 'gray', '3bc9097a4dad92d15781076c25e4ddcd586ff51cd74e0fcec91c4b9b8b5246b2' -- Kitchen Utensils
  UNION ALL SELECT 'home-lantern', 'NONE', 'gray', 'bfb8746f8efc3e8daa5be723d13b8b55620eef8863444d48dc195ffe2bb6844a' -- Paper Lantern
  UNION ALL SELECT 'home-pond', 'NONE', 'gray', '1737bfb31486d42c7ce6bc181741148be5932c1e9917c30222e29a5f2ba6c9fc' -- Stone Pond
  UNION ALL SELECT 'home-rug', 'NONE', 'gray', '0454bd609d8cefb2b73feebdb25b9109018c72588caedd6c8538472a46979b9c' -- Woven Rug
  UNION ALL SELECT 'home-screen', 'NONE', 'gray', 'b457b14483ba326da1a74b42ca5fd962642ccab0fa7547cbf147be0ddd1481a3' -- Folding Screen
  UNION ALL SELECT 'home-sleeping-mat', 'NONE', 'gray', '1f57a3087d673cb17d96067310cdfe87c7b42dda3f55b3c9856b8ff8580a8dc2' -- Sleeping Mat
  UNION ALL SELECT 'home-sofa', 'NONE', 'gray', '239ced71c3ef54987746cb47d5a9c839b6f180feba31c6faf3449185ffeb2d9c' -- Sofa
  UNION ALL SELECT 'home-storage-box', 'NONE', 'gray', '538bb7037572004b8b352eb16fdcf16042cb415d51fc5cd3c47dea640d54ddfa' -- Storage Box
  UNION ALL SELECT 'home-table', 'NONE', 'gray', 'f88c7793a1b9e611ce1798178e8f3b4039b95e4f3b2c6fa06b77d4d21a933832' -- Tea Table
  UNION ALL SELECT 'hqxvyi39CMsOLqAmr3uP4', 'NONE', 'gray', 'ad9f017fe8a49dd7094bdeada01beafdf54531e930e7885049b77b909f050555' -- Silver Thread
  UNION ALL SELECT 'hskZSE-PDKoX5NBA-Evy1', 'axe', 'blue', '7e298c3327a41c3badc191746db8aea59e6d5aba0eedeee290df4227535e72de' -- Veilbreaker's Edge
  UNION ALL SELECT 'htMEO9Btza-jqrICkbOmP', 'NONE', 'gray', '94c1f5dc85695d5018b9815c43ddb24d6b5c20f3ad813575f58b04cba7d11dc1' -- Cauliflower seeds
  UNION ALL SELECT 'hwoTWxDaik_QbSiS7eHuk', 'NONE', 'gray', 'bc72773c61d34415b2a654594a83d478979462114c93d0bf81de9ff42f2d1305' -- Heal Crystal II
  UNION ALL SELECT 'hxQjy9yMVBgjvpNoheh7B', 'NONE', 'gray', 'b9c4bd7cf7ceb6ca20c75551041b0cbb442a9c031fb7bc21b53dfa7d6e3aa67a' -- KGK Scroll:KX: Hollow Surge
  UNION ALL SELECT 'i0DnzFQ2UIIcKAnZPiWhp', 'gem', 'blue', '73b6f61a8c65c8dac90f5a1a043858054493c0342e29e881045d6b9e63f0c386' -- Rainbow Crystal
  UNION ALL SELECT 'i2lzi29f5B8yFVn-s22ql', 'shuriken', 'silver', '92692d51cae89f38ba8380be9f0daa2525c0fcc37053ca0ce8d15e0ce1cb2836' -- Orb of Shroud
  UNION ALL SELECT 'i4h4SoJy5HkufGImybycc', 'boots', 'blue', 'f9f4cc5d65adb718ca4d15ef645e93ad7e371ccabc14f40e9eca72a15032bc50' -- Elemental Soles 
  UNION ALL SELECT 'iBKQ2z2sDPZ-7DIe8NX_N', 'NONE', 'gray', '50cea0570ab3fa55f54ed69b72beca61d2906fb8c90c0b74c6cd587a7128bd01' -- Solider Pill
  UNION ALL SELECT 'iJ-FBnZinr3koRl2LWAyd', 'footarmour', 'blue', 'a7a92718bdca5ec3c027d7e76a15299aeccb207ba4504573b6a83464c096b112' -- Azure Dragon Soles
  UNION ALL SELECT 'iJM0kb1i6iNXjADJlZGV_', 'NONE', 'gray', 'bc72773c61d34415b2a654594a83d478979462114c93d0bf81de9ff42f2d1305' -- Heal Crystal III
  UNION ALL SELECT 'iWsYNDuU48gUuyfpWchCa', 'boots', 'blue', '5d093dbd18b5d228e0f938f62e72717873e5bd197f8e03e159f753a71ee5dcd8' -- Sapphire Soles
  UNION ALL SELECT 'iYNVCnkkLg0WAm_oRXdaV', 'NONE', 'gray', 'e4376237808c9dbfc000d13545ecf2c796d512f009d494a673996357ade217ff' -- Mizu No Odori Sample
  UNION ALL SELECT 'idCKDhuRO7HjcECKakxhu', 'NONE', 'gray', '67491065174fb0db5ae1cf3b4b5ad0c9b0a7a56dfeb7c8ca11f52e93a32957ce' -- Barrage of 1000 Demons
  UNION ALL SELECT 'idDi-ys-0meoPqsVahv5E', 'katana', 'orange', '8376d5e7f4560ea252b9740f4e2cb6b69bc89ca709ca011873987eba4ed31da9' -- Sunfire Edge
  UNION ALL SELECT 'ij3Sjy7PJQrSHHnFd8I22', 'NONE', 'gray', 'dea5c19f87bbe40087edac894bbdabb92ad91075250799a36976ec89595af6b4' -- Wish Bone
  UNION ALL SELECT 'ik1woJnvuV-ykMjJTqe6p', 'NONE', 'gray', '3c5dd320e4221d0d9f225d50cccf40bfba70a6dcb69448ae4588c0d4dae72773' -- Bloodstained Contract - TEMPORARY BLOODLINE
  UNION ALL SELECT 'ilovRTtpFLZfOFrjnqZnI', 'NONE', 'gray', 'f4631743b1873bbcf82fa2e6d33953094c1d4131f52cdc1ccdd8a5876450ce7a' -- Orb of Tsukimori
  UNION ALL SELECT 'ineOewnEWa9VF7SxKvelw', 'leather', 'brown', '6c32e56e42f0dca94b9850073ea3bf26925c1adaae3d2b3ebfedb977fddd8769' -- Specialist Plate
  UNION ALL SELECT 'ipczu2knFPA103pYhzZh3', 'NONE', 'gray', '358d342e2c5c28b3ac7c1a042fe562559d2dc42c156bf79cb778ffbbfb244ab3' -- Drain Crystal
  UNION ALL SELECT 'irXYm0yMYxyZqAdWVLrMl', 'skirt', 'green', '11e6e9391cbbb3dc8cb00ebd305e47d4ba2599a49c7e4baae2b8cd19f87d914c' -- Kendo Belt
  UNION ALL SELECT 'ixEKlJ0MmDrX7JoMNJVhi', 'NONE', 'gray', '75b96adce36af65c9933e9a10e38d70bf900703940643d588aae2fb615240bf8' -- Medicine Inro
  UNION ALL SELECT 'j4LgVM90JZ8xddJat09OV', 'NONE', 'gray', '3785948053a200ce0f3f75fba2c16ebe546a92e26c3573415ffdd31141cfef93' -- Yamidangan
  UNION ALL SELECT 'jA4RnRWCNQxlwTQ0-qQ7t', 'sword', 'blue', 'ba27a0032f0f7a56013125035809740f7bb848ea8c5f0503c7e39ecd6637cf73' -- dEt0uR's Chakra  Sword
  UNION ALL SELECT 'jCJv4N3JSiihuqnK0jJ7t', 'NONE', 'gray', 'ca05b9b486522746e4283d9aa8320d0277405b69aebb37a13fb12196c5f5ee82' -- Lastlight Lantern
  UNION ALL SELECT 'jIWO-k_WEL907SBLERJtJ', 'NONE', 'gray', '3c5dd320e4221d0d9f225d50cccf40bfba70a6dcb69448ae4588c0d4dae72773' -- Mad Silver
  UNION ALL SELECT 'jT6-tS3bhavc5ZLRc_LWU', 'NONE', 'gray', '1ff102ad7e7d2cf098aa7c4ab8b0ed0ad8ffe491d66073cdfed0270923f8b712' -- Absorb Gem I
  UNION ALL SELECT 'jVKAVrWDSScRXOaXF86TF', 'NONE', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- Aven's Test Item
  UNION ALL SELECT 'jWcYxroAB8EYbvETed4F7', 'armarmour', 'black', 'cdc6410b891df377641e4f975124ec89076198b0cfd8934f3f2fd26e1fdb6d5b' -- Shadow Dragon Claw
  UNION ALL SELECT 'jXcBqX8xcJWNtW3qAW-Lg', 'pants', 'brown', 'f423967789f843d82c4714540ee4fb11b11d860bbb1f85d735c49fd7e1e35142' -- Kaeruun’s Rift Hakama
  UNION ALL SELECT 'jdp_jZqYlTJ4T8RGo1l5r', 'belt', 'black', '56191d5553e2e295d75534117cc8559ee7c4b83289486018f22cafd172e8aed0' -- Black Belt +
  UNION ALL SELECT 'jfkGS8dgO5C0x-WBYcML9', 'NONE', 'gray', '4bec1f8a5418321344e81f8d8f1737d8cbf4902d2652a42b7e1a3a443c69aed7' -- Heart of Kuraokami
  UNION ALL SELECT 'jllSclXL51WZqYxQeryM6', 'NONE', 'gray', '94aaee05c9c35c3d625062f8a57621cf3a919691bed60cb365daaa400395323a' -- Crafting Experience Scroll
  UNION ALL SELECT 'jtefp5dfAYIS5MRjkw_1r', 'tabi', 'blue', 'a9884d2d4599df023f33bd3413d9a0f626184731acd560c08e254be7046736d8' -- Ninja Tabis
  UNION ALL SELECT 'jyOXmqLJniYjpA2xx6dBq', 'NONE', 'gray', '06fd525ef8031e664bfe1201f8c514b7160856b28b8863b3b62783689e469ef9' -- Smoke Pellet
  UNION ALL SELECT 'k-pkCFBjzqd9ikev4Ynrh', 'axe', 'green', '6d70cb22697ca21c30a799fb244089ae5667fc639e462506ef4f8f906a0cd011' -- Blast Axe
  UNION ALL SELECT 'k52rYPZuoTu01ypKPI7pB', 'NONE', 'gray', '3f4dfe95d0251c656548f7528c09ea798c529f8a43634c946d03ecfb9713ce56' -- Tomato Cheese Toast
  UNION ALL SELECT 'kE3NhRUzJCXGsxYaKTsWE', 'NONE', 'gray', '2c18154bf7021b539782b13a0482c24305574b0e6bd4e1efb55e33f539cd79ac' -- Sechi Ruin Alloy
  UNION ALL SELECT 'kFUUW33QBU6gBNWRyOTy3', 'robe', 'brown', '7c9d5e7aee7c2ba0fa5f00b386c7420570abeabbb7b06144ad3937bb895f0fc6' -- Sapphire Plate
  UNION ALL SELECT 'kG8JqBoQl51FKL10QO6Hc', 'boots', 'brown', 'ce8fc94c91c02deea850a583410fa3dd5b9ee1caeab1e163c4e7ed6fc2aec23c' -- Scorch Soles
  UNION ALL SELECT 'kIMZ4G6oLjytXXj0tBD7f', 'NONE', 'gray', '3264f710d88e996cfa8dea3e89fb7d7dcdbbc7e7918e7681aa04705705d20ac5' -- Unobtanium
  UNION ALL SELECT 'kNshju2IjLN8h0FvpNKgg', 'armarmour', 'white', '1bf7931a85eb9c95412197d1b4e196b678c2729da5761951f2efa50b92b4e957' -- Kitsune Gauntlets
  UNION ALL SELECT 'kOOkLHJ0U07lpsWRLlF7g', 'NONE', 'gray', 'a6296c09328446a5bc9228ee20ad2f296370414162f66793f2d9f6b6ae4f4173' -- Frostscale
  UNION ALL SELECT 'kRydr0n1dQpoPqn1LD5oQ', 'NONE', 'gray', '4e03a136447ca13c4a54e04052193c068e6722a040c9d3866b7ab54a97991ff6' -- Candy Bait
  UNION ALL SELECT 'kaMJjWb4cbcJpNutj3Auy', 'belt', 'red', 'fdfd16d9348834ab23050420a8729918efbbcfb162e67ae2b665d27eeb887468' -- Dragonmancer Spine
  UNION ALL SELECT 'koRQpwcAvT4BwMLgGu8Mv', 'NONE', 'gray', '35895e774a212843da8fdbad1edc482dc019ecccbf3c075713a02429a5298dfd' -- Tomato
  UNION ALL SELECT 'kqTm3Q2ervkn1wyWeFLIM', 'NONE', 'gray', '4ba71366f6c811a05a3019d15f6f2f5d7b7636cdf1320b0df7d0bf16da20954d' -- Your Christmas Present
  UNION ALL SELECT 'kuXRVV_fPmInLz5SmzJRa', 'NONE', 'gray', '36c4b706ab7336640ca901f0e9405149101e544612d807d7e06dafd57fe5d0ce' -- Test Item
  UNION ALL SELECT 'l1A2aWDyaI_QeSzaNr8ZO', 'NONE', 'gray', '4c431fdacf3a4019f529993291d4e85afc6662db92cf28fb8d01b5cfb7642903' -- Rainbow Cabochon
  UNION ALL SELECT 'l34MicBdZ4VzdrNFHvNJL', 'NONE', 'gray', 'f094496f602c6b225d9b3bf8061d47a803cbb723b5ad08947a96fc5ecf940e46' -- Panallet
  UNION ALL SELECT 'l3ZSLRe69gM5fiDbv4gyd', 'staff', 'black', '9e6d8393afb66b93b13ab6e890df4a2788c054f808c621b1585ab36369caf096' -- KGK Chakra Rods
  UNION ALL SELECT 'lAgqXhVe1q6KkioGGKbS1', 'NONE', 'gray', '726565bb070bb2016f19493cb7a21074f0ab93810cc4228a98bbef6970d4d180' -- Sulfur Wing
  UNION ALL SELECT 'lHoYU1tYk0bON7ut0_Gcl', 'NONE', 'gray', 'c0cb575fbae6e78e1ef0b2a3a81ed6663971bd5d1335072ea3b2f039dc250a66' -- Dummy Armor 2
  UNION ALL SELECT 'lL5ZMulR1HKQmbfyWykMS', 'NONE', 'gray', '4f73a99e011dc174247ab06dd10934cd832350248e1c59c1c68f96a933f6757c' -- Orb of Current
  UNION ALL SELECT 'lVS7X9E_xcAa2hrNWy5Kq', 'boots', 'black', '5871bff3e6e56cd30e7306f7d364a56b499edd2104d4752b9f8372ac05844aa2' -- Boots of Shadow
  UNION ALL SELECT 'l_BuHGeUWos1Pi0dX_Jgg', 'NONE', 'gray', '73dfd10d1634929e322b4d755dfb53e6193d766bd7b21df342f1cddb61131f11' -- Ofuda Moss
  UNION ALL SELECT 'lbrxeoekUTBmn3aCJjbWI', 'dagger', 'blue', 'a99545361ce115f6b51476098d66f1140425f24beab6ed5749cf8896df72c7f4' -- Voltic Shard
  UNION ALL SELECT 'lhWHqPsXjZCS7YGK8vr2q', 'NONE', 'gray', '0cb82c329a5b696de564ab83c10072e6b39c834041a4e45b6344a0859ae552bf' -- Full Potion
  UNION ALL SELECT 'llCOxrK200QbY2ON7uQ1m', 'NONE', 'gray', '3c5dd320e4221d0d9f225d50cccf40bfba70a6dcb69448ae4588c0d4dae72773' -- Bag of Prestige
  UNION ALL SELECT 'ls-0eURQV9hLjnaplhYaB', 'necklace', 'green', '8f546d8331440e3962638a1f113ae4821f6035849d324afcf833f26e95a422ee' -- Medallion of the Serpent King
  UNION ALL SELECT 'lw1O1EkySOBl6NyZlOeJw', 'plate', 'blue', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- Raiveth's Storm Armor
  UNION ALL SELECT 'lyIcf_XP3yb0saJLosUaM', 'necklace', 'purple', '355e7438dab670ebe0eb4b590b2fff10fd5dcdfaf532d64e8f1733e87c42f6dc' -- healingbeehive
  UNION ALL SELECT 'm0RZDUDnwQu_0BtOJgHi9', 'fan', 'black', 'f185d7e41b7d3bd78d810d8210c2988311104bbf7609258a52c46ea3f9183ce6' -- The Unwritten
  UNION ALL SELECT 'm2gzWPa1X4p-ue0ftyMCC', 'NONE', 'gray', '5cbf2fd5dc434275150830e13d9e53d15b8cd65f551f70d0c5783000f2394f63' -- Urami Drop
  UNION ALL SELECT 'm47XR6C5ELSL8xemspKP7', 'wide-hat', 'white', 'f19bedea13d376cadc2a3a0aa2cf510c7c1d41ad0d222780dce9bfae1b3f7b09' -- Samui Kage Hat
  UNION ALL SELECT 'mD0JCYI0MwGy1vTFQaxWv', 'NONE', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- 6 silver reward
  UNION ALL SELECT 'mDBpVrKfygS5V5EZgvcn1', 'NONE', 'gray', '7c5850da1edf99b46b325da1c890bc47345449dfd27b57c21c77d11e2c5bd2e7' -- Dragon's Scroll
  UNION ALL SELECT 'mMl6P4B7v6-_CyDo3HVG7', 'gloves', 'green', '1b5ce68939a169925f21408357aa89f95e8217c7a1357443ae3eb7a34771215e' -- Zombie Claws
  UNION ALL SELECT 'mQM24sM_G7eMUW2lU8AOX', 'NONE', 'gray', '8f7d04733447069fb52174ca062c43dc97527bc86def60fbbe9ca8afd1ddfb28' -- Amp Crystal I
  UNION ALL SELECT 'mQRuQ4GVVa0RhCrwZuS82', 'spear', 'blue', '6b617263c11fa0df9a21c9a2c592dea0f227cb63855cd716d936688e0ff48383' -- Thunderstrike Fang
  UNION ALL SELECT 'mTR5BsY-RszK-JQvSrR2g', 'trident', 'gray', '783709247a4f98de5cbce1f30c4b1d1e910a3b01ed66839eced73d38ac69d54d' -- Helix
  UNION ALL SELECT 'mdu4LFiHXLwaz9I2Wm8js', 'bow', 'blue', '80cf3e11de53a030a4dd990182ca12a460c88a19b4bdb9c98f1a7ce5aec9e33b' -- Kamunari's Claw's Mini Replica
  UNION ALL SELECT 'ml7suU9iFtuw6MfQpvzti', 'NONE', 'gray', '1add57faa6e0b7c236e47903817a4f2dcd6d26488839580fd3b25c00c2da8604' -- Halloween Tournament - 3rd Place
  UNION ALL SELECT 'mlCQd6nbegRsYiO28cTPp', 'NONE', 'gray', 'c2ee80663df413d59851a0a268181f0e7a33ad423ab00aff58f386807efa4f77' -- Paper Bombs
  UNION ALL SELECT 'mqCCZGSfXUNL02B4H6C9R', 'sword', 'purple', 'a9dd974085f5597c51c2ddf785fc527dad8ee6d59fec2af3d6ac5554f985d772' -- Whispering Dawnblade
  UNION ALL SELECT 'n1HSk2z11HyWulh0zIIDi', 'NONE', 'gray', 'a8317e33abb603152e34ed50fe488dea4a71da9c9d2b4c5d0cb2a8be07088f7b' -- Jack's Lantern
  UNION ALL SELECT 'n3oinmROYkjerrEIo7ha7', 'NONE', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- New Item - n3oinmROYkjerrEIo7ha7
  UNION ALL SELECT 'n79FRHs-TM6oPNgSlez_w', 'NONE', 'gray', '1add57faa6e0b7c236e47903817a4f2dcd6d26488839580fd3b25c00c2da8604' -- New Item - n79FRHs-TM6oPNgSlez_w
  UNION ALL SELECT 'nAAfu3ya-dkVaZeH7LycZ', 'NONE', 'gray', 'cda1ec4892c34daea0a4534dee5cfae8718eea5127ee0693702897c4d591a818' -- Legendary Hunter's Chest
  UNION ALL SELECT 'nK5tVwfev0Z5-Vjq4n1lD', 'NONE', 'gray', '30547f876a895a4d6bd7e5a854e3a621d783902034cb23ca6a5e1d339092e1fb' -- Chakra Disrupting Needles
  UNION ALL SELECT 'nRfQEOtjKHz2YX1RvExBd', 'katana', 'red', '4bee7afd9dd25df6d26559195b17b6c575879bed8bb8f61d88ba43d61f6b77c4' -- Subaku Demon Blade
  UNION ALL SELECT 'nThwqBAKNrl1_4UTL-D_m', 'NONE', 'gray', '3847deb5e9d35f99cd1918038c6ba3ee18f5bf27f0c84d29d78b7e84602640a0' -- Chakra Pill II
  UNION ALL SELECT 'nbLC37UzBamthKXvZsgQB', 'NONE', 'gray', '606d8db1586af0c41579f82329601df2271e3089e876296c4db5a17bf5ca22f2' -- Chart of the Buried Cache
  UNION ALL SELECT 'nfWmtBy4iUdeVtqqxdRDD', 'NONE', 'gray', '7e48f1d5ee54bc4846ef34ca33ff3692009fedbd46176d9289679dae2e1ca913' -- Axel's Frost
  UNION ALL SELECT 'npOljgp_QZUUd6g9wPBk0', 'NONE', 'gray', '3a5311fac8a9187192b3d57efeda223dceed33ad0ef9623bfbba66fdbe31b45a' -- Earth Scroll
  UNION ALL SELECT 'ns_gm2WnfP9kG1ZvuVrwR', 'katana', 'blue', '40ae5ab1d62787f08a701f716b0ce1d86f2727f235e92a9cb39f056ae75bea6d' -- Tempered Shūren no Yaiba
  UNION ALL SELECT 'nt86U0rf3NqrRhLwgrgmB', 'NONE', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- Wind Elemental
  UNION ALL SELECT 'o5gt4qVznK1nhBfXvz1er', 'katana', 'red', '4bee7afd9dd25df6d26559195b17b6c575879bed8bb8f61d88ba43d61f6b77c4' -- Subaku Blade
  UNION ALL SELECT 'o5oWESM3hs2I2204tGntS', 'NONE', 'gray', 'a565efb8b0a6f4e86b2211e696001ca4cd92c90cc6c800ec4884801a5e412f63' -- Shield Crystal II
  UNION ALL SELECT 'oBCih-iUI5lBsA_J5cyJ9', 'headband', 'red', '8b839ef73d318630a636be687d750870505f665f8edf4e66665d16f08a347a47' -- Scorch Helmet
  UNION ALL SELECT 'oI5pVHRbPpH9OcNnbWPMN', 'NONE', 'gray', '9c1bc0f55281cc9e6d37879e927f0e01c2807770ef8013d02177b7db6b0558ab' -- Cheese
  UNION ALL SELECT 'oNx_e8OBhM6gcZSje357S', 'belt', 'black', 'd2b53cd1b40007f00c3dc58a46e0f45beff62af160b904b897344e30de5f07d3' -- Plasma Belt
  UNION ALL SELECT 'oOdkdJixCLy2bW0Gxo5e0', 'sword', 'blue', 'ba27a0032f0f7a56013125035809740f7bb848ea8c5f0503c7e39ecd6637cf73' -- Chakra Sword
  UNION ALL SELECT 'oUbEs8jhjG98aEKJVmjFh', 'plate', 'red', '441d3bedb8e37b4a3d7b0648b637a8c9e4d86b0d2106a74cfaae0af794f42b5a' -- Crimson Dragon Breastplate Test Copy
  UNION ALL SELECT 'oWvIwRJQbzazcK7ozvwxj', 'NONE', 'gray', 'e910c73c23ceb53104ba62c4a7cddac7b0224b72143f8cfe10a52c812f1d4354' -- Recoil Crystal II
  UNION ALL SELECT 'ogNA9m48l6fLBaVIIoA6a', 'NONE', 'gray', '3a3c6e8a197c89e17b06cd35185339fdda2362e060dd0dd4eb22e803924b64e2' -- Lurethorne
  UNION ALL SELECT 'oiwIP34T7yRbo5D1E4tr5', 'headband', 'red', '2089e9900d1d5a5ecc3cc370718829bc65614a2a3a1a4547c950477a57326fa1' -- Crimson Dragon Helm
  UNION ALL SELECT 'ooUBOS6Xq7TlLKwB8fu2a', 'NONE', 'gray', 'e4ae253ef37dd0e70b55fb790527dd6cd5a84d8548bfec39c7aad212f5a06711' -- Bolster III
  UNION ALL SELECT 'osJq3k77YPGoFWgof12FQ', 'katana', 'black', 'e783e8fd32947cbf39cbc1d362fa1132a0386aee984c125f5230e6a93198a921' -- Night's Testament
  UNION ALL SELECT 'ouXMmLW4-A5QrlWHMp2OJ', 'NONE', 'gray', '388e4118011a72ae5d03a121c4a509f0cca5e1c91b48e2128031f2b704baa747' -- Apple
  UNION ALL SELECT 'ou_LqM0hkjavivUJK4Puw', 'NONE', 'gray', 'd5a0ebdc144e97654e2b092458398bb49172dd9ea5659cf32e595b93065b0ae3' -- Charnel Signet
  UNION ALL SELECT 'p2UOHMCoZUJKgxxXegWQ4', 'NONE', 'gray', '1e12b46e026cf63d2c8944fa83bc685609e02b75d00a6cef9f48b48bfefdcc3d' -- Mission Files
  UNION ALL SELECT 'p57P_qnP-hpfyQbR67hDM', 'NONE', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- New Item - p57P_qnP-hpfyQbR67hDM
  UNION ALL SELECT 'pH8rYM-VijrT243G3RhRt', 'sword', 'red', 'abe713c5e61bf9620d15e6623508debd6c09469674ddba9895e0f9e8a4fc2272' -- Lava Sword
  UNION ALL SELECT 'pJyymBXkpqaiVNbJl0pnb', 'NONE', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- New Item - pJyymBXkpqaiVNbJl0pnb
  UNION ALL SELECT 'pKh2hbtGUr7vQlKDP4-M2', 'skirt', 'green', '11e6e9391cbbb3dc8cb00ebd305e47d4ba2599a49c7e4baae2b8cd19f87d914c' -- Specialist Belt
  UNION ALL SELECT 'pSZejA7rg5tLWGCdkp2My', 'NONE', 'gray', '53b0b0238ba0e381636050ee9d96015ecb3a9b9a9a849e39f8a7c637cd6acc4c' -- Medium Fertilizer  Bag
  UNION ALL SELECT 'pUzitcOL819IO-2jUl0GO', 'bow', 'blue', '7fd01ab5c2a2c4584d67d6388f86ace17f4e5b7091552e90373c74c9089bdeed' -- Kamunari's Claw's Replica
  UNION ALL SELECT 'pY-0O5Gs2n89pf0kYb5J2', 'NONE', 'gray', '606d8db1586af0c41579f82329601df2271e3089e876296c4db5a17bf5ca22f2' -- Chart of the Drowned Foundry
  UNION ALL SELECT 'pYSQVTGBfbteGSFmvkPGg', 'NONE', 'gray', 'f322ac0d2c3a7c7e69b01bf3adbb93cb6006c2af0a53b65c320d0a9157d539f9' -- The Seventh Bead
  UNION ALL SELECT 'pbXY8h8QGvTnQYbg6tpKG', 'NONE', 'gray', 'd91932d3071e0fccbe8c71b29684a44bbcd81104c4c8dfa0e801fc2c882ee5c5' -- Obsidian Bone Splinters
  UNION ALL SELECT 'pbdc8AkYU6FFe9aYooJXu', 'boots', 'brown', 'd8582933a82a0c91468cbd0baf13b067871ffaefc12420c9b656cfcf78077daa' -- Kaeruun’s Thorned Striders
  UNION ALL SELECT 'poPFKo0qsfJlDDIjo-brF', 'gem', 'green', '03a300f94d04399d1a994bf7ac49c2d1383bcd3741eb4582c69d311fbf4e3741' -- Wildspirit Gem
  UNION ALL SELECT 'pvSUaWgUeGi7e81tYwxpW', 'plate', 'red', '139572886695682f7153ad4f0a6e9dead2cc9dd2051ebe810eacb6b957faa8ee' -- Subaku Demon Armor
  UNION ALL SELECT 'pxpgyNCQfHA_vL15Aw_zM', 'hammer', 'blue', '2a1abd7358571c0e96d7b8c33443cbe06c39bb288d366a20ca22a4ec429e4c5d' -- Meteor Hammer
  UNION ALL SELECT 'q6g5vKOr3MMYHly0TZKgJ', 'NONE', 'gray', 'dba75a9a68016db5a6541f54b36fa8a061e937cfbd0c7bb552138b756907837d' -- Afterburn Crystal
  UNION ALL SELECT 'qTzWEb6tFBv8dl15ztqDO', 'armarmour', 'black', '1fbb7ad6fd68a3c85f51f7d5721efcb4397ad21502069d506a34e277da5d7a45' -- Warden's Bracers
  UNION ALL SELECT 'qcIb0edEpXfLaOiERicCE', 'hood', 'black', '6abda29fbfd7db3cd356bdeceb897b5a84a8effe1cd2a74ef927b56a687bf69b' -- Two Tails Zukin
  UNION ALL SELECT 'qcX4rvjnGBfLdSnHn9-A4', 'NONE', 'gray', 'e2e672fb6ab3da92e2929bca0acde58a2f3a5045476660143ed4b460e1b4f5c0' -- Pumpkin Spice Latte
  UNION ALL SELECT 'qvBU8ambER5fkWfjHQ4c9', 'axe', 'silver', '18c733c0e0a2c32e4589f592138fbb14293d96963a1f4c513001b6911d098196' -- Earthen Axe
  UNION ALL SELECT 'qxbNP-lstD-xyyAvLhXv3', 'dagger', 'gray', 'b12820600fbadf2f5a3aac188104e312ab1bb6968eb21a9d76ce4bbb93c71570' -- Jak's Ripper
  UNION ALL SELECT 'qyQVPGUKdx8zw2AXzISA8', 'armarmour', 'gray', '7a1c53e5e672bb95ac07f493d9f3969128fb745c3ef82b27d719088d8b826383' -- Static Hands
  UNION ALL SELECT 'r6YacorfUbomooyhmkLlH', 'NONE', 'gray', 'da8e331fe43ad7c0c38b79f10062637b295e2c50af64a86710624192415aaa5a' -- Crystal of Sealing
  UNION ALL SELECT 'rE4dCWX6PMaCDYXhIr_4F', 'belt', 'black', 'd161ddc3aa1b0b5e226c0c395dd0a8518c0e81be6bc44cbb0896edd253c1de9b' -- Shadow Dragon Spine
  UNION ALL SELECT 'rFrYeO7r4fsIn8PrU2xd8', 'armarmour', 'black', '5982ec0caf97e729649a56398bdccce4c7ce29648c539cebe86ae1c4c16b65b2' -- Two Tails Tekkou
  UNION ALL SELECT 'rFtea8kQnNDWfR8xw1GDw', 'NONE', 'gray', 'da266bf6f694aa9b47630e06c26cf96d3b86b5d834b09c22772020d151c1fafb' -- Demon Scroll: Subaku Palace
  UNION ALL SELECT 'rGyfKFH3GVLk0NP_6CxL6', 'trident', 'blue', 'e5e7c9dd10e855fc35b59ad5c216b2cf152375845391b8a4121ff80a30561a24' -- The Threefold Gaze
  UNION ALL SELECT 'rH6ZfTl_dFCNGV9YSvGkd', 'club', 'brown', '86333b053b9f8bcd0eb749751fdb811c6a516b9867985c82d3fe5370e3b39ab9' -- Kuzenbo's Club
  UNION ALL SELECT 'rIUgbOss7B5xTKEkg22MH', 'dagger', 'green', '00cbcfe87b2cefa5a2f62e729cb98dfc4e70bbde24846b1f06ea1e5712141509' -- Tatsumaki's Bellow
  UNION ALL SELECT 'rX4hvyBFppTXgS2pVplha', 'NONE', 'gray', '6b32e84e2b24dbe1fa4924cf5100ce591c166b19c073abf1b672e993c8f4fe58' -- Killer Clown Riddle 1
  UNION ALL SELECT 'r_TVeNlBCnggXhNTtMliQ', 'helmet', 'gold', 'a6a7677589e02d72efe2875f91b322b52a4b05b31781b362aa6d8477e8d243c2' -- Kaeruun’s Tyrant Helm
  UNION ALL SELECT 'r_tnCjJD3SgV1jZ1P5w2M', 'NONE', 'gray', '9f253a978c2f85c6e7b8a0b1359fbfb96db5578b97dc2bc3dc86f17f866ca3b6' -- Glimmerchitin
  UNION ALL SELECT 'rdKHxrH1rSQyK9dU4bFmJ', 'boots', 'black', '9d6ca454e38f82435b9e2b3d220d2cf246f65af670e1fbc94c77e31d45f57986' -- Ninja Force 1's
  UNION ALL SELECT 'rp1Hoim1fQWkVgliZI0I5', 'katana', 'red', 'd5423820975397445406cac3cea509446d3f4e64c1d97cd04b3be994ef08e3fd' -- Veilbreak
  UNION ALL SELECT 'rsKvB5E93Zh3vLuEeZDcB', 'NONE', 'gray', 'd64593f8ac5a4776bc8295a93fcbc3d7b58e673ec50558528dcfbe050aa2803a' -- Jester's Coin
  UNION ALL SELECT 'rsc2uO5QuffXzejfhwF_F', 'NONE', 'gray', 'e75bb261369b7fe4ecdcf9749ba770929038594635b4695a6e73fc97adf8fbc0' -- Panacea
  UNION ALL SELECT 'sJXl6M3oneQBi0JErDwPQ', 'hood', 'black', '73948362ca3e8ac7a44b712e743362270b6197d43d8691366de0e4c7a0e6ad61' -- Kaeruun’s Horned Veil
  UNION ALL SELECT 'sJpzHsubsYmOh1zzsKAVo', 'NONE', 'gray', '43c32048a2ac3aea00702010890b2e9f5d94c6508c3cadec6727017a7d238c2b' -- Wooden Treasure Chest
  UNION ALL SELECT 'sLtFbk_CizLUqqcYUULax', 'NONE', 'gray', '6b3697299e6ae3e3106a9e9d9c7817b6e2cd9c047597a690072c1100eb9531aa' -- Dummy Armor 3
  UNION ALL SELECT 'sOaQbFLp4p094Wy0UVvvj', 'robe', 'blue', '9ebd0f62030bb67294f64f0540d7ed51c44744383f8872796b736bd82eeac67e' -- Ocean Plate
  UNION ALL SELECT 'sRRwTnVlW2tC8o2whrvIi', 'belt', 'gold', '8bb8372e46c8604c439c114aba016e4085bcf8840c788812062f6456c1353ec5' -- Kaeruun’s Sealing Cord
  UNION ALL SELECT 'sXaqXBYXGHvK75D7Bpo1h', 'dagger', 'red', '31aad2f9c449f8fe6043eef9fdc8e175cfd42e85a5c9a5696abce77d63396d20' -- Katon Kunai
  UNION ALL SELECT 'sagslOnL1UtUSaK6agsiL', 'NONE', 'gray', '57ce3212246018aa8d9e4e86a8c08bca95371f9c0d18e4cd15585d2a73f69a50' -- Icewarden Root
  UNION ALL SELECT 'sdSF_JkZehVIJgBeXaz4T', 'wide-hat', 'gray', 'e22f6cf205c0f8079eb6ccc081d35db56e969475229539956ecda04d4b750dd9' -- 1st Kage of Silence Hat
  UNION ALL SELECT 'sfv8S6kuwZkPpALYAH7qh', 'NONE', 'gray', '2811dcfca80580160fa44e190044d3d4eb615a45ec29f06931d1a4881053c238' -- Storm War Cache
  UNION ALL SELECT 'srURHA5tuXdu7sNnaRrLh', 'NONE', 'gray', '1309c08a8e1b6a886f4fe0563652ce0e174c590223859d4f686c62f81896ebcd' -- Flour
  UNION ALL SELECT 'swaQprLxfykRbJhxg95vA', 'NONE', 'gray', '3b9e41b7cd12e47c6b6207c329e89347387dea431fd04220de2acf8cc3bf7232' -- Bone Bead
  UNION ALL SELECT 'sy0h4bH73yVVbaegMgsAE', 'NONE', 'gray', 'cc1b4ddc409baf7f0eea50cde653d91c5758eb90c291a2eb1071e17bc108b5ed' -- Minor Repair Kit
  UNION ALL SELECT 't0iDFzKa9Mxg4rSuCH1gf', 'NONE', 'gray', '048a75e4b77574da7afbf6780b355daeb936ce705d9b5e1456d5915bbde5793a' -- Stone of Heraldry
  UNION ALL SELECT 't4KVOCRXnC89DLC8Ywnlq', 'necklace', 'blue', '37dafb6a5fad98c42d2c003225730395664ee5fa45a45402505341dcd5b00779' -- Crescent Pendant
  UNION ALL SELECT 't88B9dtM-Wly3NZ_6f6NZ', 'robe', 'black', '2852d3856324dc9b4c1d7109a3862e39f852121ca707606e87fe578d47e90e3b' -- Two Tails Shozoku
  UNION ALL SELECT 't9al-_924Th8w4g_yv6Sq', 'NONE', 'gray', 'b744521f14d319ebed8daaa444609fec4fb186888f9436e6919873e1fe5d9be2' -- Contaminated Dirt Sample
  UNION ALL SELECT 'tFH-9RLeCUcVByQbqd2ic', 'dagger', 'blue', '7144ce63340406dccd0b982e11856af9f4fe76d8dd3fa090a11e26f230085f0d' -- Wave Kunai
  UNION ALL SELECT 'tOSetjSOXPFOlfKH8ogkR', 'belt', 'purple', '4fb43a6b475a73a8f1aa73601e7ded6e6c31b3abeac2c40694d7ed8d1732f676' -- Kitsune Belt
  UNION ALL SELECT 'tPlPaOSCO2EXGvUHU-_9i', 'NONE', 'gray', '66004172e7677893d2f94c0d5cca9a559c013a222a35c0d69e52b59c996d87fa' -- Ember-sealed Scroll
  UNION ALL SELECT 'tZTvqYWiAc_OrY64nDvIo', 'NONE', 'gray', 'abaed2dd8111b37f824eb903236b9c92e549a18437e77bada34fc5f4e04cc114' -- Chakra Pill
  UNION ALL SELECT 'tiIJX1-_kneoWrLJMhL9_', 'NONE', 'gray', '8ac0674d3232db5ca8d8b7a4b54b94edc529c5df088c3a98af0d3b29167ae476' -- Godstorm Seal
  UNION ALL SELECT 'tikHLti1CoDpFmJlGHK9A', 'NONE', 'gray', '3b0e5d0ab95f93fa5db6a9b0d4306c5b2c560aa898767cb3cb03d87ceb8451d5' -- Heart of Kaeruun
  UNION ALL SELECT 'toBESPaPaHI5vEFRjWi20', 'NONE', 'gray', '3e0b18a277fc0560148a1e5bd2b0ec8ca95f1b5722f2f84776308cdeff414fb2' -- Rusted Gatherer's Chest
  UNION ALL SELECT 'tpSpEpr0UoYPqhXp5AaQW', 'NONE', 'gray', 'b7611b1f638c051bc4faa0564647e46349b5767558c1df6a8ddfc2688475c561' -- Stone of Fatum
  UNION ALL SELECT 'ttwbJ6ZA5Id-OuBludM27', 'whip', 'black', 'bce0e2670bf49a333537f07f0e01dbb4725602394a17ec53cd281dfae9a9a1db' -- Oathbinder
  UNION ALL SELECT 'tufeDKeVw8Wop8BcF3Zvy', 'gloves', 'orange', 'a276ab6da4f9b611ac36538549a0a09455f7e61a83de36f4f66558afac5e0732' -- Charged Hitter
  UNION ALL SELECT 'txnuMS-Ku3oKRlVb2FL1x', 'NONE', 'gray', '1e385200d9f95d849832611129f4641999fc89fea95ed78d44cd2168ec520855' -- Badger Shell
  UNION ALL SELECT 'u9mXSgVW_QjkRzCejGXZ1', 'dagger', 'gray', '22dd93137e27bbed5d9c485324caaf5a63f30d1a25a18c87c2701147062ebef3' -- Kunai
  UNION ALL SELECT 'uEZzzagRbXcR81Gb9mYrM', 'NONE', 'gray', 'ac9dccdfae78483f36e8761e07cb0ea9c0bceb463e2fee1a3c82e1b76deb1fa6' -- Rep Tech Replacement
  UNION ALL SELECT 'uF2y_9fEZZw12HAF-Ynzf', 'NONE', 'gray', 'eec5ad414b106499f4b2c1b1c151f463a1ac39853f390e1feded92184729ec3f' -- Plum
  UNION ALL SELECT 'uFLVcQxlsgmHMACac_M7B', 'beads', 'purple', 'da64574f2a42b4e991f853302bf5a2a74c36ce0e187e899aad2e56084ef8fcef' -- Executioner Beads
  UNION ALL SELECT 'uGRZolytFh4JqcLRVEMsH', 'bow', 'blue', 'e2e7a42c4dbea2092a8bb85535cbf34c4d5bdf9d7867bcf5e01ab2fba4310a17' -- Kamunari's Claw
  UNION ALL SELECT 'uLLAWOSCFeDz9Mc3d0rKw', 'NONE', 'gray', '4eba29ab240380a7c9b199ec0d9072f82fa0700c1d4b9cae957c4221527e7cb4' -- Scroll of Shadows
  UNION ALL SELECT 'ubMvchpc6Uf88eJxKNjWC', 'headband', 'blue', 'bef979290a3f3b79d29ef559cc3d4e45f64c9c61a8840b37758b5ea1c9bdf226' -- Azure Dragon Helm
  UNION ALL SELECT 'ufT6gjcDHcPShqEN0sVGv', 'NONE', 'gray', '3bbe141caafadd7540770f357b2fa143a8f7e93fab1509ddb2802341060e0972' -- Dusk's Momento
  UNION ALL SELECT 'ufyskuLoq_WyeuNkN3V8e', 'mask', 'blue', 'a6aebacd041c0bb49b17adefa5803a26bb9b2c8296fe9296bbae739d7daecd8b' -- Steam Mask
  UNION ALL SELECT 'ukla7zvSTjC_g6gVOk5UO', 'headband', 'black', 'd2e8df74d92143ab9ff100d9b7c89a6aca012b45d12da1bfa3d5782f5a4f0821' -- Specialist Helm
  UNION ALL SELECT 'uqbAHz4nejyGmO6aYz2vl', 'NONE', 'gray', '60b86df967974ed89565d77199ef1ab05fd10fa3a8af45a4b707b1b367799418' -- Pear
  UNION ALL SELECT 'usvnWH7ocDeIfQ-TZdyHi', 'NONE', 'gray', '0006a108c0ab57685520f90e6d689de3805cddf80baf7a10c9299385d7337e6c' -- Iron Signet
  UNION ALL SELECT 'uyJ3G109NK0_BnsTMeaOH', 'NONE', 'gray', '1e4ccd4ef43344ec859b53491d3f0b206672771c7c2e74cc7872f47497cc83cc' -- ID Card: Daigo
  UNION ALL SELECT 'uzl0B_mFBOj9ZakZ2fSWb', 'leather', 'brown', '8f30391133a98f90eb93122b52295c527cdedfff4c314218b65c06e8e3b8602a' -- Aegis Veil
  UNION ALL SELECT 'v2PXgWqRda_V0LBxgf2O2', 'NONE', 'gray', '0373e016be42b98a876cf44be987ba1e6f28791f9e8a16140a4d15df9bf4994e' -- Larry's Bait Bucket
  UNION ALL SELECT 'v7nw2VxOXHzzYtilCQ-B0', 'NONE', 'gray', 'ac9dccdfae78483f36e8761e07cb0ea9c0bceb463e2fee1a3c82e1b76deb1fa6' -- Reskin Slot
  UNION ALL SELECT 'vBkXFUBwg6_rEc0lSzOhR', 'NONE', 'gray', 'ae4b8f908a91f6f1980b7545c01dff26adb5221583f225d7f4042d1f056c89da' -- Cooldown Crystal
  UNION ALL SELECT 'vEUJnc2uY6GCL4K_K3YR7', 'necklace', 'green', 'd77f95f1faa3b2569bb42d528ef31fe342f341447a18cfd659f9cf21f2bb491b' -- Forest Moon Amulet
  UNION ALL SELECT 'vGNjTKK8w1DiKFKCtCrSM', 'gloves', 'black', '5783f5641455ad899d3662caa2a865d0bf2fae22a595ebfbc193111e935ab4ec' -- Grippy Gloves +
  UNION ALL SELECT 'vLDpr5763sdRfokpBFHMf', 'NONE', 'gray', '10d5441be157df5a01c6cb70b18d97d7eb48d9085e818e1939065b9955cefee4' -- Bloodflower
  UNION ALL SELECT 'vVvS3ePgMtqAc_S_fqug5', 'belt', 'green', '5f442e7f5ec844f61f9d7da4971666f4c17724e8326e011ad9f930b61a4de21c' -- Flak Belt
  UNION ALL SELECT 'vW7pgjvMnJMbg2aFzWwZo', 'tabi', 'black', 'e985337a0a91b2dc88c7f417fea4f87853c9c93cb7d4ff434de15c05c30e5d2c' -- Two Tails Jaki-Tabi
  UNION ALL SELECT 'vZWi1VTcqPVk0vVAin7sk', 'NONE', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- Fire Elemental
  UNION ALL SELECT 'vqf1vfmZrA-Seu4F_8mtV', 'NONE', 'gray', '5d52ea230b66cd28c22b782a026462c6d8dc67908f09f658f643be467bba9c2b' -- Pouch 2
  UNION ALL SELECT 'vr-WC9SdbjyF6Tdv_deqE', 'NONE', 'gray', 'b00cc09bc11315704ffccd4069c967fa45ac48d32f385058607dd132151d8311' -- Liquid Obsidian
  UNION ALL SELECT 'vr5N4kyyIc2G-gfhYelD2', 'gem', 'green', 'fd8d481bf1d419d62a6a978d83936a882bea48d0d915d6cc543b9617d5d0bcd1' -- Orb of Life
  UNION ALL SELECT 'vzSMGkIg0KKr9Hoeo4Z8f', 'NONE', 'gray', 'da1bd720f94b80548c3c34d695771a43ae6f1fd35e563e3fe9aafeb4661a95ff' -- Phoenix Egg
  UNION ALL SELECT 'wCFCjGhIUmPFvIAA_8-7J', 'NONE', 'gray', 'c42a17a5651b8ed9c16d157caa2c074c2a887c463ed09099dd678624318c146a' -- Seika Seal Petal
  UNION ALL SELECT 'wDpSBlS2idtEX2LTY0TTD', 'NONE', 'gray', 'af7d85ca46d682f4c4efd095374c8fb265a057d654dc65c79a1c9a6e9a3b6253' -- Celestial Teapot
  UNION ALL SELECT 'wE1QeldWTjls2Cf43cFjf', 'bow', 'black', 'c3797b664b5b1b599e18dea3db5cad0040e110975231567cafef074359c51ff6' -- Ink of the Void
  UNION ALL SELECT 'wNnZ3uXHbYRzwRAqO-6EM', 'NONE', 'gray', 'ba54cf312285c86cf71a71d42373619812cb20a1a809845eaec45ff536a93f32' -- Tempest Thorn
  UNION ALL SELECT 'wR2M9GgcFckOXCqLBcfzl', 'dagger', 'black', '31aad2f9c449f8fe6043eef9fdc8e175cfd42e85a5c9a5696abce77d63396d20' -- Enkou Kunai 
  UNION ALL SELECT 'wT_M4TtNewRwgbqy0U2Jo', 'beads', 'red', '733fcad12d1b92bcd92543648ffae1c76ec9918a7f06fcc67303b4197d2a723c' -- Crimson Prayer Beads
  UNION ALL SELECT 'wTo5qYaYtITbw83PVN7CV', 'gem', 'purple', '25f8bae5c2e8a765ed8b384bd3865dcda2ab255970014e1c93f68a0653882ed9' -- Jester’s Jewel
  UNION ALL SELECT 'w_HbkhnlNBZblLYajzjp_', 'NONE', 'gray', 'a08cd8e93bfe149e6f596b3db63d94abce08ea1809951db8deac65a62020e695' -- Five of Swords
  UNION ALL SELECT 'we2DtPSH2Q5quEvxj7xO2', 'NONE', 'gray', 'dca63cb36669ffa94cee4de832a8cadcb76a5a61ac4fd261e0d688ee18deb573' -- Ikazuchi Tool Pouch
  UNION ALL SELECT 'wyVSnfAXtlwi-i1T58423', 'NONE', 'gray', '4f638ee603bb075cb6f01381b80545e1ae171d23becc2612dc6dcd00fabab6fc' -- Cat
  UNION ALL SELECT 'wyZkGssY5F-c0a_UGDKin', 'NONE', 'gray', 'b5853e89a8ce985ef3830f8e8654c685215483f2c4ea55d14214a76a768f49ee' -- Sapphire Wave Pendant
  UNION ALL SELECT 'x3UaR97cn-M4C3EzONYvd', 'NONE', 'gray', '4c838c6c5d5d7b0f1a7f9b7bdeaea91376253663d9448526246a1a6b9fec0930' -- Ice Elemental
  UNION ALL SELECT 'x7iCNqnUa3Yo6djdCpGKL', 'mask', 'red', 'e08c5ad9e993e1a3a38eac6e3c3e0f3813f95e353c2c53f01effa6404bf97fd2' -- Genin PVE Support
  UNION ALL SELECT 'xUOR92T2Fd24AuP3N_bol', 'NONE', 'gray', '4d274e8eec14ca913f557caa9ca60054e222ec54ae42e3d8dd6e64f09e518adc' -- Static Chest
  UNION ALL SELECT 'xbjEy4xGdilT_uHLMS4E1', 'NONE', 'gray', '701b2bc84f91529d9b847c50c7b6641df1d67f6148c91c1188d3c17d452a8bab' -- Poison Crystal
  UNION ALL SELECT 'xh4lPn580jmAIJAZoq2QU', 'belt', 'black', '56191d5553e2e295d75534117cc8559ee7c4b83289486018f22cafd172e8aed0' -- Black Belt
  UNION ALL SELECT 'xjkZC0-ETs6Cn454tFSix', 'NONE', 'gray', '6bdc2915dde59839b03365d954506a81b9d86c7998475f78f9fe76de656d7411' -- Zombie Fingers
  UNION ALL SELECT 'y0XR9Kn9ITvXGGwZBbNc0', 'plate', 'silver', '3b6429e7a48ff96cd8e1cbb1cacf4b7c6ae781ad11ae04913e7d9636d7e539a7' -- Simple Armor
  UNION ALL SELECT 'y6yviCWrQ6ZreNb_BkBy0', 'necklace', 'blue', '93e30acb981da8f4344141cab79443ebcdcbb86d5ff864f1c0585e6fbd147172' -- Snow Crest
  UNION ALL SELECT 'yAFGiqQAAuW5TExYV2Hcc', 'NONE', 'gray', '1e4ccd4ef43344ec859b53491d3f0b206672771c7c2e74cc7872f47497cc83cc' -- ID Card: Kaizen
  UNION ALL SELECT 'yE9dEjHPsdqEObrs_nyKw', 'NONE', 'gray', '08a8775acfba032bceaddc99d2fa1916e0530276a0339e642e875726ea950047' -- Ice Scroll
  UNION ALL SELECT 'yGCFQ5-w8DbLANl5gYMeB', 'NONE', 'gray', 'f8d1222143f236288ce6fc2e3ba694e6cf37f8e992facc764e7da5bde43817c3' -- Whetstone Oil
  UNION ALL SELECT 'yTS9TSpr_QLnh_3zmEpGg', 'crown', 'blue', '91c37bc0bd1b9abbff4fcde7bb74d1ea4e7ce61fab5ded4471236852cdd052d2' -- The Skyglass Crown
  UNION ALL SELECT 'yTzp5MQ6qb7IUdCf26I53', 'NONE', 'gray', 'be41c76e7822ad24173d621e721ff9165daa511ab18ca7e8550c9dfa8cfd9e1d' -- Seed of False Vitality
  UNION ALL SELECT 'yVNeLzxHSFkNpTPnlm7yQ', 'dagger', 'red', '0d2f2961aca2f2aa43ce3641074ef32bd268d510a0d7c45cb5b97a949d4bfa74' -- Bloodthorn Kunai
  UNION ALL SELECT 'yWVnPn1NVG9fq_a2UrRXp', 'NONE', 'gray', '2330feb2fe4bb3f2b06d9ef830bd665996d5c7319c219836d79ed4c131d8ddab' -- Parchment Core
  UNION ALL SELECT 'yZvDkhhFg-nTr6EqMgT1B', 'headband', 'blue', 'c50608bed39ec882c3fc2239ca2792818cbc985e5d1f779c49dc8172a9a41e4d' -- Bise Helmet
  UNION ALL SELECT 'yk3ElwNUUs7vQbwwT6_Ax', 'NONE', 'gray', '55c9de7934629375c4db796119e5c2f01139ebf99818cde2629a5eceeb7d79f3' -- Bolster Crystal II
  UNION ALL SELECT 'yolq4PdI_rS4YJf2NZiAQ', 'NONE', 'gray', 'eb80dfa93ac6b62dec8955f4e0300959a0ba921f919cbadbd5f9273a1d14ca75' -- Stun Crystal
  UNION ALL SELECT 'yuzzuJJDOQq6cRinliDOe', 'beads', 'white', 'da29bdcfec4f9b761b2a0f1641b6514cca431fb6de1b3b6f750662ae5a5765f7' -- Snow Amulet
  UNION ALL SELECT 'z0IbJr87p1KCQphKQ5ABY', 'katana', 'gray', '2e93ed7c7fb14daefe4cd9d74d2df10726f028d974595ba50ce3285c3a9bd259' -- The First Edge
  UNION ALL SELECT 'z9U9wvJKDGtimll6BnTuL', 'NONE', 'gray', 'dda492d8568a98dad71eb152b847efec6432e3097dd5494627c4657ef0ae8232' -- Zephyrfang Tool Pouch
  UNION ALL SELECT 'zGeruNBE_SLeOt42LGg5a', 'NONE', 'gray', 'fc96f98051313f8e4a4d289ab9b3067c88fc4364d4d7abaed95332a9faefe002' -- Adamantine Ore
  UNION ALL SELECT 'zK-_b0cb3zk7OLu8oolkn', 'armarmour', 'black', 'a7e58b0981b77380d742e39abaa05fed530ffdebb5e1cdf3c6344466e5699d42' -- Plasma Guards
  UNION ALL SELECT 'zNXTCXU_3QY_q_wDKKPDo', 'necklace', 'purple', 'ec6755753ec477dfc48ca30f701724139e08f28008d4e345ce9719eb1099828d' -- aggressive beehive
  UNION ALL SELECT 'zO9fheu82ANH6gUool-a_', 'bracelet', 'silver', 'd7ad0e37ae3d70e4ed499f100882301a5ef8cdc1410d62d82f56f5dab74915fe' -- Sealed Bracelet of Envy
  UNION ALL SELECT 'zP7RPHevMSdsJ2N17b8Qd', 'necklace', 'purple', '15b3ae1b7b9ccc244198d7f08ad06ce1ab7583852051d3c087d94ad53983d64e' -- Sealed Necklace of Lust - copy
  UNION ALL SELECT 'zQDvMQgfCH1I4I3PCrXwF', 'NONE', 'gray', 'a0c3580f0315ef94332cf6d8f30ac724af900d35e7ddb7c66f21b451867154cf' -- New Item - zQDvMQgfCH1I4I3PCrXwF
  UNION ALL SELECT 'zRKW8vnJ2FjAK8HpGgQ3H', 'robe', 'red', 'a953019520bf39f7e79fcbd8ab37434e2d473b96ea479035c787854ae00d3952' -- Brawler Plate
  UNION ALL SELECT 'zdFOmjaVf8KxL4DqSTwCk', 'NONE', 'gray', '05c2b53322916c27f7e23ad4e9e9231102135853307ed874f99de2df95c10e38' -- Defense Crystal
  UNION ALL SELECT 'zjkr8jwJdYUaxLjgGvLQ2', 'armarmour', 'brown', 'f0fbb24bc61183a4b9ba3a5cb329c536ae3a7ef1f7f63b8c73736520bb3cf346' -- Specialist Gloves
  UNION ALL SELECT 'zuJu2w6rdCheDLicPoXHG', 'NONE', 'gray', 'b3abda2d0182a64ebc2f91a09b69abc20e0759f38c1d9523eead0a4fe5bd06c2' -- Onion Seed
  UNION ALL SELECT 'zwGS12Kji7ghkBaKnfdRM', 'leather', 'brown', '3fc6d024aef88051facff5a91853cbf983d2421527620fabd3d9f3ee6fda5aee' -- Genin PVE Tank
) AS appearance ON appearance.id = content.id
  AND appearance.imageHash = SHA2(content.image, 256)
SET content.lpcProfile = CASE WHEN content.lpcProfile IS NULL OR content.lpcProfile = 'AUTO' THEN appearance.profile ELSE content.lpcProfile END,
    content.lpcColor = COALESCE(content.lpcColor, appearance.color)
WHERE content.lpcProfile IS NULL OR content.lpcProfile = 'AUTO' OR content.lpcColor IS NULL;

UPDATE `ItemVariant` AS content
INNER JOIN (
  SELECT '-bzHY7hE67r0qwHy8WVq_' AS `id`, 'footarmour' AS `profile`, 'gold' AS `color`, 'a486dad246f4cdc0de8f8aa52ad074151b89317ed70ebe6ff9c2fd2866ffeb16' AS `imageHash` -- Dragonmancer Shoes
  UNION ALL SELECT '0rijBuxW48HYB_lfI8Adx', 'plate', 'black', '8a4505155ac1c9b931351ce2a147477292a6df0119a219b9ebdde952dbe0349f' -- Subaku Demon Armor
  UNION ALL SELECT '1LCyafbemIJTkVCPun5wE', 'footarmour', 'gold', '07d2cd103c62c5dc46d8a3b9b0fc67786556ff37bfaf6695524d638a05aaa4b5' -- Dragonmancer Shoes
  UNION ALL SELECT '5JcpE5Yu7lMBuIDCYjxo6', 'katana', 'black', 'aa3f3405e9583610d961ffbea0173326a23fa551684e99a44d873441fd2ef6ee' -- Weeping Testament
  UNION ALL SELECT 'IcxPuPeG5Ex60io1fc6xu', 'pants', 'white', 'b410ec6720d823e8cf8f9d5a17f7abe800d4661a7c38fe8c8e9128f33dfe3b81' -- Female Pants
  UNION ALL SELECT 'WMKmHKFsPPL9s1LpsTakB', 'katana', 'red', 'c78dcb4d94db5f5aaefd0e0c07ea2844088bee5c5efb0a28b819e0a3f7dd4b65' -- Hemathorn
  UNION ALL SELECT 'Zlq6lUtZoVxdKvv2YxM6p', 'plate', 'green', '4abbb88fb82625096c279f2d90c7340f255039949fad89aa6ed6337b92821838' -- Dragonmancer Breastplate
  UNION ALL SELECT 'cmNLWqt1js3RjQRvhP93i', 'plate', 'green', '4a699de30d9fd5a98146ef0b1c5f7d64d776d16dbfcbfa60acc04e40cf6e8a16' -- Dragonmancer Breastplate
  UNION ALL SELECT 'v2cA1WAHUCgk25ypk9H1F', 'sash', 'red', '0ba054ab28353f5fcaf43571ef5cfa893d5871b4b23e7b87b8b094e21ec9d67b' -- Sash of the Crimson Courtesan
  UNION ALL SELECT 'wgJh_5vBDzcJH7C_-Lz-6', 'sword', 'blue', '03bd8f783c7abb0832d6c4031f35af16302c408c2179b4c86f1b4f8ddfea23c8' -- Captain's Decree
) AS appearance ON appearance.id = content.id
  AND appearance.imageHash = SHA2(content.image, 256)
SET content.lpcProfile = CASE WHEN content.lpcProfile IS NULL OR content.lpcProfile = 'AUTO' THEN appearance.profile ELSE content.lpcProfile END,
    content.lpcColor = COALESCE(content.lpcColor, appearance.color)
WHERE content.lpcProfile IS NULL OR content.lpcProfile = 'AUTO' OR content.lpcColor IS NULL;
