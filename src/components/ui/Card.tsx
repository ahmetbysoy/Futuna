import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cn('surface-card', className)} {...props} />
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('surface-card__header', className)} {...props} />
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn('surface-card__title', className)}>{children}</h2>
}

export function CardDescription({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('surface-card__description', className)}>{children}</p>
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('surface-card__body', className)} {...props} />
}
