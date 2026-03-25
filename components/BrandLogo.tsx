type BrandLogoProps = {
  size?: "sm" | "md" | "lg";
  href?: string;
  showText?: boolean;
  className?: string;
};

const sizeClasses = {
  sm: {
    mark: "h-7 w-7",
    text: "text-sm",
    gap: "gap-2",
  },
  md: {
    mark: "h-9 w-9",
    text: "text-lg",
    gap: "gap-3",
  },
  lg: {
    mark: "h-11 w-11",
    text: "text-2xl",
    gap: "gap-3",
  },
};

export default function BrandLogo({
  size = "md",
  href = "/",
  showText = true,
  className = "",
}: BrandLogoProps) {
  const classes = sizeClasses[size];

  return (
    <a
      href={href}
      className={`inline-flex items-center ${classes.gap} text-white hover:text-amber-50 transition-colors ${className}`.trim()}
      aria-label="BOQ Generator home"
    >
      <img src="/boq-mark.svg" alt="" className={`${classes.mark} shrink-0`} />
      {showText && (
        <span className={`${classes.text} font-semibold tracking-tight leading-none`}>
          BOQ <span className="text-amber-400">Generator</span>
        </span>
      )}
    </a>
  );
}
