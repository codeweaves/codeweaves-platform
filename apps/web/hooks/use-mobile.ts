import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    // Key off the SAME query Tailwind's `md:` uses — `(min-width: 768px)` —
    // inverted, and read `mql.matches` (NOT window.innerWidth).
    //
    // Why: window.innerWidth is rounded to an integer. At a non-integer
    // devicePixelRatio (e.g. Windows display scaling at 125%), the real viewport
    // can be fractional — e.g. 767.5px. innerWidth rounds that to 768, so
    // `innerWidth < 768` is false ("desktop"), while the CSS `md:` query,
    // evaluated on the true fractional width, is also false ("mobile"). That
    // mismatch CSS-hides the desktop sidebar (`hidden md:block`) AND skips the
    // mobile sheet (rendered on `isMobile`), leaving no sidebar and a dead
    // toggle. It reproduced only on Windows snap-to-half (which lands exactly on
    // that boundary), not on manual resize. Sharing one query + `.matches` keeps
    // JS and CSS in lockstep at every width, fractional included.
    const mql = window.matchMedia(`(min-width: ${MOBILE_BREAKPOINT}px)`)
    const onChange = () => setIsMobile(!mql.matches)
    mql.addEventListener("change", onChange)
    setIsMobile(!mql.matches)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
