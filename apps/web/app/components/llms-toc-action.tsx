"use client";

import { BotIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const RAIL_SELECTOR =
  "#nd-docs-layout .fd-page-actions-rail, #nd-docs-layout [data-page-actions-variant='rail']";

function syncRailAction() {
  const rail = document.querySelector<HTMLElement>(RAIL_SELECTOR);

  if (rail) {
    for (const button of rail.querySelectorAll<HTMLButtonElement>("button.fd-page-action-btn")) {
      const label = button.textContent?.replace(/\s+/g, " ").trim();
      if (label === "Ask AI") {
        button.dataset.gragHiddenAskAi = "true";
      }
    }
  }

  return rail;
}

export function LlmsTocAction() {
  const pathname = usePathname();
  const [rail, setRail] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let frame = 0;

    const updateRail = () => {
      const nextRail = syncRailAction();
      setRail((currentRail) => (currentRail === nextRail ? currentRail : nextRail));
    };

    const scheduleUpdate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateRail);
    };

    updateRail();

    const observer = new MutationObserver(scheduleUpdate);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [pathname]);

  if (!rail) {
    return null;
  }

  return createPortal(
    <a
      className="fd-page-action-btn"
      data-grag-llms-toc-action
      href="/llms.txt"
      rel="noreferrer"
      target="_blank"
    >
      <BotIcon aria-hidden="true" />
      <span>llms.txt</span>
    </a>,
    rail,
  );
}
