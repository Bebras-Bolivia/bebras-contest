"use client";

import { useState } from "react";
import { MenuIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useAuthUser } from "@/lib/use-auth-user";
import { canAccessSiteNav, SITE_NAV_ITEMS } from "@/lib/site-navigation";

type MobileNavigationProps = {
  pathname: string;
};

export function MobileNavigation({ pathname }: MobileNavigationProps) {
  const [open, setOpen] = useState(false);
  const user = useAuthUser();
  const links = [
    { href: "/", label: "Inicio" },
    ...SITE_NAV_ITEMS.filter((item) =>
      canAccessSiteNav(item.role, user?.role, user?.status),
    ),
  ];

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="contents lg:hidden"
    >
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          size="icon-lg"
          variant="ghost"
          aria-label={open ? "Cerrar menú" : "Abrir menú"}
        >
          {open ? <XIcon /> : <MenuIcon />}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="order-last w-full basis-full pt-3">
        <nav
          aria-label="Navegación principal"
          className="flex flex-col gap-2 border-t pt-3"
        >
          {links.map((link) => {
            const active =
              link.href === "/"
                ? pathname === "/"
                : pathname === link.href ||
                  pathname.startsWith(`${link.href}/`);

            return (
              <Button
                key={link.href}
                asChild
                variant="ghost"
                className={cn(
                  "relative w-full justify-start",
                  active
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground",
                )}
              >
                <a
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setOpen(false)}
                >
                  {active && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-2 left-0 w-[3px] bg-primary"
                    />
                  )}
                  {link.label}
                </a>
              </Button>
            );
          })}
        </nav>
      </CollapsibleContent>
    </Collapsible>
  );
}
