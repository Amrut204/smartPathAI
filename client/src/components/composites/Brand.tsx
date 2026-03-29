import { Link } from "react-router-dom";

type BrandVariant = "compact" | "full";

interface BrandProps {
  href?: string;
  variant?: BrandVariant;
  descriptor?: string;
  className?: string;
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 40 40" className="brand-mark-svg" focusable="false">
        <rect x="4" y="4" width="32" height="32" rx="10" className="brand-mark-frame" />
        <path d="M13 23.5L19 17.5L23 21.5L29 15.5" className="brand-mark-path" />
        <circle cx="13" cy="23.5" r="1.75" className="brand-mark-node" />
        <circle cx="19" cy="17.5" r="1.75" className="brand-mark-node" />
        <circle cx="23" cy="21.5" r="1.75" className="brand-mark-node" />
        <circle cx="29" cy="15.5" r="1.75" className="brand-mark-node" />
      </svg>
    </span>
  );
}

function BrandInner({ variant, descriptor }: { variant: BrandVariant; descriptor?: string }) {
  return (
    <>
      <BrandMark />
      <span className="brand-copy">
        <span className="brand-wordmark">Smart Path</span>
        {variant === "full" && descriptor ? <span className="brand-descriptor">{descriptor}</span> : null}
      </span>
    </>
  );
}

export function Brand({
  href,
  variant = "compact",
  descriptor,
  className = "",
}: BrandProps) {
  const classes = `brand-lockup brand-${variant} ${href ? "is-link" : "is-static"} ${className}`.trim();

  if (href) {
    return (
      <Link to={href} className={classes} aria-label="Smart Path home">
        <BrandInner variant={variant} descriptor={descriptor} />
      </Link>
    );
  }

  return (
    <div className={classes} aria-label="Smart Path">
      <BrandInner variant={variant} descriptor={descriptor} />
    </div>
  );
}
