# Syncing Content

This document describes how to download game content from the live environment and restore it into your local environment.

## Download [Requires TNR prod access]

`make seed` reads fixed `.sql` dumps from `app/data/`. Use TablePlus to export each table as an `INSERT` dump and replace the matching file. Only run `SELECT` statements against production.

| File | Tables | Rows |
| --- | --- | --- |
| `app/data/jutsu.sql` | `Jutsu` | all |
| `app/data/bloodline.sql` | `Bloodline` | all |
| `app/data/item.sql` | `Item` | all |
| `app/data/assets.sql` | `GameAsset` | all |
| `app/data/quests.sql` | `Quest` | all |
| `app/data/villages.sql` | `Village`, `VillageStructure`, `Conversation` | all villages and structures; public conversations |
| `app/data/ai.sql` | `AiProfile`, `UserData` | the `Default` AI profile and the AIs |
| `app/data/userjutsu.sql` | `UserJutsu` | the AIs' jutsu |

Filters for the filtered tables:

```sql
SELECT * FROM Conversation WHERE isPublic = 1
```

```sql
SELECT * FROM AiProfile WHERE id = 'Default'
```

```sql
SELECT * FROM UserData WHERE UserData.isAi = 1
```

```sql
SELECT UserJutsu.* FROM UserJutsu INNER JOIN UserData ON UserData.userId = UserJutsu.userId WHERE UserData.isAi = 1
```

## Insert data into local database

Run the seed command. The seed scripts clear the local rows each dump replaces before inserting it, except for `villages.sql`, which clears them itself: keep its three leading `DELETE` statements (`Village`, public `Conversation` rows, `VillageStructure`) when replacing the file.

```bash
make seed
```
