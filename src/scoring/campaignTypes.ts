// Circuit segments leads by *what kind of work they need*, not by a binary
// accept/reject. A weak-web SMB is not a dead lead for a web/AI agency —
// it's a Web Rebuild opportunity. A no-website local business isn't dead
// either — it's a Local Digital Upgrade opportunity. Only true
// disqualifiers (enterprise, hobby, in-house automation team, big-corp
// industry) become REJECT.
import type { ScoreReason } from '../types/index';

export const CAMPAIGN_VALUES = [
  'AI_AUTOMATION',
  'WEB_REBUILD',
  'FUNNEL_OPTIMIZATION',
  'LOCAL_DIGITAL_UPGRADE',
  'LOW_PRIORITY_NURTURE',
  'REJECT',
] as const;

export type Campaign = (typeof CAMPAIGN_VALUES)[number];

export const CAMPAIGN_LABEL: Record<Campaign, string> = {
  AI_AUTOMATION: 'AI / automation',
  WEB_REBUILD: 'Web rebuild',
  FUNNEL_OPTIMIZATION: 'Funnel optimization',
  LOCAL_DIGITAL_UPGRADE: 'Local digital upgrade',
  LOW_PRIORITY_NURTURE: 'Low priority / nurture',
  REJECT: 'True reject',
};

export const CAMPAIGN_DESCRIPTION: Record<Campaign, string> = {
  AI_AUTOMATION:
    'Working website, target ICP, visible manual workflows — the agency’s core automation pitch lands here.',
  WEB_REBUILD:
    'Real SMB with a broken / outdated / unusable website. Rebuild-first opportunity.',
  FUNNEL_OPTIMIZATION:
    'Working website, target ICP, but the conversion surface (contact form, booking, CTAs) is missing.',
  LOCAL_DIGITAL_UPGRADE:
    'Real local SMB with no website yet. Starter site + intake first; automation later.',
  LOW_PRIORITY_NURTURE:
    'Borderline fit (low-priority industry like hospitality, or weak signals). Keep on the list, do not pursue actively.',
  REJECT:
    'True disqualifier — enterprise, hobby, in-house automation team, or hard-reject industry. Skip.',
};

export interface CampaignClassification {
  primary: Campaign;
  scores: Record<Campaign, number>;
  reasons: Record<Campaign, ScoreReason[]>;
  trueRejectionReasons: ScoreReason[];
  primaryReason: string;
  suggestedInvestigation: string;
}
