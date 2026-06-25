import { useEffect, useId, useRef, useState } from "react";

export interface AssetSelectOption {
  asset: string;
}

interface AssetSelectProps {
  value: string;
  options: AssetSelectOption[];
  onChange: (asset: string) => void;
  disabled?: boolean;
  getIconUrl: (asset: string) => string;
}

function AssetIcon({ iconUrl }: { iconUrl: string }) {
  if (!iconUrl) {
    return null;
  }
  return (
    <img
      className="asset-select__icon"
      src={iconUrl}
      alt=""
      aria-hidden="true"
      referrerPolicy="no-referrer"
    />
  );
}

export function AssetSelect({ value, options, onChange, disabled = false, getIconUrl }: AssetSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node) || !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const selectedIconUrl = getIconUrl(value);

  return (
    <div className={`asset-select${open ? " asset-select--open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="asset-select__trigger"
        onClick={() => {
          if (!disabled) {
            setOpen((current) => !current);
          }
        }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
      >
        <span className="asset-select__trigger-content">
          <AssetIcon iconUrl={selectedIconUrl} />
          <span className="asset-select__label">{value}</span>
        </span>
        <svg className="asset-select__chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
        </svg>
      </button>
      {open ? (
        <ul className="asset-select__menu" id={listboxId} role="listbox" aria-label={value}>
          {options.map((option) => {
            const iconUrl = getIconUrl(option.asset);
            const isSelected = option.asset === value;
            return (
              <li key={option.asset} role="presentation">
                <button
                  type="button"
                  className={`asset-select__option${isSelected ? " asset-select__option--selected" : ""}`}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(option.asset);
                    setOpen(false);
                  }}
                >
                  <AssetIcon iconUrl={iconUrl} />
                  <span className="asset-select__label">{option.asset}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
