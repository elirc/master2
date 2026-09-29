import { prisma } from "@billing/db";
import { Router } from "express";
import { asyncHandler } from "../shared/async-handler.js";
import { requireTenant } from "../shared/auth.js";

export const identityRouter = Router();

identityRouter.get(
  "/me",
  asyncHandler(async (request, response) => {
    const tenant = requireTenant(request);
    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: tenant.organizationId },
      include: {
        users: {
          include: { user: true },
          orderBy: { createdAt: "asc" }
        },
        teams: {
          include: { members: true }
        }
      }
    });

    response.json({
      user: {
        id: tenant.userId,
        email: tenant.userEmail,
        role: tenant.role,
        permissions: tenant.permissions
      },
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        status: organization.status
      },
      members: organization.users.map((membership) => ({
        id: membership.id,
        userId: membership.userId,
        name: membership.user.name,
        email: membership.user.email,
        role: membership.role
      })),
      teams: organization.teams.map((team) => ({
        id: team.id,
        name: team.name,
        memberCount: team.members.length
      }))
    });
  })
);
