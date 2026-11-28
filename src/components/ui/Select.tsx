"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import styles from "./Select.module.css";

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
}

export interface SelectProps<T extends string = string> {
  id?: string;
  label?: string;
  ariaLabel?: string;
  value: T;
  options: ReadonlyArray<SelectOption<T>>;
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

interface MenuPlacement {
  openUpward: boolean;
  alignRight: boolean;
  maxHeight: number;
}

const DEFAULT_PLACEMENT: MenuPlacement = {
  openUpward: false,
  alignRight: false,
  maxHeight: 280,
};

export default function Select<T extends string = string>({
  id,
  label,
  ariaLabel,
  value,
  options,
  onChange,
  placeholder = "Pilih opsi",
  disabled = false,
  className,
}: SelectProps<T>): React.JSX.Element {
  const generatedId = useId();
  const triggerId = id ?? `${generatedId}-select`;
  const labelId = label ? `${triggerId}-label` : undefined;
  const listboxId = `${triggerId}-listbox`;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [placement, setPlacement] = useState<MenuPlacement>(DEFAULT_PLACEMENT);

  const selectedIndex = options.findIndex((opt) => opt.value === value);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const computeInitialIndex = (preferredIndex?: number) => {
    if (options.length === 0) return -1;
    if (
      typeof preferredIndex === "number" &&
      preferredIndex >= 0 &&
      preferredIndex < options.length
    ) {
      return preferredIndex;
    }
    return selectedIndex >= 0 ? selectedIndex : 0;
  };

  const openMenu = (preferredIndex?: number) => {
    if (disabled || options.length === 0) return;
    setActiveIndex(computeInitialIndex(preferredIndex));
    setOpen(true);
  };

  const closeMenu = (restoreFocus = false) => {
    setOpen(false);
    setActiveIndex(-1);
    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  };

  const commitSelection = (nextValue: T) => {
    if (nextValue !== value) {
      onChange(nextValue);
    }
    closeMenu(true);
  };

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;

    const updatePlacement = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const viewportPadding = 12;
      const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
      const spaceAbove = rect.top - viewportPadding;
      const openUpward = spaceBelow < 200 && spaceAbove > spaceBelow;
      const availableVertical = openUpward ? spaceAbove : spaceBelow;
      const maxHeight = Math.max(120, Math.min(280, Math.floor(availableVertical)));

      const minMenuWidth = Math.max(rect.width, 220);
      const alignRight =
        rect.left + minMenuWidth > window.innerWidth - viewportPadding &&
        rect.right >= minMenuWidth;

      setPlacement({ openUpward, alignRight, maxHeight });
    };

    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    return () => window.removeEventListener("resize", updatePlacement);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const activeEl = optionRefs.current[activeIndex];
    if (activeEl && typeof activeEl.scrollIntoView === "function") {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }, [open, activeIndex]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;

    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        if (!open) {
          openMenu();
        } else if (options.length > 0) {
          setActiveIndex((prev) =>
            prev < 0 ? 0 : Math.min(prev + 1, options.length - 1),
          );
        }
        break;
      }
      case "ArrowUp": {
        event.preventDefault();
        if (!open) {
          openMenu();
        } else if (options.length > 0) {
          setActiveIndex((prev) =>
            prev < 0 ? options.length - 1 : Math.max(prev - 1, 0),
          );
        }
        break;
      }
      case "Home": {
        if (options.length === 0) return;
        event.preventDefault();
        if (!open) {
          openMenu(0);
        } else {
          setActiveIndex(0);
        }
        break;
      }
      case "End": {
        if (options.length === 0) return;
        event.preventDefault();
        if (!open) {
          openMenu(options.length - 1);
        } else {
          setActiveIndex(options.length - 1);
        }
        break;
      }
      case "Enter":
      case " ": {
        event.preventDefault();
        if (!open) {
          openMenu();
        } else if (activeIndex >= 0 && options[activeIndex]) {
          commitSelection(options[activeIndex].value);
        } else {
          closeMenu(true);
        }
        break;
      }
      case "Escape": {
        if (open) {
          event.preventDefault();
          closeMenu(true);
        }
        break;
      }
      case "Tab": {
        if (open) {
          setOpen(false);
          setActiveIndex(-1);
        }
        break;
      }
      default:
        break;
    }
  };

  const activeOptionId =
    open && activeIndex >= 0 ? `${triggerId}-option-${activeIndex}` : undefined;

  return (
    <div
      ref={rootRef}
      className={className ? `${styles.root} ${className}` : styles.root}
    >
      {label ? (
        <label id={labelId} htmlFor={triggerId} className={styles.label}>
          {label}
        </label>
      ) : null}

      <div className={styles.controlWrap}>
        <button
          ref={triggerRef}
          id={triggerId}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={listboxId}
          aria-labelledby={labelId}
          aria-label={label ? undefined : ariaLabel}
          aria-activedescendant={activeOptionId}
          disabled={disabled}
          className={styles.trigger}
          data-open={open ? "true" : "false"}
          onClick={() => {
            if (open) {
              closeMenu(false);
            } else {
              openMenu();
            }
          }}
          onKeyDown={handleKeyDown}
        >
          <span
            className={
              selectedOption ? styles.triggerValue : styles.triggerPlaceholder
            }
          >
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={styles.chevron}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        {open ? (
          <ul
            id={listboxId}
            role="listbox"
            aria-labelledby={labelId}
            aria-label={label ? undefined : ariaLabel}
            className={[
              styles.listbox,
              placement.openUpward ? styles.listboxUp : styles.listboxDown,
              placement.alignRight ? styles.listboxRight : styles.listboxLeft,
            ].join(" ")}
            style={{ maxHeight: `${placement.maxHeight}px` }}
          >
            {options.map((option, index) => {
              const isSelected = option.value === value;
              const isActive = index === activeIndex;
              return (
                <li
                  key={option.value}
                  ref={(el) => {
                    optionRefs.current[index] = el;
                  }}
                  id={`${triggerId}-option-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  className={[
                    styles.option,
                    isSelected ? styles.optionSelected : "",
                    isActive ? styles.optionActive : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => {
                    // Prevent trigger blur/focus flicker before click commits selection
                    event.preventDefault();
                  }}
                  onClick={() => commitSelection(option.value)}
                >
                  <span className={styles.optionLabel}>{option.label}</span>
                  {isSelected ? (
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      className={styles.checkmark}
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
