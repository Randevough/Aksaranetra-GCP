"use client";

import React, { useEffect, useState } from "react";
import styles from "./ViewportBlur.module.css";

export default function ViewportBlur() {
  const [obscuringFocus, setObscuringFocus] = useState(false);

  useEffect(() => {
    const checkFocus = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) {
        setObscuringFocus(false);
        return;
      }
      if (!target.matches(":focus-visible")) {
        setObscuringFocus(false);
        return;
      }
      const rect = target.getBoundingClientRect();
      const nearTop = rect.top < 88;
      const nearBottom = rect.bottom > window.innerHeight - 92;
      setObscuringFocus(nearTop || nearBottom);
    };

    const onFocusIn = (event: FocusEvent) => checkFocus(event.target);
    const onFocusOut = () => setObscuringFocus(false);

    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    return () => {
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className={`viewport-blur-wrapper ${obscuringFocus ? styles.pausedForFocus : ""}`}
    >
      {/* Top Viewport Progressive Blur */}
      <div className={styles.topWrapper}>
        <div className={`${styles.layer} ${styles.topL1}`} />
        <div className={`${styles.layer} ${styles.topL2}`} />
        <div className={`${styles.layer} ${styles.topL3}`} />
        <div className={`${styles.layer} ${styles.topL4}`} />
        <div className={styles.topFade} />
      </div>

      {/* Bottom Viewport Progressive Blur */}
      <div className={styles.bottomWrapper}>
        <div className={`${styles.layer} ${styles.bottomL1}`} />
        <div className={`${styles.layer} ${styles.bottomL2}`} />
        <div className={`${styles.layer} ${styles.bottomL3}`} />
        <div className={`${styles.layer} ${styles.bottomL4}`} />
        <div className={`${styles.layer} ${styles.bottomL5}`} />
        <div className={styles.bottomFade} />
      </div>
    </div>
  );
}
