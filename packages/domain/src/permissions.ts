import { DomainError } from "./errors.js";

export type Role = "owner" | "admin" | "billing_manager" | "support" | "viewer";

export type Permission =
  | "org:read"
  | "org:manage"
  | "users:manage"
  | "catalog:manage"
  | "billing:read"
  | "billing:manage"
  | "payments:manage"
  | "audit:read"
  | "support:impersonate";

const rolePermissions: Record<Role, Permission[]> = {
  owner: [
    "org:read",
    "org:manage",
    "users:manage",
    "catalog:manage",
    "billing:read",
    "billing:manage",
    "payments:manage",
    "audit:read",
    "support:impersonate"
  ],
  admin: [
    "org:read",
    "users:manage",
    "catalog:manage",
    "billing:read",
    "billing:manage",
    "payments:manage",
    "audit:read"
  ],
  billing_manager: ["org:read", "catalog:manage", "billing:read", "billing:manage", "payments:manage"],
  support: ["org:read", "billing:read", "audit:read"],
  viewer: ["org:read", "billing:read"]
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return rolePermissions[role].includes(permission);
}

export function requirePermission(role: Role, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new DomainError("forbidden", "permission.denied", `Role ${role} is missing permission ${permission}.`);
  }
}

export function permissionsForRole(role: Role): Permission[] {
  return [...rolePermissions[role]];
}
