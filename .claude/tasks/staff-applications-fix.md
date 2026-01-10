# Staff Applications Fix - Implementation Plan

## Bug Summary

The staff application system has the following issues:

1. **Role promotion logic is backwards**: Users can be promoted to staff regardless of application approval status, while staff need an application to be moved to user role.
2. **Applications visibility is too broad**: All staff can see all applications, but it should be restricted to approvers (admins) and the CODER role.

## Current Behavior Analysis

### Issue 1: Role Change Logic (profile.ts)

Located in `/app/src/server/api/routers/profile.ts` lines 938-942:

```typescript
if (roleChanged && target.role !== "USER" && user.role !== "CODING-ADMIN") {
  return errorResponse(
    "Promotion of users to staff need to go through staff application process. See manual.",
  );
}
```

**Problem**: The condition `target.role !== "USER"` checks if the target is ALREADY staff. This blocks:
- Staff → anything (except by CODING-ADMIN) ❌ Wrong
- User → anything (allowed) ❌ Wrong

**Should be**: 
- User → Staff: Blocked (must use application process)
- Staff → User: Allowed (demotion should be easy)

### Issue 2: Applications List Visibility (applications.ts)

Located in `/app/src/server/api/routers/applications.ts` lines 93-98:

```typescript
const isStaff = user.role !== "USER";
const baseConds = [
  ...(input.onlyMine || !isStaff
    ? [eq(staffApplication.applicantUserId, user.userId)]
    : []),
```

**Problem**: Any staff member can see all applications.

**Should be**: Only approvers (admins) and CODER can see all applications. Other staff should only see their own.

## Implementation Plan

### Task 1: Add Permission Function for Applications Visibility

**File**: `/app/src/utils/permissions.ts`

Add new permission function:

```typescript
export const canViewAllStaffApplications = (role: UserRole) => {
  return [
    "CODING-ADMIN",
    "CONTENT-ADMIN",
    "EVENT-ADMIN",
    "MODERATOR-ADMIN",
    "CODER",
  ].includes(role);
};
```

**Reasoning**: 
- The 4 ADMIN roles are in `StaffApprovalGroups` and can approve/reject applications
- CODER is a special exception per the PR requirements (user Neon wants coders to still see applications since they've been part of discussions)

### Task 2: Fix Role Promotion Logic

**File**: `/app/src/server/api/routers/profile.ts`

Change the guard from:
```typescript
if (roleChanged && target.role !== "USER" && user.role !== "CODING-ADMIN") {
```

To:
```typescript
if (roleChanged && target.role === "USER" && input.data.role !== "USER") {
```

**Reasoning**:
- `target.role === "USER"` → We're changing a USER
- `input.data.role !== "USER"` → We're promoting them to staff (not just changing user settings)
- This blocks USER → STAFF but allows STAFF → USER
- The application approval process in `applications.ts` line 239-248 handles legitimate promotions by updating the role directly after all approvals

### Task 3: Update Applications List Query

**File**: `/app/src/server/api/routers/applications.ts`

Import the new permission function and modify the list endpoint:

```typescript
import { canDeleteStaffApplication, canViewAllStaffApplications } from "@/utils/permissions";

// In the list procedure:
const canViewAll = canViewAllStaffApplications(user.role);

const baseConds = [
  ...(input.onlyMine || !canViewAll
    ? [eq(staffApplication.applicantUserId, user.userId)]
    : []),
  // ... rest of conditions
];
```

**Reasoning**:
- Only users with `canViewAllStaffApplications` permission see all applications
- Other staff (JR_MODERATOR, MODERATOR, HEAD_MODERATOR, CONTENT, EVENT) only see their own
- USERs also only see their own (caught by `!canViewAll` since USER returns false)

### Task 4: Update Frontend Applications List Page

**File**: `/app/src/app/manual/staff/applications/page.tsx`

Update the access control to use the new permission:

```typescript
import { canDeleteStaffApplication, canViewAllStaffApplications } from "@/utils/permissions";

// Change from:
const isStaff = me?.role && me.role !== "USER";

// To:
const canViewAll = me?.role && canViewAllStaffApplications(me.role);

// Update the enabled condition and the access guard accordingly
```

### Task 5: Update Frontend Staff Page (Applications Button Visibility)

**File**: `/app/src/app/manual/staff/page.tsx`

Update the "Applications" button visibility to only show for users who can view all applications:

```typescript
import { canViewAllStaffApplications } from "@/utils/permissions";

// Change from:
{isStaff && (
  <Link href={`/manual/staff/applications`}>

// To:
{me?.role && canViewAllStaffApplications(me.role) && (
  <Link href={`/manual/staff/applications`}>
```

## Summary of Changes

| File | Change |
|------|--------|
| `permissions.ts` | Add `canViewAllStaffApplications` function |
| `profile.ts` | Fix role change guard logic (line ~938) |
| `applications.ts` | Use new permission for list visibility |
| `applications/page.tsx` | Use new permission for page access |
| `staff/page.tsx` | Use new permission for button visibility |

## Testing Checklist

- [ ] USER cannot be promoted to staff via profile edit (error message shown)
- [ ] Staff can be demoted to USER via profile edit
- [ ] Application approval process still promotes users correctly
- [ ] CODING-ADMIN can see all applications
- [ ] CONTENT-ADMIN can see all applications
- [ ] EVENT-ADMIN can see all applications
- [ ] MODERATOR-ADMIN can see all applications
- [ ] CODER can see all applications
- [ ] JR_MODERATOR only sees own application
- [ ] MODERATOR only sees own application
- [ ] HEAD_MODERATOR only sees own application
- [ ] CONTENT only sees own application
- [ ] EVENT only sees own application
- [ ] USER only sees own application
- [ ] Applications list button only visible to users with view permission
