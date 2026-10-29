"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/", label: "Investigate" },
  { href: "/records", label: "Safeguard Records" },
  { href: "/lab", label: "Evaluation Lab" },
  { href: "/incidents", label: "Incident Explorer" },
  { href: "/safeguards", label: "Safeguards" },
  { href: "/memory", label: "Memory Ledger" },
  { href: "/evaluation", label: "Evaluation" },
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

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [config, setConfig] = useState<ConfigSummary | null>(null);

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

  return (
    <div className="grid-bg min-h-screen">
      <div className="mx-auto flex max-w-[1400px] gap-0">
        <aside className="sticky top-0 hidden h-screen w-[232px] shrink-0 flex-col border-r hairline bg-[#080a0e]/80 px-4 py-5 md:flex">
          <div className="mb-6">
            <div className="flex items-center gap-2">
              <Mark />
              <div>
                <div className="text-[0.9375rem] font-semibold tracking-tight">
                  AFTERMATH
                </div>
                <div className="mono text-[0.625rem] uppercase tracking-[0.14em] text-paper-500">
                  Failure Prevention
                </div>
              </div>
            </div>
          </div>

          <nav className="space-y-0.5">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="nav-link"
                data-active={
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href)
                }
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="mt-auto space-y-3 pt-6">
            <div className="rounded border hairline bg-[#0b0e13] p-2.5">
              <div className="mono text-[0.625rem] uppercase tracking-[0.1em] text-paper-500">
                Memory backend
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <span
                  className={`dot ${config?.memory.isLive ? "bg-signal-ok" : "bg-signal-warn"}`}
                />
                <span className="mono text-[0.6875rem]">
                  {config?.memory.backend ?? "…"}
                </span>
              </div>
              <div className="mono mt-1 text-[0.625rem] text-paper-500">
                {config?.memory.network ?? ""}
              </div>
            </div>
            <div className="rounded border hairline bg-[#0b0e13] p-2.5">
              <div className="mono text-[0.625rem] uppercase tracking-[0.1em] text-paper-500">
                Tatum RPC
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <span
                  className={`dot ${config?.tatum.configured ? "bg-signal-ok" : "bg-signal-bad"}`}
                />
                <span className="mono text-[0.6875rem]">
                  {config?.tatum.configured ? "key set" : "no key"}
                </span>
              </div>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b hairline bg-[#080a0e]/90 px-5 py-3 backdrop-blur md:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <div className="md:hidden">
                <Mark />
              </div>
              <div className="mono min-w-0 truncate text-[0.6875rem] uppercase tracking-[0.12em] text-paper-500">
                Every failure should leave a safeguard
              </div>
            </div>
            <nav className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 md:hidden">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="mono whitespace-nowrap text-[0.6875rem] text-paper-300"
                >
                  {item.label.split(" ")[0]}
                </Link>
              ))}
            </nav>
          </header>
          <div className="px-5 py-6 md:px-8">{children}</div>
        </main>
      </div>
    </div>
  );
}

function Mark() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="1" y="1" width="22" height="22" rx="4" stroke="#2b3442" />
      <path d="M6 17 L12 6 L18 17" stroke="#4a9eff" strokeWidth="1.6" fill="none" />
      <path d="M9 13 H15" stroke="#3fb950" strokeWidth="1.6" />
    </svg>
  );
}
