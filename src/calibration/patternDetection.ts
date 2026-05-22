// Pattern orchestrator. Wraps the individual detectors so callers
// (calibrationService, CLI, tests) have one entry point.

import type { CalibrationLeadRow } from '../db/repository';
import { computeSignalPerformance } from './signalPerformance';
import { detectOpportunityPatterns } from './opportunityPatterns';
import { detectTrustBarrierPatterns } from './trustBarrierPatterns';
import type {
  OpportunityPattern,
  SignalPerformance,
  TrustBarrierPattern,
} from './calibrationTypes';

export interface DetectionResult {
  signals: SignalPerformance[];
  opportunityPatterns: OpportunityPattern[];
  trustBarrierPatterns: TrustBarrierPattern[];
}

export function detectAllPatterns(rows: CalibrationLeadRow[]): DetectionResult {
  return {
    signals: computeSignalPerformance(rows),
    opportunityPatterns: detectOpportunityPatterns(rows),
    trustBarrierPatterns: detectTrustBarrierPatterns(rows),
  };
}
