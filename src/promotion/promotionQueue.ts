// DB-level queue operations for the qualification pipeline. Thin
// adapters over the repository — kept in the promotion module so the
// rest of the qualification system reads cleanly.

import type { Database } from 'better-sqlite3';
import { getDb } from '../db/client';
import {
  listQualificationQueue,
  transitionQualificationStatus,
  upsertQualificationQueueRow,
  type QualificationQueueDbRow,
} from '../db/repository';
import type {
  QualificationQueueRow,
  QualificationStatus,
} from './promotionTypes';

function toRow(row: QualificationQueueDbRow): QualificationQueueRow {
  return {
    id: row.id,
    discoveryId: row.discovery_id,
    companyId: row.company_id,
    domain: row.domain,
    source: row.source,
    status: row.status as QualificationStatus,
    priority: row.priority,
    promotionReason: row.promotion_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function enqueueQualification(
  input: {
    discoveryId: string | null;
    companyId: string | null;
    domain: string;
    source: string;
    status: QualificationStatus;
    priority: number;
    promotionReason: string;
  },
  db: Database = getDb(),
): QualificationQueueRow {
  return toRow(upsertQualificationQueueRow(input, db));
}

export function transitionStatus(
  domain: string,
  status: QualificationStatus,
  options: { companyId?: string | null; errorMessage?: string | null } = {},
  db: Database = getDb(),
): void {
  transitionQualificationStatus(domain, status, options, db);
}

export function listQueue(
  options: { status?: QualificationStatus | QualificationStatus[]; limit?: number } = {},
  db: Database = getDb(),
): QualificationQueueRow[] {
  return listQualificationQueue(options, db).map(toRow);
}

export function listPendingDomains(
  limit = 50,
  db: Database = getDb(),
): QualificationQueueRow[] {
  return listQueue({ status: 'PENDING', limit }, db);
}
