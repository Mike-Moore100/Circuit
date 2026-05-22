// Layout-level non-dismissable banners. Server component; the data
// loader is pure SQL so this is cheap to render on every navigation.

import { getSystemStatusBanners } from '../_lib/systemStatus';

export function SystemStatusBanners() {
  const banners = getSystemStatusBanners();
  if (banners.length === 0) return null;
  return (
    <div className="system-banners">
      {banners.map((b) => (
        <div
          key={b.code}
          className={`system-banner system-banner-${b.level}`}
          role="alert"
          data-banner={b.code}
        >
          <span className="system-banner-level">{b.level}</span>
          <div className="system-banner-body">
            <strong>{b.title}.</strong>
            <span>{b.body}</span>
            {b.helpHref && (
              <a href={b.helpHref} target="_blank" rel="noreferrer" className="system-banner-link">
                Open docs →
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
