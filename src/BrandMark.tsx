/** Paired time-register strokes form the davomat brand mark. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 4h10v6H9v3h5v6H9v9H4V4Zm14 0h10v6h-5v3h5v6h-5v9h-5V4Z"
        fill="currentColor"
      />
      <path d="M12 23h3v5h-3z" fill="currentColor" />
    </svg>
  );
}
