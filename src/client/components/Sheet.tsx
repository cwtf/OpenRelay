import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Icon, type IconName } from './Icon';

type SheetProps = {
  title?: ReactNode;
  headerAction?: ReactNode;
  onClosed: () => void;
  children: (close: () => void) => ReactNode;
  label?: string;
};

/** Modal bottom sheet with scrim, drag-to-dismiss and exit animation. */
export const Sheet = ({
  title,
  headerAction,
  onClosed,
  children,
  label,
}: SheetProps) => {
  const [closing, setClosing] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; dy: number; id: number } | null>(null);
  const closedRef = useRef(false);

  const finish = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    onClosed();
  }, [onClosed]);

  const close = useCallback(() => setClosing(true), []);

  useEffect(() => {
    sheetRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  useEffect(() => {
    if (!closing) return;
    // Safety net in case animationend never fires (e.g. hidden tab).
    const timer = window.setTimeout(finish, 400);
    return () => window.clearTimeout(timer);
  }, [closing, finish]);

  const onPointerDown = (event: ReactPointerEvent) => {
    drag.current = { y: event.clientY, dy: 0, id: event.pointerId };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    sheetRef.current?.classList.add('is-dragging');
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    if (!drag.current || !sheetRef.current) return;
    drag.current.dy = Math.max(0, event.clientY - drag.current.y);
    sheetRef.current.style.transform = `translateY(${drag.current.dy}px)`;
  };

  const onPointerUp = () => {
    const sheet = sheetRef.current;
    const state = drag.current;
    drag.current = null;
    if (!sheet || !state) return;
    sheet.classList.remove('is-dragging');
    if (state.dy > Math.min(140, sheet.clientHeight * 0.3)) {
      sheet.style.transition = 'transform 180ms var(--ease-in)';
      sheet.style.transform = 'translateY(100%)';
      window.setTimeout(finish, 180);
      setClosing(true);
    } else {
      sheet.style.transition = 'transform 220ms var(--ease-emph)';
      sheet.style.transform = '';
      window.setTimeout(() => {
        if (sheet) sheet.style.transition = '';
      }, 240);
    }
  };

  const dragHandlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
  };

  return (
    <div className={`layer${closing ? ' is-closing' : ''}`}>
      <div className="scrim" onClick={close} />
      <div
        ref={sheetRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={label ?? (typeof title === 'string' ? title : undefined)}
        tabIndex={-1}
        onAnimationEnd={(event) => {
          if (closing && event.target === event.currentTarget) finish();
        }}
      >
        <div className="sheet-handle" {...dragHandlers} />
        {title || headerAction ? (
          <div className="sheet-head" {...dragHandlers}>
            <h2 className="sheet-title">{title}</h2>
            {headerAction}
          </div>
        ) : null}
        <div className="sheet-content">{children(close)}</div>
      </div>
    </div>
  );
};

type SheetItemProps = {
  icon?: IconName;
  label: ReactNode;
  hint?: ReactNode;
  selected?: boolean;
  onClick: () => void;
};

export const SheetItem = ({
  icon,
  label,
  hint,
  selected,
  onClick,
}: SheetItemProps) => (
  <button
    type="button"
    className={`sheet-item${selected ? ' is-selected' : ''}`}
    data-ripple
    onClick={onClick}
    aria-pressed={selected}
  >
    {icon ? <Icon name={icon} /> : null}
    <span className="label">
      {label}
      {hint ? <span className="hint">{hint}</span> : null}
    </span>
    {selected ? <Icon name="check" size={20} /> : null}
  </button>
);
