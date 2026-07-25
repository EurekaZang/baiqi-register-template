import type { VendorId } from '../lib/model-meta'
import { cn } from '../lib/utils'

type Props = {
  vendor: VendorId
  className?: string
  /** Optional accessible name; otherwise decorative */
  title?: string
}

export function ModelLogo({ vendor, className, title }: Props) {
  const common = cn('model-logo size-4 shrink-0', className)
  const a11y = title
    ? ({ role: 'img' as const, 'aria-label': title })
    : ({ 'aria-hidden': true as const })

  switch (vendor) {
    case 'openai':
      return (
        <svg viewBox="0 0 24 24" className={common} fill="currentColor" {...a11y}>
          {/* OpenAI-style bloom — simplified monochrome */}
          <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.01l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.387-.676zm2.01-3.023-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.229V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
        </svg>
      )
    case 'anthropic':
      return (
        <svg viewBox="0 0 24 24" className={cn(common, 'text-white')} fill="currentColor" {...a11y}>
          <path d="M17.304 3h-3.671l6.696 18h3.671L17.304 3zM6.696 3 0 21h3.744l1.37-3.552h7.051L13.535 21h3.751L10.392 3H6.696zm-.518 11.346L8.97 7.145l2.79 7.201H6.178z" />
        </svg>
      )
    case 'xai':
      return (
        <svg viewBox="0 0 24 24" className={common} fill="currentColor" {...a11y}>
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      )
    case 'deepseek':
      return (
        <svg viewBox="0 0 24 24" className={cn(common, 'text-neutral-300')} fill="currentColor" {...a11y}>
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3.5c1.93 0 3.5 1.57 3.5 3.5S13.93 12.5 12 12.5 8.5 10.93 8.5 9 10.07 5.5 12 5.5zM12 20c-2.7 0-5.08-1.35-6.56-3.41C6.2 14.7 9.9 14 12 14s5.8.7 6.56 2.59C17.08 18.65 14.7 20 12 20z" />
        </svg>
      )
    default:
      return (
        <span
          className={cn(
            common,
            'inline-flex items-center justify-center rounded-full bg-neutral-800 text-[9px] font-bold uppercase text-neutral-300',
          )}
          {...a11y}
        >
          ?
        </span>
      )
  }
}
