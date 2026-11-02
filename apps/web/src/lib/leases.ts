import type { LeaseWithBundle } from "@/lib/api"

const PREFIX = "re-hydra.lease."

export type StoredLease = {
  projectSlug: string
  chunkId: string
  leaseToken: string
  leaseExpiresAt: string
  holdStartedAt: string
}

export function leaseKey(projectSlug: string, chunkId: string): string {
  return `${PREFIX}${projectSlug}:${chunkId}`
}

export function loadLease(projectSlug: string, chunkId: string): StoredLease | null {
  try {
    const raw = localStorage.getItem(leaseKey(projectSlug, chunkId))
    if (!raw) return null
    return JSON.parse(raw) as StoredLease
  } catch {
    return null
  }
}

export function saveLease(lease: StoredLease): void {
  localStorage.setItem(leaseKey(lease.projectSlug, lease.chunkId), JSON.stringify(lease))
}

export function clearLease(projectSlug: string, chunkId: string): void {
  localStorage.removeItem(leaseKey(projectSlug, chunkId))
}

export function saveLeaseFromCheckout(projectSlug: string, lease: LeaseWithBundle): StoredLease {
  const stored: StoredLease = {
    projectSlug,
    chunkId: lease.chunk.id,
    leaseToken: lease.leaseToken,
    leaseExpiresAt: lease.leaseExpiresAt,
    holdStartedAt: lease.holdStartedAt
  }
  saveLease(stored)
  return stored
}
