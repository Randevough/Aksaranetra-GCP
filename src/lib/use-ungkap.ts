"use client";

import { useEffect } from "react";

export function useUngkap() {
  useEffect(() => {
    const elems = document.querySelectorAll<HTMLElement>(".ungkap");
    if (elems.length === 0) return;

    const revealAll = () => {
      elems.forEach((el) => el.classList.add("terlihat"));
    };

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (prefersReduced || typeof IntersectionObserver === "undefined") {
      revealAll();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("terlihat");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -4% 0px" },
    );

    elems.forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight * 1.1) {
        el.classList.add("terlihat");
      } else {
        observer.observe(el);
      }
    });

    // Safety fallback so sections never remain permanently hidden if observer stalls.
    const fallbackTimer = window.setTimeout(revealAll, 1800);

    return () => {
      observer.disconnect();
      window.clearTimeout(fallbackTimer);
    };
  }, []);
}
