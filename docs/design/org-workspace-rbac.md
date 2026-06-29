# Org / Workspace / Site Authorization Model

## Context

The platform has three nested scopes:

1. **Organization** — the PushPress admin container. To start there is exactly one org (`PushPress`). In the future there may be partner/reseller orgs.
2. **Workspace** — a client business. A gym/studio gets one workspace. It contains sites, docs, assets, themes, playbooks, deployments, etc.
3. **Site** — a single website inside a workspace.

Users are **not** personal workspace owners like in Ploy. A workspace always belongs to a client business. A client user is invited to a workspace. A PushPress staff user is an org user and may also be a member of workspaces.

## User identities

| Kind | Source | What they represent |
|------|--------|---------------------|
| `org_user` | Clerk auth + internal `organization_memberships` | PushPress employee or partner with org-level access |
| `workspace_user` | Clerk auth + internal `workspace_memberships` | Client stakeholder invited to one workspace |

A single Clerk user can be **both** an org user and a workspace user, but those are separate memberships with separate roles. Workspace membership is per-workspace.

## Roles (proposal)

### Org roles

Org roles only control what the user can do at the org level and across workspaces. They do **not** automatically grant access inside a workspace.

| Role | Scope |
|------|-------|
| `org_owner` | Full org settings, billing, user management, can create/delete workspaces, can impersonate or manage any workspace |
| `org_admin` | Create workspaces, manage org users, view/edit any workspace settings |
| `org_member` | Read-only access to org dashboards; may be granted workspace-level access separately |

### Workspace roles

Workspace roles only control what the user can do inside that workspace. They do **not** grant org settings access.

| Role | Scope |
|------|-------|
| `workspace_owner` | Full control of the workspace: sites, docs, assets, themes, billing, invites |
| `workspace_admin` | Edit sites/content, manage workspace users, cannot delete workspace or change billing |
| `workspace_editor` | Edit content/docs/assets/sites, cannot manage users or billing |
| `workspace_viewer` | View-only; useful for read-only clients or reviewers |

## Rules of visibility

- A **client workspace user** can never see or edit org-level settings, other workspaces, or org user lists.
- An **org user** can see org settings and, if their org role allows, can open any workspace and act as an admin there.
- A workspace user can only see/work in workspaces they are explicitly members of.
- Sites, assets, docs, deployments are always scoped to a workspace. There is no cross-workspace data access.

## Invitation flows

| Action | Who can do it |
|--------|---------------|
| Invite/remove org users | `org_owner`, `org_admin` |
| Create a workspace | `org_owner`, `org_admin` |
| Invite/remove workspace users | `workspace_owner`, `workspace_admin` (and org admins when acting on that workspace) |
| Invite someone to a workspace who is not yet in Clerk | The inviter sends an email; on first login the user gets the role they were invited with |

Open question: should an org admin be able to add themselves to any workspace, or must they be invited by the workspace owner?

## Clerk mapping

- Use Clerk organizations for the **org** layer. Org users are Clerk org members.
- Do **not** use Clerk organizations for workspaces. Workspaces are internal rows in Postgres with `workspace_memberships` linking Clerk user IDs to workspaces and roles.
- A Fastify auth hook reads the Clerk JWT, resolves the user ID, then resolves:
  - org membership + role (if any)
  - workspace membership + role for the current workspace (from route context)
- The request context carries both. Route handlers or a permission helper check the required role.

## Permission checks

Two permission dimensions:

1. **Org permission** — required org role for the action, e.g. `org_admin` to create a workspace.
2. **Workspace permission** — required workspace role for the action, e.g. `workspace_editor` to update a page.

Some endpoints need only one dimension; some need either. Examples:

| Endpoint | Required access |
|----------|-----------------|
| `POST /workspaces` | `org_admin` or `org_owner` |
| `GET /workspaces/:uuid` | workspace member, or org admin |
| `POST /workspaces/:uuid/sites` | `workspace_admin`/`owner`, or org admin acting on workspace |
| `PUT /workspaces/:uuid/sites/:slug/pages/:slug` | `workspace_editor`+ |
| `GET /workspaces/:uuid/assets` | workspace member, or org admin |
| `GET /organizations/:uuid` | org member |
| `PUT /organizations/:uuid` | `org_admin` or `org_owner` |

## Open questions

1. **Granular permissions vs. role-based?**
   - Do we need per-action grants ("can publish but not delete", "can edit docs but not sites") or are the four workspace roles enough?
   - Recommendation: start with roles. Add fine-grained flags later only if a real customer asks.

2. **Org users in workspaces**
   - Should an org admin automatically be treated as `workspace_admin` in every workspace, or must they be explicitly added?
   - Should there be an "org support" mode that logs all actions they take inside a client workspace for audit?

3. **Workspace ownership transfer**
   - Can a workspace owner leave? Who becomes owner?
   - Can an org admin reassign workspace ownership without the owner's consent?

4. **Billing and plan settings**
   - Are workspace billing settings visible to `workspace_owner` only, or also to `org_admin`?
   - If the org is the billable entity, does the client workspace owner see usage or invoices?

5. **Public sites vs. workspace access**
   - A published site is public, but editing it still requires workspace permission. No special rule needed.

6. **Clerk org vs. internal org table**
   - Should we mirror Clerk org membership in our DB or query Clerk each request?
   - Recommendation: mirror on webhooks (`organizationMembership.created`, `.deleted`, `.updated`) for performance and reliable role lookups.

7. **JWT claims**
   - Do we put workspace roles in the Clerk JWT (custom claims) or resolve them from our DB per request?
   - Recommendation: keep org role in Clerk claims; resolve workspace role from DB because a user has different roles per workspace.

8. **Feature flags / experiments**
   - Should org-level feature flags (e.g. "AI generation enabled") override workspace-level flags?
   - Recommendation: org-level defaults, workspace-level opt-in/opt-out where it makes sense.

## Implementation notes (for when we code this)

- Add `organization_memberships` table: `user_id`, `organization_uuid`, `role`, `created_at`.
- `workspace_memberships` already exists; ensure it has `role`.
- Create a permission helper: `requireOrgRole(request, 'org_admin')` and `requireWorkspaceRole(request, 'workspace_editor')`.
- Update Fastify hooks to load both memberships into `request.auth`.
- Add tests for each boundary: client cannot touch org, org user cannot touch workspace without membership/role, etc.
