# Syncing Content

This document describes how to download all game content from live environment, and how to restore it into your local environment.

## Download [Requires TNR prod access]

Use the tool TablePlus to export `.sql` dumps of tables `UserData`, `Bloodline`, `Item`, `Jutsu`, and `UserJutsu`. For `UserData` and `UserJutsu` we limit it to the AIs with following SQL statements:

```sql
SELECT * FROM UserData WHERE UserData.isAi = 1
```

```sql
DELETE FROM UserJutsu WHERE userId IN (
    SELECT UserData.userId FROM UserData WHERE UserData.isAi = 1
)

SELECT UserJutsu.* FROM UserJutsu INNER JOIN UserData ON UserData.userId = UserJutsu.userId WHERE UserData.isAi = 1
```

## Insert data into local database

Run the seed command

```bash
make seed
```
