"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  clearAdminToken,
  getAdminToken,
  onAdminTokenChange,
  setAdminToken,
} from "@/lib/admin-token";

/**
 * The application frame: one authoritative primary navigation.
 *
 * Three destinations carry the product (Investigate, Safeguard Records,
 * Evaluation Lab). Everything else — the exploratory views and live system
 * state — lives in a single "System" menu, so the primary path is never
 * crowded and navigation is never duplicated inside a page.
 */

const PRIMARY = [
  { href: "/", label: "Investigate" },
  { href: "/records", label: "Safeguard Records" },
  { href: "/lab", label: "Evaluation Lab" },
];

const SYSTEM = [
  {
    href: "/incidents",
    label: "Incident Explorer",
    hint: "Every evaluated action, with its evidence.",
  },
  {
    href: "/safeguards",
    label: "Safeguards",
    hint: "Active and proposed rules.",
  },
  {
    href: "/memory",
    label: "Memory Ledger",
    hint: "Walrus Memory writes and recall.",
  },
  {
    href: "/evaluation",
    label: "Evaluation",
    hint: "Repeat prevention and false-block rate.",
  },
];

interface ConfigSummary {
  memory: {
    backend: string;
    isLive: boolean;
    relayerUrl: string;
    network: string;
    namespace: string;
  };
  tatum: { rpcUrl: string; configured: boolean };
}

