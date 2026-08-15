-- Backfill UserRequest.relatedId for ANBU join requests created before squad id
-- was persisted on relatedId. Without this, getRequests filters by relatedId =
-- squadId and silently drops legacy rows (relatedId IS NULL), hiding pending
-- requests from leaders and applicants after deploy.
--
-- Only match via the current squad leader. Do not join through the receiver's
-- current anbuId — a demoted/kicked leader who later joined a different squad
-- would incorrectly re-link the original squad's requests. Remaining unmatched
-- rows (relatedId still null) are covered by getRequests' legacy receiverId ===
-- leaderId fallback while that leader still leads the squad.

UPDATE `UserRequest` AS ur
INNER JOIN `AnbuSquad` AS a ON a.leaderId = ur.receiverId
SET ur.relatedId = a.id
WHERE ur.type = 'ANBU'
  AND ur.status = 'PENDING'
  AND ur.createdAt > NOW() - INTERVAL 1 DAY
  AND ur.relatedId IS NULL;

-- Keep the oldest pending request per sender before the following schema
-- migration adds the unique pending-ANBU constraint. This only affects rows
-- that could otherwise race multiple squad leaders during rollout.
UPDATE `UserRequest` AS ur
INNER JOIN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY senderId
        ORDER BY createdAt ASC, id ASC
      ) AS request_rank
    FROM `UserRequest`
    WHERE type = 'ANBU'
      AND status = 'PENDING'
  ) AS ranked_requests
  WHERE request_rank > 1
) AS duplicate_requests ON duplicate_requests.id = ur.id
SET ur.status = 'CANCELLED';
