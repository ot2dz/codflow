import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";

export type SelectVariant = "default" | "bare" | "inverted" | "pill";
export type SelectSize = "default" | "sm";

interface SelectProps
  extends Omit<
    SelectHTMLAttributes<HTMLSelectElement>,
    "children" | "className" | "size" | "value" | "onChange" | "prefix"
  > {
  children?: ReactNode;
  className?: string;
  wrapperClassName?: string;
  triggerClassName?: string;
  variant?: SelectVariant;
  size?: SelectSize;
  prefix?: ReactNode;
  value?: string | number;
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
  /** Show a type-to-filter search box at the top of the dropdown. */
  searchable?: boolean;
  searchPlaceholder?: string;
  noResultsText?: string;
}

type Option = { value: string; label: string; disabled: boolean };
type OptionEntry = { option: Option; index: number };

function parseOptions(children: ReactNode): Option[] {
  return Children.toArray(children)
    .filter(
      (child): child is ReactElement =>
        isValidElement(child) && child.type === "option",
    )
    .map((child) => {
      const props = child.props as {
        value?: unknown;
        disabled?: boolean;
        children?: ReactNode;
      };
      return {
        value: String(props.value ?? ""),
        label: String(props.children ?? ""),
        disabled: Boolean(props.disabled),
      };
    });
}

const triggerBase =
  "group/select relative flex w-full items-center gap-2 rounded-lg outline-none transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 select-none";

function triggerClasses(variant: SelectVariant, size: SelectSize): string {
  const dimensions =
    variant === "default"
      ? size === "sm"
        ? "h-8 text-xs px-2.5 pe-7"
        : "h-9 text-[13.5px] px-3 pe-8"
      : "";
  const perVariant: Record<SelectVariant, string> = {
    default:
      "border border-input/80 bg-card text-foreground shadow-2xs hover:border-input focus:border-ring focus:ring-2 focus:ring-ring/20",
    bare: "h-9 bg-transparent ps-0.5 pe-6 text-sm text-foreground focus:ring-2 focus:ring-ring/20",
    inverted:
      "h-9 border border-white/15 bg-white/10 px-2.5 pe-8 text-xs font-semibold text-white hover:bg-white/15 focus:ring-2 focus:ring-white/30",
    pill: "h-auto min-w-0 rounded-full border border-border/80 px-2.5 pe-6 py-1 text-xs font-semibold focus:ring-2 focus:ring-ring/20 bg-card",
  };
  return `${triggerBase} ${perVariant[variant]} ${dimensions}`;
}

const chevronClass: Record<SelectVariant, string> = {
  default: "end-2.5 text-muted-foreground/70",
  bare: "end-0 text-muted-foreground/70",
  inverted: "end-2 text-white/60",
  pill: "end-1.5 text-muted-foreground/70",
};