const isActive = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname.startsWith(href);

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [config, setConfig] = useState<ConfigSummary | null>(null);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/config")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setConfig(data as ConfigSummary);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Close the menu on navigation.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Close on Escape, and on a click outside the menu.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const systemActive = SYSTEM.some((s) => isActive(pathname, s.href));

  return (
    <div className="grid-bg min-h-screen">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b hairline bg-[#06080b]/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-content items-center gap-6 px-5 md:px-8">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2.5"
            aria-label="AFTERMATH home"
          >
            <Mark />
            <span className="flex flex-col leading-none">
              <span className="text-[0.9375rem] font-semibold tracking-tight">
                AFTERMATH
              </span>
              <span className="mono mt-0.5 hidden text-[0.6875rem] uppercase tracking-[0.15em] text-paper-500 sm:block">
                Failure Prevention
              </span>
            </span>
          </Link>

          {/* Primary destinations — desktop */}
          <nav
            aria-label="Primary"
            className="hidden items-center gap-1 md:flex"
          >
            {PRIMARY.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="nav-item"
                data-active={isActive(pathname, item.href)}
                aria-current={isActive(pathname, item.href) ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2" ref={menuRef}>
            <AdminTokenControl />
            {/* Secondary destinations — desktop */}
            <div className="relative hidden md:block">
              <button
                type="button"
                className="nav-item"
                data-active={systemActive}
                aria-expanded={open}
                aria-haspopup="true"
                aria-controls="system-menu"
                onClick={() => setOpen((v) => !v)}
              >
                System
                <Chevron open={open} />
              </button>
              {open ? (
                <div
                  id="system-menu"
                  className="panel absolute right-0 top-[calc(100%+0.5rem)] w-[22rem] p-2 shadow-2xl shadow-black/60"
                >
                  <ul>
                    {SYSTEM.map((item) => (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className="block rounded px-3 py-2 transition-colors hover:bg-white/[0.035]"
                          aria-current={
                            isActive(pathname, item.href) ? "page" : undefined
                          }
                        >
                          <span className="text-[0.8125rem] font-medium">
                            {item.label}
                          </span>
                          <span className="mt-0.5 block text-[0.75rem] leading-snug text-paper-500">
                            {item.hint}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <StatusRow config={config} />
                </div>
              ) : null}
            </div>

            {/* Everything — mobile */}
            <button
              type="button"
              className="nav-item md:hidden"
              aria-expanded={open}
              aria-controls="mobile-menu"
              onClick={() => setOpen((v) => !v)}
            >
              <MenuIcon open={open} />
              <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
            </button>
          </div>
        </div>

        {/* Mobile menu panel */}
        {open ? (
          <div
            id="mobile-menu"
            className="border-t hairline bg-[#06080b] md:hidden"
          >
            <nav aria-label="Mobile" className="mx-auto max-w-content px-5 py-3">
              <ul className="space-y-0.5">
                {[...PRIMARY, ...SYSTEM].map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="flex min-h-[2.75rem] items-center rounded px-3 text-[0.9375rem] text-paper-300"
                      data-active={isActive(pathname, item.href)}
                      aria-current={
                        isActive(pathname, item.href) ? "page" : undefined
                      }
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
              <StatusRow config={config} />
            </nav>
          </div>
        ) : null}
      </header>

      <main id="main" className="mx-auto max-w-content px-5 py-10 md:px-8 md:py-14">
        {children}
      </main>

      <footer className="border-t hairline">
        <div className="mx-auto flex max-w-content flex-col gap-2 px-5 py-8 text-[0.8125rem] text-paper-500 md:flex-row md:items-center md:justify-between md:px-8">
          <p>
            AFTERMATH — every failure should leave a safeguard.
          </p>
          <p className="mono text-[0.6875rem] uppercase tracking-[0.12em]">
            Walrus Memory · Tatum Sui
          </p>
        </div>
      </footer>
    </div>
  );
}

/**
 * The administrator-token control.
 *
 * The gated endpoints require `AFTERMATH_ADMIN_TOKEN`. The operator pastes the
 * same value here once per browser session; it is held in `sessionStorage` and
 * attached to this app's gated requests. It is never rendered back to the page.
 */
function AdminTokenControl() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [configured, setConfigured] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sync = () => setConfigured(getAdminToken().length > 0);
    sync();
    return onAdminTokenChange(sync);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const save = () => {
    setAdminToken(value.trim());
    setValue("");
    setOpen(false);
  };

  const clear = () => {
    clearAdminToken();
    setValue("");
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="nav-item"
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls="admin-token-panel"
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className={`dot ${configured ? "bg-signal-ok" : "bg-paper-600"}`}
          aria-hidden
        />
        <span className="text-[0.8125rem]">Admin</span>
        <span className="sr-only">
          {configured ? "administrator token set" : "administrator token not set"}
        </span>
      </button>
      {open ? (
        <div
          id="admin-token-panel"
          className="panel absolute right-0 top-[calc(100%+0.5rem)] w-[22rem] p-3 shadow-2xl shadow-black/60"
        >
          <p className="text-[0.75rem] leading-snug text-paper-500">
            Write and destructive actions need the deployment&apos;s{" "}
            <span className="mono">AFTERMATH_ADMIN_TOKEN</span>. It is stored only
            in this tab&apos;s session and never sent anywhere but this app.
          </p>
          <label
            htmlFor="admin-token-input"
            className="mono mt-3 block text-[0.6875rem] uppercase tracking-[0.15em] text-paper-500"
          >
            Administrator token
          </label>
          <input
            id="admin-token-input"
            type="password"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
            }}
            placeholder={configured ? "(set — enter to replace)" : "paste token"}
            className="mt-1 w-full rounded border hairline bg-black/40 px-2 py-1.5 text-[0.8125rem]"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              className="nav-item"
              onClick={save}
              disabled={!value.trim()}
            >
              Save
            </button>
            <button
              type="button"
              className="nav-item"
              onClick={clear}
              disabled={!configured}
            >
              Clear
            </button>
            <span className="mono ml-auto text-[0.6875rem] text-paper-500">
              {configured ? "configured" : "not set"}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Live system state, shown inside the System menu only. */
function StatusRow({ config }: { config: ConfigSummary | null }) {
  return (
    <div className="mt-2 border-t hairline px-3 pb-1 pt-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="flex items-center gap-1.5">
          <span
            className={`dot ${config?.memory.isLive ? "bg-signal-ok" : "bg-signal-warn"}`}
            aria-hidden
          />
          <span className="mono text-[0.6875rem] text-paper-500">
            {config ? config.memory.backend : "memory …"}
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className={`dot ${config?.tatum.configured ? "bg-signal-ok" : "bg-signal-bad"}`}
            aria-hidden
          />
          <span className="mono text-[0.6875rem] text-paper-500">
            Tatum {config?.tatum.configured ? "key set" : "no key"}
          </span>
        </span>
        <Link href="/lab" className="link-quiet mono text-[0.6875rem]">
          Full state →
        </Link>
      </div>
    </div>
  );
}

function Mark() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="1" y="1" width="22" height="22" rx="5" stroke="#2b3442" />
      <path d="M6 17 L12 6 L18 17" stroke="#5b9dff" strokeWidth="1.6" fill="none" />
      <path d="M9 13 H15" stroke="#3fbf6f" strokeWidth="1.6" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden
      className={`transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="M3 4.5 L6 7.5 L9 4.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
    </svg>
  );
}

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      {open ? (
        <path d="M4 4 L14 14 M14 4 L4 14" stroke="currentColor" strokeWidth="1.5" />
      ) : (
        <path d="M3 5 H15 M3 9 H15 M3 13 H15" stroke="currentColor" strokeWidth="1.5" />
      )}
    </svg>
  );
}
