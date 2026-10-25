"use client";

import { useSyncExternalStore } from "react";
import Image from "next/image";
import { Newsreader } from "next/font/google";
import {
  BotMessageSquare,
  Rocket,
  TrendingUp,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import styles from "./klivo-auth-panel.module.css";

// Self-hosted by next/font. Not preloaded: the panel is hidden on phones, so
// they never fetch it, and the headline fades in long enough to hide the swap.
const newsreader = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-newsreader",
  preload: false,
});

const STEPS: { title: string; line: string; Icon: LucideIcon }[] = [
  {
    title: "Build",
    line: "On your knowledge and tools",
    Icon: BotMessageSquare,
  },
  { title: "Automate", line: "Any workflow, end to end", Icon: Workflow },
  { title: "Launch", line: "On any text or voice channel", Icon: Rocket },
  { title: "Improve", line: "With every conversation", Icon: TrendingUp },
];

// The auth pages are prerendered, so a year read during render would freeze at
// the build year. The HTML carries the build year; the browser swaps in its own
// after hydration without a mismatch.
const BUILD_YEAR = new Date().getFullYear();
const noSubscribe = () => () => {};

function useCurrentYear() {
  return useSyncExternalStore(
    noSubscribe,
    () => new Date().getFullYear(),
    () => BUILD_YEAR,
  );
}

/**
 * Right-hand marketing panel for the auth screens. Fills its parent, so the
 * parent must have a height. Styles scale with the panel's own width (container
 * query units) and go static under prefers-reduced-motion.
 */
export function KlivoAuthPanel() {
  const year = useCurrentYear();

  return (
    <aside
      className={`${styles.root} ${newsreader.variable}`}
      aria-label="About Klivo"
    >
      <div className={styles.veil} aria-hidden="true" />

      <header className={styles.top}>
        <span className={styles.logo}>
          <Image
            src="/auth/klivo-mark-white.png"
            alt=""
            width={30}
            height={31}
          />
          <span>Klivo</span>
        </span>
      </header>

      <div className={styles.hero}>
        <h2 className={styles.title}>
          <span className={styles.line}>Where your agents</span>
          <span className={styles.line}>
            <em>
              go to work.
              <svg
                viewBox="0 0 300 18"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path d="M3 12 C 60 5, 120 15, 180 9 S 270 6, 297 10" />
              </svg>
            </em>
          </span>
        </h2>
        <p className={styles.sub}>
          AI agents that talk to your users, act inside your systems and get the
          work done.
        </p>

        <div className={styles.flow}>
          <span className={styles.rail} aria-hidden="true">
            <i />
          </span>
          <ol className={styles.steps}>
            {STEPS.map(({ title, line, Icon }) => (
              <li className={styles.step} key={title}>
                <span className={styles.icon} aria-hidden="true">
                  <Icon strokeWidth={1.6} />
                </span>
                <strong>{title}</strong>
                <span>{line}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <figure className={styles.quote}>
        <blockquote>
          What stood out about Klivo was that they actually understood what we
          needed before building anything.
        </blockquote>
        <figcaption>
          <strong>Shailendra Pol</strong>
          <span>Director, Panvelkar &amp; Pol Associates</span>
        </figcaption>
      </figure>

      <footer className={styles.foot}>
        <span className={styles.copy}>© {year} Klivo</span>
        <a
          className={styles.link}
          href="https://www.getklivo.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          getklivo.com<span aria-hidden="true"> ↗</span>
        </a>
      </footer>
    </aside>
  );
}
