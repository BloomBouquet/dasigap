import Link from "next/link";

const links = [
  { href: "/", label: "홈" },
  { href: "/items", label: "내 물건" },
  { href: "/report", label: "리포트" },
];

export function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="주요 메뉴">
      {links.map((link) => (
        <Link href={link.href} key={link.href}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
