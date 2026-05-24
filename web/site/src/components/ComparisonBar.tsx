import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { HostOption } from "../types";

export function ComparisonBar({
  title,
  description,
  hosts,
  selectedHostIds,
  onHostToggle,
}: {
  title: string;
  description?: string;
  hosts: HostOption[];
  selectedHostIds: string[];
  onHostToggle: (hostId: string) => void;
}) {
  const [platformMenuOpen, setPlatformMenuOpen] = useState(false);
  const platformMenuRef = useRef<HTMLDivElement | null>(null);
  const selectedHosts = hosts.filter((host) => selectedHostIds.includes(host.id));
  const platformSummary = summarizePlatforms(selectedHosts);

  useEffect(() => {
    if (!platformMenuOpen) {
      return;
    }
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!platformMenuRef.current?.contains(event.target as Node)) {
        setPlatformMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [platformMenuOpen]);

  return (
    <header className="comparison-bar">
      <div className="comparison-title">
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      <div
        className="platform-selector"
        ref={platformMenuRef}
        data-selected-count={selectedHostIds.length}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setPlatformMenuOpen(false);
          }
        }}
      >
        <button
          type="button"
          className="platform-trigger"
          aria-haspopup="listbox"
          aria-expanded={platformMenuOpen}
          onClick={() => setPlatformMenuOpen((open) => !open)}
        >
          <span className="platform-trigger-label">Platforms</span>
          <strong>{platformSummary}</strong>
          <ChevronDown className="size-4" />
        </button>
        {platformMenuOpen ? (
          <div
            className="platform-menu"
            role="listbox"
            aria-label="Platform comparison set"
            aria-multiselectable="true"
          >
            {hosts.map((host) => {
              const active = selectedHostIds.includes(host.id);
              const canToggle = !active || selectedHostIds.length > 1;
              return (
                <button
                  key={host.id}
                  type="button"
                  className={active ? "platform-menu-item active" : "platform-menu-item"}
                  role="option"
                  aria-selected={active}
                  disabled={!canToggle}
                  onClick={() => {
                    if (canToggle) {
                      onHostToggle(host.id);
                    }
                  }}
                >
                  <span className="check-box">{active ? "✓" : ""}</span>
                  <span>
                    <strong>{host.label}</strong>
                    <small>{host.cpu}</small>
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </header>
  );
}

function summarizePlatforms(hosts: HostOption[]) {
  if (hosts.length === 0) {
    return "No platform selected";
  }
  if (hosts.length <= 2) {
    return hosts.map((host) => host.label).join(" · ");
  }
  return `${hosts[0].label} · ${hosts[1].label} · +${hosts.length - 2}`;
}
