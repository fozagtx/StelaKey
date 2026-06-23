import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Activity02Icon,
  ArrowDataTransferHorizontalIcon,
  BitcoinIcon,
  CheckmarkCircle02Icon,
  Copy01Icon,
  DashboardSquare01Icon,
  DocumentValidationIcon,
  Home01Icon,
  Link01Icon,
  LockKeyIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  Payment01Icon,
  SecurityCheckIcon,
  ShieldKeyIcon,
  UserAccountIcon,
  Wallet03Icon
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";

const iconMap = {
  activity: Activity02Icon,
  account: UserAccountIcon,
  authorize: ShieldKeyIcon,
  bitcoin: BitcoinIcon,
  copy: Copy01Icon,
  dashboard: DashboardSquare01Icon,
  empty: DocumentValidationIcon,
  home: Home01Icon,
  link: Link01Icon,
  lock: LockKeyIcon,
  panelClose: PanelLeftCloseIcon,
  panelOpen: PanelLeftOpenIcon,
  payment: Payment01Icon,
  ready: CheckmarkCircle02Icon,
  security: SecurityCheckIcon,
  transfer: ArrowDataTransferHorizontalIcon,
  wallet: Wallet03Icon
} satisfies Record<string, IconSvgElement>;

export type ProductIconName = keyof typeof iconMap;

type ProductIconProps = {
  name: ProductIconName;
  className?: string;
  size?: number;
  strokeWidth?: number;
  decorative?: boolean;
  label?: string;
};

export function ProductIcon({
  name,
  className,
  size = 32,
  strokeWidth = 1.8,
  decorative = true,
  label
}: ProductIconProps) {
  return (
    <HugeiconsIcon
      aria-hidden={decorative ? "true" : undefined}
      aria-label={decorative ? undefined : label}
      className={cn("product-icon-svg", className)}
      color="currentColor"
      icon={iconMap[name]}
      role={decorative ? undefined : "img"}
      size={size}
      strokeWidth={strokeWidth}
    />
  );
}
