import { cn } from '@/lib/utils'
import logoUrl from '@/assets/logo.png'

interface Props {
  className?: string
}

export default function Logo({ className }: Props) {
  return (
    <img
      src={logoUrl}
      alt="logo"
      className={cn('shrink-0 rounded-lg object-cover select-none pointer-events-none', className)}
      draggable={false}
    />
  )
}
