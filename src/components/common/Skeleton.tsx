/** Grey placeholders in the shape of what is coming, so a first read looks like a page filling in rather than a wait. */
export function SkeletonLine({ width = '100%', height = 14 }: { width?: string; height?: number }) {
  return <span className="skeleton" style={{ width, height }} aria-hidden="true" />;
}

/** A page's worth of stat tiles and panels, for a screen whose first read has not landed. */
export function PageSkeleton() {
  return (
    <div className="skeleton-page" role="status" aria-label="Loading">
      <div className="skeleton-tiles">
        {[0, 1, 2, 3].map((tile) => (
          <div key={tile} className="skeleton-card">
            <SkeletonLine width="45%" height={12} />
            <SkeletonLine width="30%" height={28} />
          </div>
        ))}
      </div>
      <div className="skeleton-card">
        <SkeletonLine width="25%" height={18} />
        <SkeletonLine height={180} />
      </div>
      <div className="skeleton-card">
        <SkeletonLine width="30%" height={18} />
        {[0, 1, 2, 3, 4].map((row) => (
          <SkeletonLine key={row} />
        ))}
      </div>
    </div>
  );
}
