import type { FC } from 'react'

import type { ShapeProps } from './rectangle'

export const Cloud: FC<ShapeProps> = ({ x, y, w, h }) => {
  // Build a puffy cloud from a sequence of arcs along an inset rounded box.
  const inset = Math.min(w, h) * 0.18
  const left = x + inset
  const right = x + w - inset
  const top = y + inset
  const bottom = y + h - inset

  const bumpY = inset * 0.95
  const bumpX = inset * 0.95

  const d = [
    `M ${left} ${top}`,
    `a ${bumpY} ${bumpY} 0 0 1 ${(right - left) * 0.25} ${-bumpY * 0.4}`,
    `a ${bumpY} ${bumpY} 0 0 1 ${(right - left) * 0.5} 0`,
    `a ${bumpY} ${bumpY} 0 0 1 ${(right - left) * 0.25} ${bumpY * 0.4}`,
    `a ${bumpX} ${bumpX} 0 0 1 0 ${bottom - top}`,
    `a ${bumpY} ${bumpY} 0 0 1 ${-(right - left) * 0.25} ${bumpY * 0.4}`,
    `a ${bumpY} ${bumpY} 0 0 1 ${-(right - left) * 0.5} 0`,
    `a ${bumpY} ${bumpY} 0 0 1 ${-(right - left) * 0.25} ${-bumpY * 0.4}`,
    `a ${bumpX} ${bumpX} 0 0 1 0 ${-(bottom - top)}`,
    'Z',
  ].join(' ')

  return (
    <path
      d={d}
      fill='#ffffff'
      stroke='#3b4252'
      strokeWidth={1.5}
      strokeLinejoin='round'
    />
  )
}
