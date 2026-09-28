import type { ComponentPropsWithRef } from 'react';
import styles from './IconButton.module.css';

export interface IconButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'aria-label'> {
  /** What the button does, for screen readers and as a tooltip. Required: the icon has no text. */
  label: string;
}

/** A quiet square button showing only an icon (at least 32 × 32 px). */
export function IconButton({ label, className, type = 'button', title, ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={title ?? label}
      className={[styles.iconButton, className].filter(Boolean).join(' ')}
      {...rest}
    />
  );
}
