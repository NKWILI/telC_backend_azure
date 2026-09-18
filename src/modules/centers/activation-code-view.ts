import type { ActivationCodeStatus, Tier } from '@prisma/client';
import { planIdFor, type PlanId } from '../../shared/plan-id';

/**
 * A code as a client sees it.
 *
 * One mapping for every route that returns a code — the trial, the Users
 * page list, activate and deactivate — so a field added later appears
 * everywhere at once instead of in whichever response was edited last.
 *
 * Built field by field rather than by spreading the row, so a column added to
 * the table cannot leak into a response by default. `connected_ip` is the
 * obvious one: it is an audit trail for us, not something to show a center.
 */
export interface ActivationCodeView {
  id: string;
  code: string;
  status: 'activated' | 'connected' | 'deactivated';
  planId: PlanId;
  linkedName: string | null;
  linkedEmail: string | null;
  connectedAt: Date | null;
  createdAt: Date;
  expiresAt: Date | null;
}

const STATUS_VIEW: Record<ActivationCodeStatus, ActivationCodeView['status']> =
  {
    ACTIVATED: 'activated',
    CONNECTED: 'connected',
    DEACTIVATED: 'deactivated',
  };

export function toActivationCodeView(row: {
  id: string;
  code: string;
  status: ActivationCodeStatus;
  tier: Tier;
  linked_name: string | null;
  linked_email: string | null;
  connected_at: Date | null;
  created_at: Date;
  expires_at: Date | null;
}): ActivationCodeView {
  return {
    id: row.id,
    code: row.code,
    // Lower case, like the plan ids: the database's spelling stays inside.
    status: STATUS_VIEW[row.status],
    planId: planIdFor(row.tier),
    linkedName: row.linked_name,
    linkedEmail: row.linked_email,
    connectedAt: row.connected_at,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}
