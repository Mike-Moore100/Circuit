// Compact verification-status pill used inside ContactSummaryCard
// (Layer 2 proof) so the operator never has to dig for email
// confidence — it sits beside each contact's email line.

interface Props {
  status: string | null;
  confidence: number | null;
}

const LABEL: Record<string, string> = {
  VALID_LIKELY: 'Likely valid',
  INVALID: 'Invalid',
  RISKY: 'Risky',
  UNKNOWN: 'Unknown',
  UNCHECKED: 'Unchecked',
};

const TONE: Record<string, 'ok' | 'warn' | 'err' | 'muted'> = {
  VALID_LIKELY: 'ok',
  INVALID: 'err',
  RISKY: 'warn',
  UNKNOWN: 'muted',
  UNCHECKED: 'muted',
};

export function EmailConfidencePill({ status, confidence }: Props) {
  const effective = status ?? 'UNCHECKED';
  const tone = TONE[effective] ?? 'muted';
  const label = LABEL[effective] ?? effective;
  return (
    <span
      className={`email-conf email-conf-${tone}`}
      title={
        confidence !== null
          ? `Email confidence ${confidence}/100`
          : 'Email not verified yet'
      }
    >
      {label}
      {confidence !== null && (
        <span className="email-conf-score"> · {confidence}</span>
      )}
    </span>
  );
}
