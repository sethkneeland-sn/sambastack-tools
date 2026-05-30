"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  href: string;
  label: string;
  isActive: (pathname: string) => boolean;
}

const ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Experiments",
    isActive: (p) => p === "/" || p.startsWith("/experiments"),
  },
  {
    href: "/providers",
    label: "Providers",
    isActive: (p) => p === "/providers" || p.startsWith("/providers/"),
  },
  {
    href: "/datasets",
    label: "Datasets",
    isActive: (p) => p === "/datasets" || p.startsWith("/datasets/"),
  },
  {
    href: "/scorers",
    label: "Scorers",
    isActive: (p) => p === "/scorers" || p.startsWith("/scorers/"),
  },
];

export default function SideNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1 px-3 py-4">
      {ITEMS.map((item) => {
        const active = item.isActive(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`px-3 py-2 rounded-md text-sm transition-colors ${
              active
                ? "bg-[var(--accent-soft)] text-[var(--accent)] font-semibold"
                : "text-[var(--foreground)] font-medium hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
            }`}
            aria-current={active ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
