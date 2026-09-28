import { useRef } from 'react';
import { Button, type ButtonProps } from './Button';

export interface FileButtonProps extends Omit<ButtonProps, 'onClick' | 'type'> {
  /** File types the picker offers, e.g. ".json,application/json". */
  accept?: string;
  multiple?: boolean;
  /** Called with the chosen files (never with an empty list). */
  onFiles: (files: File[]) => void;
}

/**
 * A Button that opens the system file picker. The same file can be chosen twice in a
 * row (the picker is reset after each choice).
 */
export function FileButton({ accept, multiple, onFiles, children, ...rest }: FileButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button {...rest} onClick={() => inputRef.current?.click()}>
        {children}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        tabIndex={-1}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length > 0) onFiles(files);
        }}
      />
    </>
  );
}
