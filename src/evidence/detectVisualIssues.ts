import type {
  CaptureResult,
  DomSnapshot,
  VisualIssue,
} from './evidenceTypes';

function issue(
  code: VisualIssue['code'],
  label: string,
  confidence: number,
  campaign: VisualIssue['campaign'],
  detail?: string,
): VisualIssue {
  return { code, label, confidence, campaign, detail };
}

// All checks are deterministic and read only the DomSnapshot. Tests pass
// fixture snapshots; the runtime passes whatever Playwright collected.
export function detectVisualIssues(capture: CaptureResult): VisualIssue[] {
  const out: VisualIssue[] = [];

  // Page didn't load (no desktop snapshot or response not ok)
  if (!capture.desktop) {
    out.push(
      issue(
        'page_failed_to_load',
        'Page failed to load',
        95,
        'WEB_REBUILD',
        capture.errorMessage,
      ),
    );
    return out;
  }
  if (!capture.desktop.ok) {
    out.push(
      issue(
        'page_failed_to_load',
        `Desktop request returned non-2xx`,
        90,
        'WEB_REBUILD',
      ),
    );
  }

  const d = capture.desktop;
  const m = capture.mobile;

  if (d.h1Count === 0) {
    out.push(issue('no_h1', 'No <h1> on the page', 70, 'WEB_REBUILD'));
  }

  if (d.ctaTexts.length === 0 && d.buttonCount === 0) {
    out.push(
      issue(
        'no_visible_cta',
        'No visible call-to-action button on the homepage',
        80,
        'FUNNEL_OPTIMIZATION',
      ),
    );
  }

  if (!d.hasMailto && !d.hasTel && !d.hasEmailInput && d.formCount === 0) {
    out.push(
      issue(
        'no_contact_path',
        'No reachable contact path on the page (no mailto, tel, form, or email input)',
        85,
        'WEB_REBUILD',
      ),
    );
  }

  if (d.formCount === 0) {
    out.push(
      issue(
        'no_visible_form',
        'No form on the homepage — contact path is link-only',
        55,
        'FUNNEL_OPTIMIZATION',
      ),
    );
  }

  if (!d.hasMetaViewport) {
    out.push(
      issue(
        'no_meta_viewport',
        'Missing <meta name="viewport"> — page is not mobile-responsive',
        90,
        'WEB_REBUILD',
      ),
    );
  }

  if (m) {
    // Allow up to 8px overflow as render quirk
    if (m.scrollWidth > m.viewportWidth + 8) {
      out.push(
        issue(
          'mobile_horizontal_overflow',
          `Mobile content overflows the viewport (${m.scrollWidth}px > ${m.viewportWidth}px)`,
          80,
          'WEB_REBUILD',
          `mobile scroll-width ${m.scrollWidth}, viewport ${m.viewportWidth}`,
        ),
      );
    }
  }

  // Trust signals — at least one of: phone, mailto, copyright, address hint.
  const hasTrust =
    d.hasTel || d.hasMailto || d.hasPhysicalAddressHint || d.hasCopyrightYear;
  if (!hasTrust) {
    out.push(
      issue(
        'no_trust_signals',
        'No obvious trust signals (no phone, email, address, or copyright year)',
        65,
        'WEB_REBUILD',
      ),
    );
  }

  if (d.visibleBodyText.length < 250) {
    out.push(
      issue(
        'sparse_homepage',
        'Homepage has very little visible text — looks placeholder / WIP',
        70,
        'WEB_REBUILD',
        `${d.visibleBodyText.length} chars of visible text`,
      ),
    );
  }

  if (d.consoleErrorCount >= 1) {
    out.push(
      issue(
        'broken_rendering',
        `JavaScript errors during page load (${d.consoleErrorCount})`,
        55,
        'WEB_REBUILD',
      ),
    );
  }

  // Outdated visual-quality heuristic — fires when several "old-website"
  // hints stack up: no responsive meta + no forms + low button count +
  // copyright year that's now stale.
  const currentYear = new Date().getFullYear();
  const copyrightStale =
    d.hasCopyrightYear !== null && currentYear - d.hasCopyrightYear >= 4;
  const fewElements = d.buttonCount <= 1 && d.formCount === 0;
  if (!d.hasMetaViewport && (copyrightStale || fewElements)) {
    out.push(
      issue(
        'outdated_visual_quality',
        'Outdated build heuristics — no responsive meta + stale copyright / sparse interactivity',
        60,
        'WEB_REBUILD',
        copyrightStale
          ? `last copyright year: ${d.hasCopyrightYear}`
          : 'sparse interactive elements',
      ),
    );
  }

  return out;
}

export interface CtaInspection {
  ctaCount: number;
  ctas: string[];
  hasBookingLink: boolean;
  hasContactLink: boolean;
}

// Useful for the FUNNEL_OPTIMIZATION campaign — describe the conversion
// surface so the operator can see at a glance whether a rebuild is the
// right pitch vs a tune-up.
export function summariseCtas(snapshot: DomSnapshot | null): CtaInspection {
  if (!snapshot) {
    return { ctaCount: 0, ctas: [], hasBookingLink: false, hasContactLink: false };
  }
  const ctas = snapshot.ctaTexts;
  return {
    ctaCount: ctas.length,
    ctas,
    hasBookingLink: ctas.some((c) => /book|schedule|demo|call/i.test(c)),
    hasContactLink: ctas.some((c) => /contact|enquire|get in touch|email/i.test(c)),
  };
}
