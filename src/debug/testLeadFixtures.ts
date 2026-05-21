import type { RawLead } from '../types/index';
import { MOCK_LEADS } from '../sources/mockSourceConnector';

// Re-export under a debug-friendly name. Keeps "what we test against" and
// "what we seed" in a single source of truth.
export const TEST_LEAD_FIXTURES: RawLead[] = MOCK_LEADS;

export function fixtureByCompanyName(name: string): RawLead | undefined {
  return TEST_LEAD_FIXTURES.find((l) => l.companyName.toLowerCase() === name.toLowerCase());
}
