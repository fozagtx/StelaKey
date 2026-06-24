import { cn } from "@/lib/utils";

type BrandLogoProps = {
  className?: string;
  decorative?: boolean;
  label?: string;
  size?: number;
};

function svgA11y(decorative: boolean, label: string) {
  return {
    "aria-hidden": decorative ? true : undefined,
    "aria-label": decorative ? undefined : label,
    role: decorative ? undefined : "img"
  };
}

export function StelaKeyMark({
  className,
  decorative = true,
  label = "StelaKey",
  size = 40
}: BrandLogoProps) {
  return (
    <img
      aria-hidden={decorative ? true : undefined}
      alt={decorative ? "" : label}
      className={cn("stelakey-mark-image", className)}
      height={size}
      src="/brand/stelakey-mark.png"
      style={{ height: size, width: size }}
      width={size}
    />
  );
}

export function BitcoinLogo({
  className,
  decorative = true,
  label = "Bitcoin",
  size = 40
}: BrandLogoProps) {
  return (
    <svg
      {...svgA11y(decorative, label)}
      className={cn("brand-logo-svg bitcoin-logo", className)}
      height={size}
      viewBox="0 0 4091.27 4091.73"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M4030.06 2540.77c-273.24 1096.01-1383.32 1763.02-2479.46 1489.71C454.92 3757.24-212.09 2647.09 61.27 1551.17 334.39 455.04 1444.47-212.02 2540.27 61.22c1096.06 273.24 1763.03 1383.51 1489.76 2479.57z"
        fill="#f7931a"
      />
      <path
        d="M2947.77 1754.38c40.72-272.26-166.56-418.61-450-516.24l91.95-368.8-224.5-55.94-89.51 359.09c-59.02-14.72-119.63-28.59-179.87-42.34L2186 768.69l-224.36-55.94-92 368.68c-48.84-11.12-96.81-22.11-143.35-33.69l.26-1.16-309.59-77.31-59.72 239.78s166.56 38.18 163.05 40.53c90.91 22.69 107.35 82.87 104.62 130.57l-104.74 420.15c6.26 1.59 14.38 3.89 23.34 7.49-7.49-1.86-15.46-3.89-23.73-5.87l-146.81 588.57c-11.11 27.62-39.31 69.07-102.87 53.33 2.25 3.26-163.17-40.72-163.17-40.72l-111.46 256.98 292.15 72.83c54.35 13.63 107.61 27.89 160.06 41.3l-92.9 373.03 224.24 55.94 92-369.07c61.26 16.63 120.71 31.97 178.91 46.43l-91.69 367.33 224.51 55.94 92.89-372.33c382.82 72.45 670.67 43.24 791.83-303.02 97.63-278.78-4.86-439.58-206.26-544.44 146.69-33.83 257.18-130.31 286.64-329.61zm-512.93 719.26c-69.38 278.78-538.76 128.08-690.94 90.29l123.28-494.2c152.17 37.99 640.17 113.17 567.67 403.91zm69.43-723.3c-63.29 253.58-453.96 124.75-580.69 93.16l111.77-448.21c126.73 31.59 534.85 90.55 468.94 355.05z"
        fill="#fff"
      />
    </svg>
  );
}

export function StellarLogo({
  className,
  decorative = true,
  label = "Stellar",
  size = 40
}: BrandLogoProps) {
  return (
    <svg
      {...svgA11y(decorative, label)}
      className={cn("brand-logo-svg stellar-logo", className)}
      height={size}
      viewBox="0 0 236.36 200"
      width={Math.round(size * 1.18)}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="m203 26.16-28.46 14.5-137.43 70a82.49 82.49 0 0 1-.7-10.69A81.87 81.87 0 0 1 158.2 28.6l16.29-8.3 2.43-1.24A100 100 0 0 0 18.18 100q0 3.82.29 7.61a18.19 18.19 0 0 1-9.88 17.58L0 129.57V150l25.29-12.89 8.19-4.18 8.07-4.11 144.88-73.82 16.28-8.29 33.65-17.15V9.14z"
        fill="currentColor"
      />
      <path
        d="M236.36 50 49.78 145l-16.28 8.31L0 170.38v20.41l33.27-16.95 28.46-14.5L199.3 89.24A83.45 83.45 0 0 1 200 100a81.87 81.87 0 0 1-121.91 71.36l-1 .53-17.66 9A100 100 0 0 0 218.18 100c0-2.57-.1-5.14-.29-7.68a18.2 18.2 0 0 1 9.87-17.58l8.6-4.38z"
        fill="currentColor"
      />
    </svg>
  );
}
