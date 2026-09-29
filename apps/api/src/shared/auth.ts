import { prisma } from "@billing/db";
import { hasPermission, permissionsForRole, type Permission } from "@billing/domain";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { HttpError } from "./errors.js";
import "./types.js";

export async function attachTenantContext(request: Request, _response: Response, next: NextFunction) {
  try {
    if (request.path.startsWith("/health")) {
      next();
      return;
    }

    const organizationSlug = String(request.header("x-org-slug") ?? "acme");
    const userEmail = String(request.header("x-user-email") ?? config.defaultUserEmail);

    const membership = await prisma.membership.findFirst({
      where: {
        organization: { slug: organizationSlug },
        user: { email: userEmail }
      },
      include: {
        organization: true,
        user: true
      }
    });

    if (!membership) {
      throw new HttpError(403, "membership.denied", "No membership was found for the selected organization and user.");
    }

    request.tenant = {
      organizationId: membership.organizationId,
      organizationSlug: membership.organization.slug,
      userId: membership.userId,
      userEmail: membership.user.email,
      role: membership.role,
      permissions: permissionsForRole(membership.role)
    };

    next();
  } catch (error) {
    next(error);
  }
}

export function requireTenant(request: Request) {
  if (!request.tenant) {
    throw new Error("Tenant context has not been attached.");
  }

  return request.tenant;
}

export function assertPermission(request: Request, permission: Permission) {
  const tenant = requireTenant(request);
  if (!hasPermission(tenant.role, permission)) {
    throw new HttpError(403, "permission.denied", `Missing permission ${permission}.`);
  }

  return tenant;
}
