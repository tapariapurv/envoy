/** Envoy mark on a transparent background: an "E" drawn as a speaker's lectern, wrapped by an olive branch.
 *  Source: docs/brand/envoy-logo.svg → public/logo.png (indigo) + logo-dark.png (lavender) via docs/brand/render.sh. */
export default function Logo({ className = "size-8" }: { className?: string }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny static assets */}
      <img src="/logo.png" alt="" aria-hidden width={32} height={32} className={`${className} dark:hidden`} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-dark.png" alt="" aria-hidden width={32} height={32} className={`${className} hidden dark:block`} />
    </>
  );
}
