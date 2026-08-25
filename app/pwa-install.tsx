"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export default function PwaInstall() {
  const pathname = usePathname();
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    if (pathname.startsWith("/platform-admin")) return;
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }

    const alreadyInstalled = window.matchMedia("(display-mode: standalone)").matches;
    if (alreadyInstalled) return;

    const capturePrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const clearPrompt = () => setInstallPrompt(null);

    window.addEventListener("beforeinstallprompt", capturePrompt);
    window.addEventListener("appinstalled", clearPrompt);
    return () => {
      window.removeEventListener("beforeinstallprompt", capturePrompt);
      window.removeEventListener("appinstalled", clearPrompt);
    };
  }, [pathname]);

  if (!installPrompt || pathname.startsWith("/platform-admin")) return null;

  async function install() {
    await installPrompt?.prompt();
    const choice = await installPrompt?.userChoice;
    if (choice?.outcome === "accepted") setInstallPrompt(null);
  }

  return (
    <button className="pwa-install-button" type="button" onClick={install} aria-label="Install Hamro Afno app">
      <span aria-hidden="true">↓</span>
      Install app
    </button>
  );
}
