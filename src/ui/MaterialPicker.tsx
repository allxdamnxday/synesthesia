import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import styles from './MaterialPicker.module.css';

export interface MaterialOption {
  id: string;
  name: string;
  description: string;
}

export interface MaterialPickerProps {
  /** "Visual" or "Sound". */
  kind: string;
  options: readonly MaterialOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}

/**
 * Choose a material. The list shows each material's plain-language description so the
 * choice can be made by feel (SPEC 9.1 "description: shown in the picker").
 */
export function MaterialPicker({ kind, options, value, onChange, disabled }: MaterialPickerProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // Where the pointer was when the list opened: an option appearing under a still pointer
  // must not steal the keyboard highlight, only real pointer movement may.
  const pointerAtOpen = useRef<{ x: number; y: number } | null>(null);
  const current = options.find((o) => o.id === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  const openList = () => {
    setHighlight(
      Math.max(
        0,
        options.findIndex((o) => o.id === value),
      ),
    );
    setOpen(true);
  };

  const choose = (index: number) => {
    const option = options[index];
    if (option) onChange(option.id);
    setOpen(false);
  };

  const onListKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(options.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      choose(highlight);
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div className={styles.picker} ref={rootRef}>
      <button
        type="button"
        className={styles.button}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        disabled={disabled}
        onClick={(e) => {
          pointerAtOpen.current = { x: e.clientX, y: e.clientY };
          if (open) setOpen(false);
          else openList();
        }}
        title={current?.description}
      >
        <span className={styles.kind}>{kind}</span>
        <span className={styles.name}>{current?.name ?? 'Choose…'}</span>
        <span className={styles.caret} aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <ul
          id={`${id}-list`}
          ref={listRef}
          className={styles.list}
          role="listbox"
          tabIndex={-1}
          aria-label={`${kind} material`}
          aria-activedescendant={`${id}-opt-${highlight}`}
          onKeyDown={onListKeyDown}
        >
          {options.map((option, index) => (
            <li
              key={option.id}
              id={`${id}-opt-${index}`}
              role="option"
              aria-selected={option.id === value}
              className={[
                styles.option,
                index === highlight ? styles.highlight : '',
                option.id === value ? styles.selected : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onPointerMove={(e) => {
                const start = pointerAtOpen.current;
                if (start && start.x === e.clientX && start.y === e.clientY) return;
                pointerAtOpen.current = null;
                setHighlight(index);
              }}
              onClick={() => choose(index)}
            >
              <span className={styles.optionName}>{option.name}</span>
              <span className={styles.optionDescription}>{option.description}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
