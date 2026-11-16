import { useEffect, useId, useRef, type ReactNode } from "react";
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
    eye: <><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
    "eye-off": <><path d="m3 3 18 18M10 6.2A12 12 0 0 1 12 6c6.4 0 10 6 10 6a15 15 0 0 1-3 3.4M6 7.8A16 16 0 0 0 2 12s3.6 6 10 6a11 11 0 0 0 4.5-1" /></>,
    person: <><circle cx="12" cy="7" r="3" /><path d="M5 21v-2a7 7 0 0114 0v2" /></>,
    cash: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="12" cy="12" r="3" /><path d="M6 12h1m10 0h1" /></>,
    box: <path d="m3 7 9-4 9 4v10l-9 4-9-4V7l9 4 9-4m-9 4v10" />,
    clipboard: <><rect x="5" y="5" width="14" height="16" rx="2" /><rect x="9" y="3" width="6" height="4" rx="1" fill="white" /><path d="m8 13 2 2 5-5m-7 8h8" /></>,
    coffee: <><path d="M4 8h12v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8Zm12 1h2a2.5 2.5 0 0 1 0 5h-2M3 21h16M8 3v2m4-2v2" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    exchange: <path d="M3 8h17m-4-4 4 4-4 4M21 16H4m4-4-4 4 4 4" />,
    expand: <path d="M8 4H4v4m12-4h4v4m0 8v4h-4M8 20H4v-4" />,
    shrink: <path d="M4 8h4V4m12 4h-4V4m4 12h-4v4M4 16h4v4" />,
    arrival: <path d="M14 4h6v16h-6M3 12h12m-4-4 4 4-4 4" />,
    receipt: <><path d="M5 3h14v18l-3-2-4 2-4-2-3 2V3Zm4 5h6m-6 4h6m-6 4h3" /></>,
    chat: <path d="M20 11a7 7 0 0 1-7 7H9l-5 3 1.5-5A7 7 0 0 1 10 4h3a7 7 0 0 1 7 7Zm-11 0h6" />,
    card: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M3 10h18M7 15h4" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    inbox: <path d="M8 4h8l5 9v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5l5-9Zm-5 9h5l1 3h6l1-3h5" />,
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2" />
      </>
    ),
    bed: (
      <>
        <path d="M3 18v3M21 18v3M3 10v8h18v-8M3 14h18M5 10V5h14v5M7 10V8h4v2M13 10V8h4v2" />
      </>
    ),
    book: (
      <>
        <rect x="5" y="3" width="15" height="18" rx="2" />
        <path d="M9 3v18M12 8h5M12 12h5" />
      </>
    ),
    notes: (
      <>
        <path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h5" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 21v-3a6 6 0 0112 0v3M16 5a3 3 0 010 6M18 15a5 5 0 013 5" />
      </>
    ),
    settings: (
      <>
        <path d="M4 6h16M4 12h16M4 18h16" />
        <circle cx="8" cy="6" r="2" />
        <circle cx="15" cy="12" r="2" />
        <circle cx="9" cy="18" r="2" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    pencil: <><path d="m4 16 11-11a2.8 2.8 0 0 1 4 4L8 20l-5 1zM13 7l4 4" /></>,
    trash: <path d="M3 6h18M9 6V3h6v3m4 0-1 14H6L5 6m5 4v6m4-6v6" />,
    chevron: <path d="m9 5 7 7-7 7" />,
    check: <path d="m5 12 4 4L19 6" />,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    logout: (
      <>
        <path d="M10 4H4v16h6M10 12h11m-4-4 4 4-4 4" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.book}
    </svg>
  );
}
export function Modal({
  title,
  onClose,
  children,
  wide = false,
  className,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={["app-modal", wide && "wide-dialog", className].filter(Boolean).join(" ")}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-heading">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar">
          <Icon name="close" size={22} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name="inbox" size={25} /></span>
      <h3>{title}</h3>
      {children}
    </div>
  );
}
export function ErrorBox({ message }: { message: string }) {
  return message ? (
    <p className="error" role="alert">
      {message}
    </p>
  ) : null;
}