export function Select({
  children,
  className = "",
  wrapperClassName = "",
  triggerClassName = "",
  variant = "default",
  size = "default",
  prefix,
  value: rawValue,
  onChange,
  searchable = false,
  searchPlaceholder = "Search…",
  noResultsText = "No results",
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  id,
  ...rest
}: SelectProps) {
  const value = rawValue == null ? "" : String(rawValue);
  const options = useMemo(() => parseOptions(children), [children]);
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const hiddenRef = useRef<HTMLSelectElement>(null);

  const visible = useMemo<OptionEntry[]>(() => {
    const entries = options.map((option, index) => ({ option, index }));
    const needle = query.trim().toLowerCase();
    if (!searchable || !needle) return entries;
    return entries.filter((entry) =>
      entry.option.label.toLowerCase().includes(needle),
    );
  }, [options, searchable, query]);

  const selectedIndex = options.findIndex((option) => option.value === value);
  const placeholder = options.find((option) => option.value === "");
  const showingPlaceholder = value === "" && placeholder != null;
  const label =
    selectedIndex >= 0
      ? options[selectedIndex].label
      : showingPlaceholder
        ? placeholder!.label
        : value;

  function positionFromTrigger(): boolean {
    const trigger = triggerRef.current;
    if (!trigger) return false;
    const rect = trigger.getBoundingClientRect();
    // The trigger scrolled out of view → no anchor to hold onto.
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      setOpen(false);
      return false;
    }
    setPos({ left: rect.left, top: rect.bottom + 6, width: rect.width });
    setOpenUp(false);
    return true;
  }

  function openDropdown() {
    if (rest.disabled) return;
    positionFromTrigger();
    setQuery("");
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (wrapperRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Keep the floating panel glued to its trigger on external scroll/resize —
  // including the mobile on-screen keyboard, which resizes the viewport when
  // the search box is focused. Closing on that resize made the dropdown vanish
  // on phones; it now repositions instead, and only closes when the trigger
  // itself scrolls out of view.
  useEffect(() => {
    if (!open) return;
    const onScroll = (event: Event) => {
      const target = event.target as Node | null;
      if (
        panelRef.current &&
        target &&
        (panelRef.current === target || panelRef.current.contains(target))
      ) {
        return;
      }
      positionFromTrigger();
    };
    const onResize = () => {
      positionFromTrigger();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("scroll", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("scroll", onResize);
    };
  }, [open]);

  useEffect(() => {
    if (open && searchable) {
      searchRef.current?.focus({ preventScroll: true });
    }
  }, [open, searchable]);

  useEffect(() => {
    if (open) {
      const idx = visible.findIndex((entry) => entry.option.value === value);
      setActiveIndex(idx >= 0 ? idx : 0);
    } else {
      setActiveIndex(-1);
    }
  }, [open, visible, value]);

  useEffect(() => {
    if (!open || !panelRef.current || !pos) return;
    const panel = panelRef.current;
    const rect = panel.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = pos.left;
    let top = pos.top;
    let up = openUp;
    if (rect.right > vw - 8) left = Math.max(8, vw - rect.width - 8);
    if (rect.left < 8) left = 8;
    if (rect.bottom > vh - 8) {
      const trigger = triggerRef.current;
      if (trigger) {
        top = trigger.getBoundingClientRect().top - rect.height - 6;
        up = true;
      }
    } else if (rect.top < 8) {
      const trigger = triggerRef.current;
      if (trigger) {
        top = trigger.getBoundingClientRect().bottom + 6;
        up = false;
      }
    }
    if (left !== pos.left || top !== pos.top || up !== openUp) {
      setPos({ left, top, width: pos.width });
      setOpenUp(up);
    }
  }, [open, pos, openUp, visible.length]);

  useEffect(() => {
    if (!open) return;
    panelRef.current
      ?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function commit(index: number) {
    const entry = visible[index];
    if (!entry || entry.option.disabled) return;
    setOpen(false);
    if (hiddenRef.current) hiddenRef.current.value = entry.option.value;
    onChange?.({
      currentTarget: { value: entry.option.value },
      target: { value: entry.option.value },
    } as ChangeEvent<HTMLSelectElement>);
    triggerRef.current?.focus();
  }

  function navigate(event: KeyboardEvent<HTMLElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, visible.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(visible.length - 1);
        break;
      case "Enter":
        event.preventDefault();
        if (activeIndex >= 0) commit(activeIndex);
        break;
      case "Escape":
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (rest.disabled) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openDropdown();
      } else if (searchable && event.key.length === 1) {
        openDropdown();
      }
      return;
    }
    navigate(event);
  }

  const panel = open ? (
    createPortal(
      <div
        ref={panelRef}
        id={`${rootId}-listbox`}
        role="listbox"
        aria-label={ariaLabel}
        style={
          pos
            ? { left: pos.left, top: pos.top, width: Math.max(pos.width, 180) }
            : undefined
        }
        className="fixed z-[80] flex max-h-72 flex-col overflow-hidden rounded-xl border border-border/80 bg-popover p-1 text-popover-foreground shadow-xl shadow-black/10 backdrop-blur-md animate-in fade-in-0 zoom-in-95 duration-150"
      >
        {searchable && (
          <div className="relative mb-1 shrink-0">
            <Search
              size={14}
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 start-2.5 my-auto text-muted-foreground/70"
            />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={navigate}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              autoComplete="off"
              className="h-9 w-full rounded-lg border border-input/60 bg-background ps-8 pe-3 text-[13px] font-medium text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            />
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {visible.map((entry, index) => {
            const option = entry.option;
            const isSelected = option.value === value;
            const isActive = index === activeIndex;
            return (
              <div
                key={option.value}
                id={`${rootId}-opt-${index}`}
                role="option"
                aria-selected={isSelected}
                aria-disabled={option.disabled || undefined}
                data-option-index={index}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event: MouseEvent<HTMLDivElement>) => {
                  event.preventDefault();
                  commit(index);
                }}
                className={`flex min-h-[34px] cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium outline-none transition-colors ${
                  isActive ? "bg-muted/80 text-foreground" : ""
                } ${
                  isSelected
                    ? "bg-brand/[0.08] font-semibold text-brand dark:bg-brand/15 dark:text-brand"
                    : "text-foreground/85"
                } ${option.disabled ? "cursor-not-allowed opacity-40" : ""}`}
              >
                <span className="min-w-0 flex-1 truncate text-start">
                  {option.label}
                </span>
                {isSelected && (
                  <Check
                    size={14}
                    strokeWidth={2.2}
                    className="shrink-0 text-brand"
                    aria-hidden="true"
                  />
                )}
              </div>
            );
          })}
          {searchable && visible.length === 0 && (
            <p className="px-3 py-6 text-center text-[13px] font-medium text-muted-foreground">
              {noResultsText}
            </p>
          )}
        </div>
      </div>,
      document.body,
    )
  ) : null;

  return (
    <div ref={wrapperRef} className={`relative ${wrapperClassName}`}>
      <select
        ref={hiddenRef}
        value={value}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={onChange}
        {...rest}
      >
        {children}
      </select>

      <button
        ref={triggerRef}
        type="button"
        id={id}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${rootId}-listbox` : undefined}
        aria-activedescendant={
          open && activeIndex >= 0 ? `${rootId}-opt-${activeIndex}` : undefined
        }
        disabled={rest.disabled}
        onClick={() => {
          if (rest.disabled) return;
          if (open) setOpen(false);
          else openDropdown();
        }}
        onKeyDown={onTriggerKeyDown}
        className={`${triggerClasses(variant, size)} ${triggerClassName} ${className}`}
      >
        {prefix && (
          <span
            className="pointer-events-none shrink-0 text-muted-foreground/70"
            aria-hidden="true"
          >
            {prefix}
          </span>
        )}
        <span
          className={`min-w-0 flex-1 truncate text-start ${
            showingPlaceholder ? "text-muted-foreground" : ""
          }`}
        >
          {label}
        </span>
        <ChevronDown
          size={14}
          strokeWidth={2}
          aria-hidden="true"
          className={`pointer-events-none absolute top-1/2 -translate-y-1/2 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          } ${chevronClass[variant]}`}
        />
      </button>

      {panel}
    </div>
  );
}
